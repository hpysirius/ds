'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Tooltip,
  message,
} from 'antd';
import { CopyOutlined, LinkOutlined, SaveOutlined, SearchOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { API_BASE, http } from '@/lib/api';

const COUNTRIES = [
  { value: 'RU', label: '俄罗斯' },
  { value: 'BY', label: '白俄罗斯' },
  { value: 'KZ', label: '哈萨克斯坦' },
  { value: 'KG', label: '吉尔吉斯斯坦' },
];
const VENDORS = [
  { value: 'GUOO', label: 'GUOO（黑河国欧）' },
  { value: 'XY', label: '兴远国际 XY' },
];

const pct = (v: any) => `${((Number(v) || 0) * 100).toFixed(2)}%`;
const money = (v: any, d = 2) => (Number(v) || 0).toFixed(d);
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

/** 本地按定价表公式重算利润（手改定价时即时反馈） */
function localMetrics(sellPriceCny: number, cost: number, fee: number, label: number, g: number, h: number, i: number) {
  const gross = sellPriceCny - cost - fee - label - sellPriceCny * g - sellPriceCny * h;
  const net = gross - (cost + gross) * i;
  return {
    grossProfit: r2(gross),
    netProfit: r2(net),
    profitRate: cost > 0 ? r4(net / cost) : 0,
    freightProfitRatio: fee > 0 ? r4(net / fee) : 0,
    markup35: r2(sellPriceCny / 0.65),
  };
}

/**
 * 定价工作台：选品 → 1688 以图搜款 → 抓货源（成本/重量）→ 算运费与定价 → 保存定价记录
 */
export default function WorkbenchTab({ settings, onSaved }: { settings: any; onSaved?: () => void }) {
  const [form] = Form.useForm();

  const [kw, setKw] = useState('');
  const [products, setProducts] = useState<any[]>([]);
  const [picking, setPicking] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const [product, setProduct] = useState<any>(null);

  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [resultOpen, setResultOpen] = useState(false);
  const [fetchingOffer, setFetchingOffer] = useState(false);
  const [offer, setOffer] = useState<any>(null);
  const [tabs, setTabs] = useState<string[]>([]);
  const [searchKw, setSearchKw] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [copying, setCopying] = useState(false);
  const [cookie, setCookie] = useState<any>(null);
  const [cookieOpen, setCookieOpen] = useState(false);
  const [cookieText, setCookieText] = useState('');

  const [calc, setCalc] = useState<any>(null);
  const [calculating, setCalculating] = useState(false);
  const [channelId, setChannelId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoLog, setAutoLog] = useState<string[]>([]);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    if (!settings) return;
    form.setFieldsValue({
      country: settings.defaultCountry || 'RU',
      vendor: settings.defaultVendor || 'GUOO',
      exchangeRate: settings.exchangeRate,
      labelFee: settings.labelFee,
      commissionRate: Number((settings.commissionRate * 100).toFixed(2)),
      agentRate: Number((settings.agentRate * 100).toFixed(2)),
      withdrawRate: Number((settings.withdrawRate * 100).toFixed(2)),
      markupRate: Number(((settings.markupRate ?? 0.1) * 100).toFixed(2)),
    });
  }, [settings, form]);

  const loadCookieStatus = async () => {
    try {
      const { data } = await http.get('/pricing/sourcing/cookie-status');
      setCookie(data);
    } catch (e) {
      /* ignore */
    }
  };

  useEffect(() => {
    loadCookieStatus();
  }, []);

  // ---------------- 选品 ----------------
  const searchProducts = async () => {
    setPicking(true);
    try {
      const { data } = await http.get('/pricing/products', { params: { keyword: kw, limit: 24 } });
      setProducts(data || []);
      setPickOpen(true);
      if (!(data || []).length) message.info('商品库里没有匹配的 SKU');
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setPicking(false);
    }
  };

  const pickProduct = (p: any) => {
    setProduct(p);
    setPickOpen(false);
    const dims = [p.lengthCm || 0, p.widthCm || 0, p.heightCm || 0].filter((n: number) => n > 0).sort((a, b) => b - a);
    // 1688 搜索关键词：优先用中文末级类目，其次类目路径最后一段
    const lastCat = String(p.categoryPath || '')
      .split('/')
      .pop()
      ?.trim();
    const kw = p.category3Name || lastCat || '';
    setSearchKw(kw);
    form.setFieldsValue({
      sku: p.sku,
      name: (p.title || '').slice(0, 80),
      categoryPath: p.categoryPath || '',
      imageUrl: p.imageUrl || '',
      retailUrl: p.productUrl || (p.sku ? `https://www.ozon.ru/product/${p.sku}/` : ''),
      priceRub: p.priceRub || 0,
      lengthCm: dims[0] || undefined,
      widthCm: dims[1] || undefined,
      heightCm: dims[2] || undefined,
      weightKg: p.weightKg || undefined,
    });
    setCalc(null);
    setChannelId(null);
    setOffer(null);
  };

  // ---------------- 1688 找货源（纯 HTTP 为主，秒级）----------------
  /** 关键词搜同款：0.5 秒，一次 20 条 */
  const searchByKeyword = async (kwArg?: string) => {
    const keyword = (kwArg ?? searchKw ?? '').trim();
    if (!keyword) {
      message.warning('请填搜索关键词（一般用商品的中文类目名）');
      return [];
    }
    setSearching(true);
    try {
      const { data } = await http.post('/pricing/sourcing/search-keyword', { keyword });
      (data?.warnings || []).forEach((w: string) => message.warning(w));
      const items = data?.items || [];
      if (items.length) {
        setResults(items);
        setResultOpen(true);
      } else {
        message.info('没搜到货源，换个关键词试试');
      }
      return items;
    } catch (e: any) {
      message.error(e.message);
      return [];
    } finally {
      setSearching(false);
    }
  };

  /** 手动粘贴 1688 Cookie（从 DevTools 复制） */
  const saveCookie = async () => {
    const raw = cookieText.trim();
    if (!raw) {
      message.warning('请先粘贴 Cookie');
      return;
    }
    setSyncing(true);
    try {
      const { data } = await http.post('/pricing/sourcing/cookie', { cookie: raw });
      setCookie(data);
      setCookieOpen(false);
      setCookieText('');
      message.success('Cookie 已保存，之后搜款/抓详情全程走 HTTP');
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSyncing(false);
    }
  };

  /** 同步一次 1688 登录态（只读 cookie，不渲染页面） */
  const syncCookie = async () => {
    setSyncing(true);
    try {
      const { data } = await http.post('/pricing/sourcing/sync-cookie');
      message.success(data?.msg || '已同步');
      loadCookieStatus();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSyncing(false);
    }
  };

  // ---------------- 1688 找货源 ----------------
  /** 商品库没有主图时，先用调试浏览器打开 Ozon 商品页抓主图 */
  const ensureImage = async (): Promise<string | null> => {
    let imageUrl = product?.imageUrl || form.getFieldValue('imageUrl');
    if (imageUrl) return imageUrl;
    const url = product?.productUrl || form.getFieldValue('retailUrl') || (product?.sku ? `https://www.ozon.ru/product/${product.sku}/` : '');
    if (!url) return null;
    try {
      const { data } = await http.post('/pricing/sourcing/product-image', { url, sku: product?.sku });
      imageUrl = data?.imageUrl || null;
      if (imageUrl) {
        setProduct((p: any) => (p ? { ...p, imageUrl } : p));
        form.setFieldsValue({ imageUrl });
      }
    } catch (e: any) {
      message.warning(e.message);
    }
    return imageUrl;
  };

  /** 反复扫描浏览器里的 1688 标签页，取回货源卡片 */
  const collectResults = async (rounds = 6): Promise<any[]> => {
    for (let i = 0; i < rounds; i++) {
      const { data } = await http.post('/pricing/sourcing/scan-tabs');
      setTabs(data?.tabs || []);
      const items = data?.items || [];
      if (items.length) {
        setResults(items);
        setResultOpen(true);
        return items;
      }
      await new Promise((r) => setTimeout(r, 4000));
    }
    return [];
  };

  const imageSearch = async () => {
    const imageUrl = await ensureImage();
    if (!imageUrl) {
      message.warning('没有可用主图：请先从商品库选品，或手动打开商品页让系统抓图');
      return;
    }
    setSearching(true);
    try {
      // 1) 打开 1688 图搜页并把主图塞进上传框
      const { data: prep } = await http.post('/pricing/sourcing/prepare-search', { imageUrl });
      (prep?.warnings || []).forEach((w: string) => message.warning(w));
      // 2) 尽力自动点「搜索图片」（1688 是重 SPA，这一步可能点不动，不影响后面的手动流程）
      const { data: trig } = await http.post('/pricing/sourcing/trigger-search');
      // 3) 收结果
      const items = await collectResults(6);
      if (!items.length) {
        message.info(
          trig?.clicked
            ? '已自动点过搜索，但结果还没出来：请到浏览器里等一下，再点「读取 1688 结果」。'
            : '请到浏览器里点一下「搜索图片」，等结果出来后回这里点「读取 1688 结果」。',
        );
      }
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSearching(false);
    }
  };

  /** 手动收结果：用户自己在浏览器里搜完款后点这个 */
  /** 走同源代理显示图片（Ozon 图有防盗链，直链经常 403） */
  const proxyImage = (u?: string | null) =>
    u ? `${API_BASE}/pricing/sourcing/image-proxy?url=${encodeURIComponent(u)}` : '';

  /** 把 blob 统一转成 PNG（Chrome 剪贴板对 png 支持最稳） */
  const blobToPng = (blob: Blob) =>
    new Promise<Blob>((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth || 800;
          c.height = img.naturalHeight || 800;
          const ctx = c.getContext('2d');
          if (!ctx) return reject(new Error('canvas 不可用'));
          ctx.drawImage(img, 0, 0);
          c.toBlob((b) => (b ? resolve(b) : reject(new Error('转 PNG 失败'))), 'image/png');
        } catch (e) {
          reject(e as Error);
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('图片解码失败'));
      };
      img.src = url;
    });

  /**
   * 复制商品主图到剪贴板 —— 复制完去调试 Chrome 的 1688 图搜页 Ctrl+V 就能搜同款。
   * 已经点过「以图搜款」的话，图搜页已经开着并支持粘贴，两边配合用最顺。
   */
  const copyProductImage = async () => {
    setCopying(true);
    try {
      let imageUrl = product?.imageUrl || form.getFieldValue('imageUrl');
      if (!imageUrl) imageUrl = await ensureImage();
      if (!imageUrl) {
        message.warning('没有可用主图，先点「抓商品主图」');
        return;
      }

      const canWrite =
        typeof navigator !== 'undefined' &&
        !!navigator.clipboard &&
        typeof (window as any).ClipboardItem !== 'undefined';
      if (!canWrite) throw new Error('当前浏览器不支持直接写剪贴板');

      const res = await fetch(proxyImage(imageUrl));
      if (!res.ok) throw new Error('取图失败');
      const png = await blobToPng(await res.blob());
      await navigator.clipboard.write([new (window as any).ClipboardItem({ 'image/png': png })]);
      message.success('图片已复制 → 到调试 Chrome 的 1688 图搜页按 Ctrl+V 即可搜同款');
    } catch (e: any) {
      // 降级：新标签打开图片，右键复制也一样
      const u = product?.imageUrl || form.getFieldValue('imageUrl');
      if (u) window.open(proxyImage(u), '_blank');
      message.warning(`${e.message}；已在新标签打开图片，右键「复制图片」即可`);
    } finally {
      setCopying(false);
    }
  };

  const scanTabs = async () => {
    setSearching(true);
    try {
      const items = await collectResults(3);
      if (!items.length) message.info('还没读到货源：请确认浏览器里 1688 搜索结果页是打开的，再点一次。');
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSearching(false);
    }
  };

  const chooseOffer = async (item: any) => {
    setResultOpen(false);
    form.setFieldsValue({ supplyUrl: item.offerUrl, offer1688Title: item.title });
    if (item.price != null) form.setFieldsValue({ purchaseCost: item.price });
    await fetchOffer(item.offerUrl);
  };

  const fetchOffer = async (url: string) => {
    if (!url) {
      message.warning('请先填 1688 货源链接');
      return;
    }
    setFetchingOffer(true);
    try {
      const { data } = await http.post('/pricing/sourcing/offer', { url });
      setOffer(data);
      if (data?.weightG) {
        form.setFieldsValue({ weightKg: Number((data.weightG / 1000).toFixed(4)), weightSource: '1688包装信息' });
      }
      if (data?.lengthCm && data?.widthCm && data?.heightCm) {
        form.setFieldsValue({ lengthCm: data.lengthCm, widthCm: data.widthCm, heightCm: data.heightCm });
      }
      if (data?.price != null) form.setFieldsValue({ purchaseCost: data.price });
      if (data?.title) form.setFieldsValue({ offer1688Title: data.title });
      message.success(
        data?.weightG
          ? `已抓到：¥${data.price ?? '-'} · ${data.lengthCm}×${data.widthCm}×${data.heightCm}cm · ${data.weightG}g`
          : `已抓到标题与价格${data?.warnings?.length ? '，包装信息请手动补填' : ''}`,
      );
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setFetchingOffer(false);
    }
  };

  // ---------------- 算价 ----------------
  const runPrice = useCallback(
    async (preferChannelId?: number | null) => {
      let okFields = true;
      try {
        await form.validateFields(['country', 'vendor', 'weightKg', 'lengthCm', 'purchaseCost']);
      } catch (e) {
        okFields = false;
      }
      if (!okFields) {
        message.warning('请至少填写：国家、物流商、重量、最长边、采购成本');
        return;
      }
      const all = form.getFieldsValue(true);
      setCalculating(true);
      try {
        const payload: any = {
          country: all.country,
          vendor: all.vendor,
          weightKg: Number(all.weightKg || 0),
          lengthCm: Number(all.lengthCm || 0),
          widthCm: Number(all.widthCm || 0),
          heightCm: Number(all.heightCm || 0),
          valueRub: Number(all.priceRub || 0),
          purchaseCost: Number(all.purchaseCost || 0),
          labelFee: Number(all.labelFee || 0),
          commissionRate: Number(all.commissionRate || 0) / 100,
          agentRate: Number(all.agentRate || 0) / 100,
          withdrawRate: Number(all.withdrawRate || 0) / 100,
          markupRate: Number(all.markupRate || 0) / 100,
          exchangeRate: Number(all.exchangeRate || 0.0862),
          includeUnavailable: true,
        };
        const useId = preferChannelId ?? channelId;
        if (useId) payload.channelId = useId;
        const { data } = await http.post('/pricing/price', payload);
        setCalc(data);
        const chosen = useId ? (data.list || []).find((x: any) => x.channelId === useId) : data.best;
        if (chosen) {
          if (!channelId) setChannelId(chosen.channelId);
          form.setFieldsValue({ sellPrice: chosen.sellPrice });
        }
      } catch (e: any) {
        message.error(e.message);
      } finally {
        setCalculating(false);
      }
    },
    [channelId, form],
  );

  /**
   * 一键自动核价（从商品库带 SKU 过来时用）：
   * 关键词搜 1688 同款 → 取一款 → 抓价格/包装信息 → 算定价
   * 全程纯 HTTP，秒级完成（不再依赖浏览器）
   */
  const autoRun = async (p: any) => {
    setAutoRunning(true);
    setAutoLog([]);
    const log = (m: string) => setAutoLog((prev) => [...prev, m]);
    try {
      // 1. 关键词（商品库的中文末级类目）
      const lastCat = String(p.categoryPath || '')
        .split('/')
        .pop()
        ?.trim();
      const kw = p.category3Name || lastCat || '';
      if (!kw) {
        log('❌ 这个商品没有中文类目名，请手动填关键词搜款');
        return;
      }
      setSearchKw(kw);
      log(`用关键词「${kw}」搜 1688 同款（纯 HTTP）…`);
      const { data: s } = await http.post('/pricing/sourcing/search-keyword', { keyword: kw });
      (s?.warnings || []).forEach((w: string) => log('⚠ ' + w));
      const items = s?.items || [];
      if (!items.length) {
        log('❌ 没搜到结果，检查关键词或先同步 1688 登录态');
        return;
      }
      setResults(items);
      setResultOpen(true);
      // 优先挑标题里带完整关键词的（更可能是同款），否则用第一条
      const first = items.find((x: any) => (x.title || '').includes(kw)) || items[0];
      log(`✔ 搜到 ${items.length} 款，选：${(first.title || first.offerId).slice(0, 26)}（¥${first.price ?? '-'}）`);
      form.setFieldsValue({ supplyUrl: first.offerUrl, offer1688Title: first.title });
      if (first.price != null) form.setFieldsValue({ purchaseCost: first.price });
      if (first.price != null) form.setFieldsValue({ purchaseCost: first.price });

      // 3. 抓货品（价格 + 包装信息）
      log('打开 1688 货品页抓取价格与包装信息…');
      const { data: of } = await http.post('/pricing/sourcing/offer', { url: first.offerUrl });
      setOffer(of);
      if (of?.price != null) form.setFieldsValue({ purchaseCost: of.price });
      if (of?.title) form.setFieldsValue({ offer1688Title: of.title });
      if (of?.weightG) {
        form.setFieldsValue({ weightKg: Number((of.weightG / 1000).toFixed(4)), weightSource: '1688包装信息' });
        log(`✔ 包装信息：${of.lengthCm}×${of.widthCm}×${of.heightCm}cm · ${of.weightG}g`);
      } else {
        log('⚠ 没抓到包装信息，先用商品库的重量尺寸');
      }
      if (of?.lengthCm && of?.widthCm && of?.heightCm) {
        form.setFieldsValue({ lengthCm: of.lengthCm, widthCm: of.widthCm, heightCm: of.heightCm });
      }
      (of?.warnings || []).forEach((w: string) => log('⚠ ' + w));

      // 4. 算定价
      log('按渠道算运费并生成定价…');
      await runPrice(null);
      log('✔ 完成，确认后点「保存到定价记录」');
      message.success('自动核价完成');
    } catch (e: any) {
      log('❌ ' + e.message);
      message.error(e.message);
    } finally {
      setAutoRunning(false);
    }
  };

  /** 从商品库跳过来时（/pricing?sku=xxx[&auto=1]）自动带出商品，带 auto=1 时自动跑一遍 */
  useEffect(() => {
    if (booted || !settings) return;
    const params = new URLSearchParams(window.location.search);
    const sku = params.get('sku');
    if (!sku) return;
    setBooted(true);
    (async () => {
      try {
        const { data } = await http.get('/pricing/products', { params: { keyword: sku, limit: 5 } });
        const p = (data || []).find((x: any) => x.sku === sku) || (data || [])[0];
        if (!p) {
          message.warning(`商品库里没有 SKU ${sku}`);
          return;
        }
        pickProduct(p);
        if (params.get('auto') === '1') await autoRun(p);
      } catch (e: any) {
        message.error(e.message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, booted]);

  const selected = useMemo(() => {
    if (!calc?.list) return null;
    return calc.list.find((x: any) => x.channelId === channelId) || calc.best || null;
  }, [calc, channelId]);

  useEffect(() => {
    if (channelId && calc) {
      const chosen = (calc.list || []).find((x: any) => x.channelId === channelId);
      if (chosen) form.setFieldsValue({ sellPrice: chosen.sellPrice });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  const manualPrice = Form.useWatch('sellPrice', form);
  const metrics = useMemo(() => {
    if (!selected) return null;
    const all = form.getFieldsValue(true);
    const price = manualPrice != null ? Number(manualPrice) : selected.sellPrice;
    return localMetrics(
      price,
      Number(all.purchaseCost || 0),
      selected.shippingFee,
      Number(all.labelFee || 0),
      Number(all.commissionRate || 0) / 100,
      Number(all.agentRate || 0) / 100,
      Number(all.withdrawRate || 0) / 100,
    );
  }, [selected, manualPrice, form]);

  // ---------------- 保存 ----------------
  const save = async () => {
    if (!selected) {
      message.warning('请先点「算定价」');
      return;
    }
    const all = form.getFieldsValue(true);
    setSaving(true);
    try {
      await http.post('/pricing/records', {
        name: all.name || null,
        sku: all.sku || null,
        purchaseCost: Number(all.purchaseCost || 0),
        weightKg: Number(all.weightKg || 0),
        lengthCm: Number(all.lengthCm || 0),
        widthCm: Number(all.widthCm || 0),
        heightCm: Number(all.heightCm || 0),
        sellPrice: manualPrice != null ? Number(manualPrice) : selected.sellPrice,
        sellPriceRub: Number((((manualPrice != null ? Number(manualPrice) : selected.sellPrice) / Number(all.exchangeRate || 0.0862)).toFixed(2))),
        exchangeRate: Number(all.exchangeRate || 0.0862),
        labelFee: Number(all.labelFee || 0),
        commissionRate: Number(all.commissionRate || 0) / 100,
        agentRate: Number(all.agentRate || 0) / 100,
        withdrawRate: Number(all.withdrawRate || 0) / 100,
        markupRate: Number(all.markupRate || 0) / 100,
        country: all.country,
        vendor: all.vendor,
        channelId: selected.channelId,
        channelName: selected.name,
        shipMode: selected.shipMode,
        logistics: selected.delivery || selected.shipMode,
        shippingFee: selected.shippingFee,
        billWeightKg: selected.billWeightKg,
        supplyUrl: all.supplyUrl || null,
        retailUrl: all.retailUrl || null,
        remark: all.remark || null,
        imageUrl: all.imageUrl || null,
        categoryPath: all.categoryPath || null,
        offer1688Title: all.offer1688Title || null,
        weightSource: all.weightSource || null,
      });
      message.success('已生成到定价表');
      onSaved?.();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const channelOptions = useMemo(
    () =>
      (calc?.list || []).map((r: any) => ({
        value: r.channelId,
        label: r.ok
          ? `${r.name} · 运费 ¥${money(r.shippingFee)} · 建议 ¥${r.suggestedSellPrice}`
          : `${r.name} · 不可用（${r.reason}）`,
      })),
    [calc],
  );

  return (
    <Row gutter={16}>
      <Col span={14}>
        <Card size="small" title="① 选品：从商品库挑要定价的商品">
          <Space style={{ width: '100%' }} direction="vertical">
            <Space wrap>
              <Input
                placeholder="Ozon SKU 或标题关键词"
                value={kw}
                onChange={(e) => setKw(e.target.value)}
                style={{ width: 280 }}
                onPressEnter={searchProducts}
              />
              <Button icon={<SearchOutlined />} loading={picking} onClick={searchProducts}>
                搜索商品库
              </Button>
              <Button
                type="primary"
                ghost
                icon={<ThunderboltOutlined />}
                loading={autoRunning}
                disabled={!product}
                onClick={() => product && autoRun(product)}
                title="关键词搜 1688 同款 → 抓价格与包装信息 → 自动算定价（纯 HTTP，秒级）"
              >
                一键自动核价
              </Button>
            </Space>

            <Space wrap>
              <span style={{ fontSize: 12, color: '#666' }}>1688 搜款关键词：</span>
              <Input
                placeholder="用商品的中文类目名，如「儿童泡泡机」"
                value={searchKw}
                onChange={(e) => setSearchKw(e.target.value)}
                style={{ width: 260 }}
                onPressEnter={() => searchByKeyword()}
              />
              <Button icon={<SearchOutlined />} loading={searching} onClick={() => searchByKeyword()}>
                1688 搜同款
              </Button>
              {cookie?.hasCookie ? (
                <Tag color="green">
                  1688 登录态已就绪（{cookie.cookieCount} 条）
                  {cookie.syncedAt ? ` · ${new Date(cookie.syncedAt).toLocaleString('zh-CN')}` : ''}
                </Tag>
              ) : (
                <Tag color="orange">1688 登录态未同步</Tag>
              )}
              <Button size="small" loading={syncing} onClick={syncCookie}>
                同步 1688 登录态
              </Button>
              <Button size="small" onClick={() => setCookieOpen(true)}>
                粘贴 Cookie
              </Button>
              <Tooltip title="以图搜款更准：系统在调试 Chrome 里打开 1688 图搜页并自动把商品主图放进上传框、自动点「搜索图片」，然后回这里点「读取浏览器里的结果」把货源接回来（价格/包装仍是 HTTP 秒抓）">
                <Button
                  size="small"
                  icon={<ThunderboltOutlined />}
                  loading={searching}
                  onClick={imageSearch}
                  disabled={!product && !form.getFieldValue('imageUrl')}
                >
                  以图搜款（更准）
                </Button>
              </Tooltip>
              <Button size="small" loading={searching} onClick={scanTabs}>
                读取浏览器里的结果
              </Button>
              <Tooltip title="把商品主图复制到剪贴板，然后到调试 Chrome 的 1688 图搜页按 Ctrl+V 粘贴">
                <Button size="small" icon={<CopyOutlined />} loading={copying} onClick={copyProductImage}>
                  复制图片
                </Button>
              </Tooltip>
            </Space>
            {product ? (
              <Card size="small" style={{ background: '#fafafa' }}>
                <Space align="start">
                  {product.imageUrl ? (
                    <Tooltip title="点击复制图片">
                      <img
                        src={proxyImage(product.imageUrl)}
                        alt=""
                        onClick={copyProductImage}
                        style={{ width: 88, height: 88, objectFit: 'cover', borderRadius: 4, cursor: 'copy' }}
                      />
                    </Tooltip>
                  ) : (
                    <Button size="small" onClick={ensureImage}>
                      抓商品主图
                    </Button>
                  )}
                  <div style={{ maxWidth: 460 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>
                      {product.sku} · ¥{money((product.priceRub || 0) * (settings?.exchangeRate || 0.0862))} / ₽{money(product.priceRub, 0)}
                    </div>
                    <div style={{ fontSize: 12, color: '#666' }}>{product.title}</div>
                    <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                      {product.categoryPath || '-'} · 月销 {product.soldCount ?? '-'} · 上架 {product.createDays ?? '-'} 天
                      {product.salesSchema ? ` · ${product.salesSchema}` : ''}
                    </div>
                  </div>
                </Space>
              </Card>
            ) : (
              <Alert
                type="info"
                showIcon
                message="从商品库选品后，可一键用商品主图去 1688 以图搜款（需在「浏览器接管」里启动 Chrome 并登录 1688）；没图时会自动先抓 Ozon 主图。"
              />
            )}
          </Space>
        </Card>

        {autoLog.length ? (
          <Card size="small" title="自动核价进度" style={{ marginTop: 12 }}>
            <Space direction="vertical" size={2} style={{ width: '100%' }}>
              {autoLog.map((l, i) => (
                <div key={i} style={{ fontSize: 12, color: l.startsWith('❌') ? '#cf1322' : l.startsWith('⚠') ? '#d46b08' : '#666' }}>
                  {l}
                </div>
              ))}
            </Space>
          </Card>
        ) : null}

        {tabs.length ? (
          <Card size="small" title="浏览器里的 1688 页面" style={{ marginTop: 12 }}>
            <Space direction="vertical" size={2} style={{ width: '100%' }}>
              {[...new Set(tabs)].slice(0, 6).map((t, i) => (
                <a key={i} href={t} target="_blank" rel="noreferrer" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                  {t.slice(0, 130)}
                </a>
              ))}
              <div style={{ fontSize: 12, color: '#999' }}>
                在浏览器里挑好货源后，把 detail.1688.com/offer/… 链接粘到下面「1688 货源链接」，点右侧「抓取 1688 价格/包装信息」即可。
              </div>
            </Space>
          </Card>
        ) : null}

        {tabs.length ? (
          <Card size="small" title="浏览器里的 1688 页面" style={{ marginTop: 12 }}>
            <Space direction="vertical" size={2} style={{ width: '100%' }}>
              {[...new Set(tabs)].slice(0, 6).map((t, i) => (
                <a key={i} href={t} target="_blank" rel="noreferrer" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                  {t.slice(0, 130)}
                </a>
              ))}
              <div style={{ fontSize: 12, color: '#999' }}>
                在浏览器里挑好货源后，把 detail.1688.com/offer/… 链接粘到下面「1688 货源链接」，点右侧「抓取 1688 价格/包装信息」即可。
              </div>
            </Space>
          </Card>
        ) : null}

        <Card size="small" title="② 货源与包裹" style={{ marginTop: 12 }}>
          <Form form={form} layout="vertical" size="small">
            <Row gutter={12}>
              <Col span={16}>
                <Form.Item name="supplyUrl" label="1688 货源链接">
                  <Input placeholder="https://detail.1688.com/offer/xxx.html" />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item label=" ">
                  <Button block loading={fetchingOffer} onClick={() => fetchOffer(form.getFieldValue('supplyUrl'))}>
                    抓取 1688 价格/包装信息
                  </Button>
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col span={6}>
                <Form.Item name="purchaseCost" label="采购成本 ¥" rules={[{ required: true }]}>
                  <InputNumber style={{ width: '100%' }} min={0} precision={2} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="weightKg" label="重量 kg" rules={[{ required: true }]}>
                  <InputNumber style={{ width: '100%' }} min={0} precision={4} step={0.01} />
                </Form.Item>
              </Col>
              <Col span={4}>
                <Form.Item name="lengthCm" label="长 cm" rules={[{ required: true }]}>
                  <InputNumber style={{ width: '100%' }} min={0} precision={2} />
                </Form.Item>
              </Col>
              <Col span={4}>
                <Form.Item name="widthCm" label="宽 cm">
                  <InputNumber style={{ width: '100%' }} min={0} precision={2} />
                </Form.Item>
              </Col>
              <Col span={4}>
                <Form.Item name="heightCm" label="高 cm">
                  <InputNumber style={{ width: '100%' }} min={0} precision={2} />
                </Form.Item>
              </Col>
            </Row>
            {offer?.warnings?.length ? (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                message="部分信息未自动抓到"
                description={
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {offer.warnings.map((w: string, i: number) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                }
              />
            ) : null}
            <Row gutter={12}>
              <Col span={6}>
                <Form.Item name="country" label="国家">
                  <Select options={COUNTRIES} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="vendor" label="物流商">
                  <Select options={VENDORS} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="channelId" label="物流渠道（算价后可切换对比）">
                  <Select
                    allowClear
                    placeholder={calc ? `可用 ${calc.available} / 共 ${calc.total} 条` : '先点「算定价」'}
                    options={channelOptions}
                    value={channelId ?? undefined}
                    onChange={(v) => {
                      setChannelId(v ?? null);
                      if (v) runPrice(v);
                    }}
                  />
                </Form.Item>
              </Col>
            </Row>
            <Divider orientation="left" plain style={{ margin: '4px 0' }}>
              费率（默认取参数设置）
            </Divider>
            <Row gutter={12}>
              <Col span={4}>
                <Form.Item name="markupRate" label="成本加价 %" tooltip="定价 =（成本×(1+加价率) + 运费 + 贴单费）÷（1−佣金−代理佣金）">
                  <InputNumber style={{ width: '100%' }} min={0} max={300} precision={2} />
                </Form.Item>
              </Col>
              <Col span={4}>
                <Form.Item name="labelFee" label="贴单费 ¥">
                  <InputNumber style={{ width: '100%' }} min={0} precision={2} />
                </Form.Item>
              </Col>
              <Col span={4}>
                <Form.Item name="commissionRate" label="平台佣金 %">
                  <InputNumber style={{ width: '100%' }} min={0} max={100} precision={2} />
                </Form.Item>
              </Col>
              <Col span={4}>
                <Form.Item name="agentRate" label="代理佣金 %">
                  <InputNumber style={{ width: '100%' }} min={0} max={100} precision={2} />
                </Form.Item>
              </Col>
              <Col span={4}>
                <Form.Item name="withdrawRate" label="提现费率 %">
                  <InputNumber style={{ width: '100%' }} min={0} max={100} precision={2} />
                </Form.Item>
              </Col>
              <Col span={4}>
                <Form.Item name="exchangeRate" label="汇率 ₽→¥">
                  <InputNumber style={{ width: '100%' }} min={0} precision={6} step={0.0001} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item name="priceRub" label="货值（卢布，用于渠道限制判断）">
                  <InputNumber style={{ width: '100%' }} min={0} precision={0} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="name" label="产品备注">
                  <Input />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item label=" ">
                  <Space>
                    <Button type="primary" loading={calculating} onClick={() => runPrice(null)}>
                      算定价
                    </Button>
                    <Button icon={<SaveOutlined />} loading={saving} onClick={save} disabled={!selected}>
                      保存记录
                    </Button>
                  </Space>
                </Form.Item>
              </Col>
            </Row>
            {/* 隐藏字段：随记录一起保存 */}
            <Form.Item name="sku" hidden><Input /></Form.Item>
            <Form.Item name="imageUrl" hidden><Input /></Form.Item>
            <Form.Item name="categoryPath" hidden><Input /></Form.Item>
            <Form.Item name="offer1688Title" hidden><Input /></Form.Item>
            <Form.Item name="weightSource" hidden><Input /></Form.Item>
            <Form.Item name="retailUrl" hidden><Input /></Form.Item>
            <Form.Item name="sellPrice" hidden><InputNumber /></Form.Item>
            <Form.Item name="remark" hidden><Input /></Form.Item>
          </Form>
        </Card>
      </Col>

      <Col span={10}>
        <Card size="small" title="③ 定价结果">
          {!selected ? (
            <Empty description="填好成本/重量/尺寸后点「算定价」" />
          ) : (
            <Space direction="vertical" style={{ width: '100%' }} size={12}>
              <Descriptions size="small" column={2} bordered>
                <Descriptions.Item label="渠道">{selected.name}</Descriptions.Item>
                <Descriptions.Item label="物流方式">{selected.delivery || selected.shipMode || '-'}</Descriptions.Item>
                <Descriptions.Item label="计费重">{money(selected.billWeightKg, 3)} kg</Descriptions.Item>
                <Descriptions.Item label="国际运费">¥{money(selected.shippingFee)}</Descriptions.Item>
                <Descriptions.Item label="资费">
                  {selected.pricePerKg}元/kg + {selected.pricePerOrder}元/票
                </Descriptions.Item>
                <Descriptions.Item label="时效">{selected.etaDays || '-'}</Descriptions.Item>
              </Descriptions>

              <Row gutter={8}>
                <Col span={12}>
                  <Card size="small">
                    <Statistic title="建议定价" value={selected.suggestedSellPrice} prefix="¥" precision={0} />
                    <div style={{ fontSize: 12, color: '#888' }}>₽{money(selected.suggestedSellPriceRub, 0)}</div>
                  </Card>
                </Col>
                <Col span={12}>
                  <Card size="small">
                    <Statistic
                      title="实际定价（可改）"
                      value={manualPrice != null ? Number(manualPrice) : selected.sellPrice}
                      prefix="¥"
                      precision={2}
                    />
                    <InputNumber
                      size="small"
                      style={{ width: '100%', marginTop: 4 }}
                      min={0}
                      precision={2}
                      value={manualPrice != null ? Number(manualPrice) : selected.sellPrice}
                      onChange={(v) => form.setFieldsValue({ sellPrice: v ?? 0 })}
                    />
                  </Card>
                </Col>
              </Row>

              <Row gutter={8}>
                <Col span={8}>
                  <Card size="small">
                    <Statistic title="毛利润" value={metrics?.grossProfit ?? 0} prefix="¥" precision={2} />
                  </Card>
                </Col>
                <Col span={8}>
                  <Card size="small">
                    <Statistic title="净利润" value={metrics?.netProfit ?? 0} prefix="¥" precision={2} />
                  </Card>
                </Col>
                <Col span={8}>
                  <Card size="small">
                    <Statistic title="加 35%" value={metrics?.markup35 ?? 0} prefix="¥" precision={2} />
                  </Card>
                </Col>
              </Row>
              <Row gutter={8}>
                <Col span={12}>
                  <Card size="small">
                    <Statistic title="利润率（净利/成本）" value={metrics?.profitRate ?? 0} suffix="%" precision={2} />
                  </Card>
                </Col>
                <Col span={12}>
                  <Card size="small">
                    <Statistic title="运费利润比（净利/运费）" value={metrics?.freightProfitRatio ?? 0} suffix="%" precision={2} />
                  </Card>
                </Col>
              </Row>

              <Alert
                type={selected.ok ? 'success' : 'warning'}
                showIcon
                message={
                  selected.ok
                    ? `定价 ¥${manualPrice != null ? Number(manualPrice) : selected.sellPrice} =（成本 ¥${money(form.getFieldValue('purchaseCost'))} ×(1+${form.getFieldValue('markupRate')}%) + 运费 ¥${money(selected.shippingFee)} + 贴单 ¥${money(form.getFieldValue('labelFee'))}）÷ (1−${form.getFieldValue('commissionRate')}%−${form.getFieldValue('agentRate')}%)`
                    : `渠道不可用：${selected.reason}`
                }
              />
            </Space>
          )}
        </Card>

        {calc?.list?.length ? (
          <Card size="small" title="④ 渠道对比（点行选用）" style={{ marginTop: 12 }}>
            <Table
              size="small"
              rowKey="channelId"
              pagination={false}
              scroll={{ y: 320 }}
              dataSource={calc.list}
              onRow={(r: any) => ({
                onClick: () => {
                  setChannelId(r.channelId);
                  form.setFieldsValue({ sellPrice: r.sellPrice });
                },
                style: { cursor: 'pointer', background: r.channelId === (channelId ?? calc.best?.channelId) ? '#e6f4ff' : undefined },
              })}
              columns={[
                { title: '渠道', dataIndex: 'name', width: 190, render: (v: string, r: any) => <Tooltip title={v}><span>{v}</span></Tooltip> },
                { title: '运费', dataIndex: 'shippingFee', width: 70, render: (v: any) => `¥${money(v)}` },
                { title: '建议定价', dataIndex: 'suggestedSellPrice', width: 80, render: (v: any, r: any) => `¥${v} / ₽${money(r.suggestedSellPriceRub, 0)}` },
                { title: '净利', dataIndex: 'netProfit', width: 62, render: (v: any) => money(v) },
                { title: '利润率', dataIndex: 'profitRate', width: 66, render: (v: any) => pct(v) },
                {
                  title: '状态',
                  dataIndex: 'ok',
                  width: 80,
                  render: (v: boolean, r: any) => (v ? <Tag color="green">可用</Tag> : <Tag color="red">{r.reason}</Tag>),
                },
              ]}
            />
          </Card>
        ) : null}
      </Col>

      {/* 选品弹窗 */}
      <Modal
        open={pickOpen}
        onCancel={() => setPickOpen(false)}
        footer={null}
        title="选择商品"
        width={860}
      >
        <Table
          size="small"
          rowKey="sku"
          dataSource={products}
          pagination={false}
          scroll={{ y: 420 }}
          onRow={(r: any) => ({ onClick: () => pickProduct(r), style: { cursor: 'pointer' } })}
          columns={[
            {
              title: '图',
              dataIndex: 'imageUrl',
              width: 60,
              render: (v: string) => (v ? <img src={v} alt="" style={{ width: 44, height: 44, objectFit: 'cover' }} /> : null),
            },
            { title: 'SKU', dataIndex: 'sku', width: 110 },
            { title: '标题', dataIndex: 'title', ellipsis: true },
            { title: '售价₽', dataIndex: 'priceRub', width: 80, render: (v: any) => money(v, 0) },
            { title: '月销', dataIndex: 'soldCount', width: 64 },
            { title: '加购率', dataIndex: 'convToCartPdp', width: 74, render: (v: any) => (v != null ? `${money(v, 1)}%` : '-') },
            { title: '退货率', dataIndex: 'cancelRate', width: 74, render: (v: any) => (v != null ? `${money(v, 1)}%` : '-') },
            { title: '上架天', dataIndex: 'createDays', width: 70 },
            {
              title: '尺寸cm',
              width: 110,
              render: (_: any, r: any) => (r.lengthCm ? `${r.lengthCm}×${r.widthCm}×${r.heightCm}` : '-'),
            },
            {
              title: '重量',
              width: 70,
              render: (_: any, r: any) => (r.weightKg ? `${money(r.weightKg, 3)}kg` : '-'),
            },
          ]}
        />
      </Modal>

      {/* 手动粘贴 1688 Cookie */}
      <Modal
        open={cookieOpen}
        onCancel={() => setCookieOpen(false)}
        onOk={saveCookie}
        okText="保存 Cookie"
        confirmLoading={syncing}
        title="粘贴 1688 Cookie（一次即可，之后全程走 HTTP）"
        width={720}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="怎么复制："
          description={
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              <li>在 Chrome 里打开并登录 <b>www.1688.com</b>（确保是已登录状态）</li>
              <li>按 <b>F12</b> 打开开发者工具，切到 <b>Network（网络）</b> 面板</li>
              <li>地址栏回车刷新页面，在请求列表里随便点一条 <b>www.1688.com</b> 的请求（一般是最上面那条 document）</li>
              <li>右侧找到 <b>Request Headers（请求标头）</b> → <b>Cookie</b>，右键 → Copy value（复制值）</li>
              <li>把它整段粘到下面，点保存</li>
            </ol>
          }
        />
        <Input.TextArea
          rows={8}
          value={cookieText}
          onChange={(e) => setCookieText(e.target.value)}
          placeholder="把整段 Cookie 粘到这里，例如：cookie2=xxxx; _m_h5_tk=xxxx_1234; unb=123456; ..."
        />
        <div style={{ fontSize: 12, color: '#999', marginTop: 8 }}>
          也支持点上面的「同步 1688 登录态」：从「浏览器接管」的调试 Chrome 里直接读一次（只读 cookie，不渲染页面，0.15 秒）。
          Cookie 失效后搜款会提示，重新做一次即可（一般能管几周到几个月）。
        </div>
      </Modal>

      {/* 手动粘贴 1688 Cookie */}
      <Modal
        open={cookieOpen}
        onCancel={() => setCookieOpen(false)}
        onOk={saveCookie}
        okText="保存 Cookie"
        confirmLoading={syncing}
        title="粘贴 1688 Cookie（一次即可，之后全程走 HTTP）"
        width={720}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="怎么复制："
          description={
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              <li>在 Chrome 里打开并登录 <b>www.1688.com</b>（确保是已登录状态）</li>
              <li>按 <b>F12</b> 打开开发者工具，切到 <b>Network（网络）</b> 面板</li>
              <li>地址栏回车刷新页面，在请求列表里随便点一条 <b>www.1688.com</b> 的请求（一般是最上面那条 document）</li>
              <li>右侧找到 <b>Request Headers（请求标头）</b> → <b>Cookie</b>，右键 → Copy value（复制值）</li>
              <li>把它整段粘到下面，点保存</li>
            </ol>
          }
        />
        <Input.TextArea
          rows={8}
          value={cookieText}
          onChange={(e) => setCookieText(e.target.value)}
          placeholder="把整段 Cookie 粘到这里，例如：cookie2=xxxx; _m_h5_tk=xxxx_1234; unb=123456; ..."
        />
        <div style={{ fontSize: 12, color: '#999', marginTop: 8 }}>
          也支持点上面的「同步 1688 登录态」：从「浏览器接管」的调试 Chrome 里直接读一次（只读 cookie，不渲染页面，0.15 秒）。
          Cookie 失效后搜款会提示，重新做一次即可（一般能管几周到几个月）。
        </div>
      </Modal>

      {/* 以图搜款结果 */}
      <Modal open={resultOpen} onCancel={() => setResultOpen(false)} footer={null} title="1688 以图搜款结果" width={900}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {results.map((it: any) => (
            <Card
              key={it.offerId}
              hoverable
              size="small"
              style={{ width: 200 }}
              cover={
                it.imageUrl ? <img alt="" src={it.imageUrl.startsWith('//') ? `https:${it.imageUrl}` : it.imageUrl} style={{ height: 150, objectFit: 'cover' }} /> : null
              }
              onClick={() => chooseOffer(it)}
              actions={[
                <Button key="pick" type="link" size="small" onClick={() => chooseOffer(it)}>
                  选这个
                </Button>,
              ]}
            >
              <div style={{ fontSize: 12, height: 36, overflow: 'hidden' }}>{it.title}</div>
              <div style={{ color: '#cf1322', fontWeight: 600 }}>{it.price != null ? `¥${it.price}` : '价格未抓到'}</div>
              <div style={{ fontSize: 11, color: '#888' }}>
                {it.salesText ? `成交 ${it.salesText}` : ''} {it.repurchase ? `· 复购 ${it.repurchase}` : ''}
                {it.shop ? ` · ${it.shop}` : ''}
              </div>
              <div style={{ fontSize: 11, color: '#999' }}>
                <LinkOutlined /> {it.offerId}
              </div>
            </Card>
          ))}
        </div>
      </Modal>
    </Row>
  );
}
