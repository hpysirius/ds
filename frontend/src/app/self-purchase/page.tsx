'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  Descriptions,
  Divider,
  Drawer,
  Dropdown,
  Form,
  Image,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  CalculatorOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  LinkOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { downloadFile, http, proxyImageUrl } from '@/lib/api';
import { useStore } from '@/lib/store-context';

/**
 * 自采购（选购备忘录）
 *
 * 与「商品库 / 跟单比价」完全分开的一张独立表：
 * 自己看中什么好卖就记一笔，存 1688 货源链接 + 采购成本 + 规格，
 * 不做 Ozon 跟卖 / 竞品比价；「算物流、算定价」直接复用核价引擎 POST /pricing/price。
 */

const COUNTRIES = [
  { value: 'RU', label: '俄罗斯' },
  { value: 'BY', label: '白俄罗斯' },
  { value: 'KZ', label: '哈萨克斯坦' },
  { value: 'KG', label: '吉尔吉斯斯坦' },
];

const VENDORS = [
  { value: 'GUOO', label: 'GUOO' },
  { value: 'XY', label: '兴远 XY' },
];

function money(v?: number | null, cur = '¥'): string {
  if (v == null) return '-';
  return `${cur}${Number(v).toFixed(2)}`;
}

/** profitRate 存的是比率（0.35 = 35%） */
function pct(v?: number | null): string {
  if (v == null) return '-';
  return `${(Number(v) * 100).toFixed(1)}%`;
}

/** 运费利润比 = 净利润 / 国际运费（与核价引擎同口径，列表里现算） */
function freightProfitRatio(r: any): number | null {
  const fee = Number(r?.shippingFee);
  const net = Number(r?.netProfit);
  if (!Number.isFinite(fee) || fee <= 0 || !Number.isFinite(net)) return null;
  return net / fee;
}

/** 加 35% 参考价 = 定价 / 0.65（与核价引擎同口径） */
function markup35(r: any): number | null {
  const p = Number(r?.sellPrice);
  if (!Number.isFinite(p) || p <= 0) return null;
  return p / 0.65;
}

/**
 * 从 Ozon 链接里解析 SKU（与后端 self-purchase.service 的 extractOzonSku 同逻辑）。
 * SKU 是这条记录关联 Ozon ↔ 1688 的唯一标识，能自动带出就不让人手填。
 * 支持 ?sku=xxx / /product/3920720492/ / /product/xxx-3920720492/
 */
function extractOzonSku(url?: string): string | null {
  const raw = String(url || '').trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const q = u.searchParams.get('sku');
    if (q && /^\d{4,20}$/.test(q)) return q;
    const seg = (u.pathname || '').split('/').filter(Boolean).pop() || '';
    const m = seg.match(/(\d{4,20})$/);
    if (m) return m[1];
  } catch (e) {
    /* 不是完整 URL，走下面兜底 */
  }
  const q2 = raw.match(/[?&]sku=(\d{4,20})/);
  if (q2) return q2[1];
  const seg2 = raw.replace(/[?#].*$/, '').split('/').filter(Boolean).pop() || '';
  const m2 = seg2.match(/(\d{4,20})$/);
  return m2 ? m2[1] : null;
}

function specText(r: any): string {
  const w = r.weightText || (r.weightKg != null ? `${r.weightKg}kg` : '');
  const s =
    r.sizeText ||
    (r.lengthCm || r.widthCm || r.heightCm
      ? `${r.lengthCm ?? 0}×${r.widthCm ?? 0}×${r.heightCm ?? 0}`
      : '');
  return [w, s].filter(Boolean).join(' / ') || '-';
}

/** 上架状态：值 → 中文 / 颜色 */
const STATUS_META: Record<string, { label: string; color: string }> = {
  editing: { label: '编辑中', color: 'blue' },
  listed: { label: '已上架', color: 'green' },
  delisted: { label: '已下架', color: 'default' },
};
const STATUS_OPTIONS = (Object.keys(STATUS_META) as string[]).map((v) => ({
  value: v,
  label: STATUS_META[v].label,
}));

/** 复制一段文本到剪贴板（复用 Ozon 后台粘贴） */
async function copyText(text: string, label = '文案') {
  const t = String(text || '').trim();
  if (!t) {
    message.warning(`${label}还是空的，没得复制`);
    return;
  }
  try {
    await navigator.clipboard.writeText(t);
    message.success(`${label}已复制，去 Ozon 后台粘贴即可`);
  } catch (e) {
    message.error('复制失败：浏览器拒绝了剪贴板，请手动选中复制');
  }
}

/** 把一条记录的俄语文案拼成可整块粘贴的文本 */
function copyBlock(r: any): string {
  return [r.titleRu, r.descRu, r.tagsRu]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join('\n\n');
}

/** 时间戳短格式（留痕展示用） */
function fmtTime(v?: string | null): string {
  if (!v) return '-';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '-';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function SelfPurchasePage() {
  const { storeParam } = useStore();
  const [form] = Form.useForm();

  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);

  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);

  const [calc, setCalc] = useState<any | null>(null);
  const [calcLoading, setCalcLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await http.get('/self-purchase', {
        params: { page, pageSize, keyword: keyword || undefined, status, ...storeParam },
      });
      setRows(Array.isArray(data?.list) ? data.list : []);
      setTotal(data?.total || 0);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, status, storeParam]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setCalc(null);
    form.resetFields();
    form.setFieldsValue({ country: 'RU', vendor: 'GUOO', markupRate: 0.1, status: 'editing' });
    setOpen(true);
  };

  const openEdit = (r: any) => {
    setEditing(r);
    setCalc(null);
    form.resetFields();
    form.setFieldsValue({
      ...r,
      country: r.country || 'RU',
      vendor: r.vendor || 'GUOO',
      markupRate: r.markupRate ?? 0.1,
    });
    setOpen(true);
  };

  /**
   * 算定价：调后端 POST /self-purchase/price-preview（内部复用核价引擎 PricingService.price）。
   *
   * 两遍算价、货值收敛等逻辑都在后端，这里只管把表单值发过去、把结果回填，避免前后端两套算法漂移。
   * 落库时后端也用同一套逻辑自动算价，所以这里主要用于「改参数后预览 / 手填定价试算」。
   */
  const calcPrice = async () => {
    const v = form.getFieldsValue();
    if (!Number(v.weightKg || 0)) {
      message.warning('请先填写重量（kg），否则算不出国际运费');
      return;
    }
    setCalcLoading(true);
    try {
      const { data } = await http.post('/self-purchase/price-preview', v);
      const best = data?.best || null;

      setCalc(best);
      if (!best) {
        message.warning('没有可用物流渠道：检查重量 / 尺寸是否超出渠道限制');
        return;
      }
      if (best.ok === false) {
        message.warning(`渠道「${best.name}」不完全匹配（${best.reason || '受限制'}），结果仅供参考`);
      }

      form.setFieldsValue({
        sellPrice: best.sellPrice,
        sellPriceRub: best.sellPriceRub,
        shippingFee: best.shippingFee,
        billWeightKg: best.billWeightKg,
        grossProfit: best.grossProfit,
        netProfit: best.netProfit,
        profitRate: best.profitRate,
        markupRate: v.markupRate,
        channelId: best.channelId,
        channelName: best.name,
        shipMode: best.shipMode,
      });
      message.success(
        best.ok === false
          ? `已算价（渠道「${best.name}」受限，仅供参考）`
          : `已按「${best.name}」算出定价`,
      );
    } catch (e: any) {
      message.error(e?.response?.data?.message || '算价失败');
    } finally {
      setCalcLoading(false);
    }
  };

  const save = async () => {
    let v: any;
    try {
      v = await form.validateFields();
    } catch (e) {
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await http.patch(`/self-purchase/${editing.id}`, v);
        message.success('已保存');
      } else {
        // 超管切了具体店铺时，把条目落到该店（storeParam = { storeId } 或 {}）
        const { data } = await http.post('/self-purchase', { ...v, ...storeParam });
        if (data?.merged) {
          // 同 SKU 已存在 → 后端合并进那条，而不是新建
          message.success('该 SKU 已有记录，本次已合并进去（只补空字段，不覆盖原值）', 5);
        } else {
          // 后端只要有成本 + 重量就会自动算价，这里给个反馈
          message.success(
            data?.sellPrice != null ? '已保存，并已自动算出物流费与定价' : '已保存',
          );
        }
      }
      setOpen(false);
      setEditing(null);
      setCalc(null);
      load();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await http.delete(`/self-purchase/${id}`);
      message.success('已删除');
      load();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '删除失败');
    }
  };

  /** 行内改上架状态：编辑中 → 已上架 → 已下架（后端自动留痕 listedAt / statusAt） */
  const changeStatus = async (r: any, next: string) => {
    if (next === r.status) return;
    try {
      await http.patch(`/self-purchase/${r.id}`, { status: next });
      message.success(`已改为「${STATUS_META[next]?.label || next}」`);
      load();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '改状态失败');
    }
  };

  /** 导出 CSV：带上当前搜索 / 状态筛选，与列表保持一致 */
  const exportCsv = async () => {
    try {
      await downloadFile('/self-purchase/export', 'self-purchase.csv', {
        keyword: keyword || undefined,
        status,
        ...storeParam,
      });
      message.success('已导出 CSV');
    } catch (e: any) {
      message.error(e?.message || '导出失败');
    }
  };

  const columns: any[] = [
    // 产品：图 + 名称 + SKU + 来源（对齐「定价记录」页的「产品」列）
    {
      title: '产品',
      key: 'product',
      width: 210,
      fixed: 'left',
      render: (_: any, r: any) => (
        <Space size={8} align="start">
          {r.imageUrl ? (
            <Image src={proxyImageUrl(r.imageUrl)} width={36} height={36} style={{ objectFit: 'cover', borderRadius: 3 }} />
          ) : null}
          <div>
            <div>{r.name || '(未命名)'}</div>
            <div style={{ fontSize: 11, color: '#999' }}>
              {r.sku ? (
                <Typography.Text copyable={{ text: r.sku }} style={{ fontFamily: 'monospace', fontSize: 11 }}>
                  {r.sku}
                </Typography.Text>
              ) : (
                '未关联'
              )}
            </div>
            <Tag color={r.source === 'plugin' ? 'green' : 'default'} style={{ margin: '2px 0 0', fontSize: 11 }}>
              {r.source === 'plugin' ? '插件记录' : '手动录入'}
            </Tag>
          </div>
        </Space>
      ),
    },
    {
      title: '物流渠道',
      dataIndex: 'channelName',
      width: 200,
      render: (v?: string, r?: any) => v || r?.logistics || '-',
    },
    {
      title: '定价(¥)',
      key: 'price',
      width: 120,
      render: (_: any, r: any) => (
        <Space direction="vertical" size={0}>
          <span>{money(r.sellPrice, '¥')}</span>
          <span style={{ color: '#8c8c8c' }}>{money(r.sellPriceRub, '₽')}</span>
        </Space>
      ),
    },
    {
      title: '跟卖价(₽)',
      key: 'retailPrice',
      width: 120,
      render: (_: any, r: any) =>
        r.retailPriceRub != null || r.retailPriceCny != null ? (
          <Space direction="vertical" size={0}>
            <span>{money(r.retailPriceCny, '¥')}</span>
            <span style={{ color: '#8c8c8c' }}>{money(r.retailPriceRub, '₽')}</span>
          </Space>
        ) : (
          <span style={{ color: '#bbb' }}>-</span>
        ),
    },
    {
      title: '国际运费',
      dataIndex: 'shippingFee',
      width: 90,
      render: (v?: number) => money(v),
    },
    {
      title: '采购成本',
      dataIndex: 'purchaseCost',
      width: 90,
      render: (v?: number) => money(v),
    },
    {
      title: '毛利润',
      dataIndex: 'grossProfit',
      width: 90,
      render: (v?: number) => money(v),
    },
    {
      title: '净利润',
      dataIndex: 'netProfit',
      width: 100,
      render: (v?: number) => money(v),
    },
    {
      title: '利润率',
      dataIndex: 'profitRate',
      width: 80,
      render: (v?: number) => pct(v),
    },
    {
      title: '运费利润比',
      key: 'freightProfitRatio',
      width: 100,
      render: (_: any, r: any) => pct(freightProfitRatio(r)),
    },
    {
      title: '加35%',
      key: 'markup35',
      width: 90,
      render: (_: any, r: any) => money(markup35(r)),
    },
    {
      title: '重量',
      dataIndex: 'weightText',
      width: 90,
      render: (v: any, r: any) => v || `${money(r.weightKg)}kg`,
    },
    {
      title: '尺寸',
      key: 'size',
      width: 130,
      render: (_: any, r: any) => r.sizeText || `${r.lengthCm || 0}×${r.widthCm || 0}×${r.heightCm || 0}cm`,
    },
    {
      title: '链接',
      key: 'links',
      width: 110,
      render: (_: any, r: any) => (
        <Space size={4}>
          {r.retailUrl ? (
            <Button type="link" size="small" href={r.retailUrl} target="_blank" rel="noreferrer">
              Ozon
            </Button>
          ) : null}
          {r.supplyUrl ? (
            <Button type="link" size="small" href={r.supplyUrl} target="_blank" rel="noreferrer">
              1688
            </Button>
          ) : null}
          {!r.retailUrl && !r.supplyUrl ? <span style={{ color: '#bbb' }}>-</span> : null}
        </Space>
      ),
    },
    {
      title: '俄语文案',
      key: 'ru',
      width: 200,
      render: (_: any, r: any) => {
        if (!r.titleRu && !r.descRu && !r.tagsRu) {
          return <span style={{ color: '#bbb' }}>未填写</span>;
        }
        return (
          <Space direction="vertical" size={2} style={{ maxWidth: 190 }}>
            <Tooltip title={r.titleRu}>
              <span
                style={{
                  display: 'inline-block',
                  maxWidth: 190,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {r.titleRu || '(无标题)'}
              </span>
            </Tooltip>
            <Space size={4} wrap>
              {r.descRu ? (
                <Tag color="purple" style={{ margin: 0 }}>
                  内容
                </Tag>
              ) : null}
              {r.tagsRu ? (
                <Tag color="cyan" style={{ margin: 0 }}>
                  标签
                </Tag>
              ) : null}
              <Button
                type="link"
                size="small"
                style={{ padding: 0 }}
                icon={<CopyOutlined />}
                onClick={() => copyText(copyBlock(r), '俄语文案')}
              >
                复制
              </Button>
            </Space>
          </Space>
        );
      },
    },
    {
      title: '上架状态',
      dataIndex: 'status',
      width: 110,
      render: (s: string, r: any) => (
        <Tooltip
          title={`状态变更 ${fmtTime(r.statusAt)}｜上架 ${fmtTime(r.listedAt)}｜核价 ${fmtTime(r.pricedAt)}`}
        >
          <Dropdown
            trigger={['click']}
            menu={{
              items: STATUS_OPTIONS.map((o) => ({ key: o.value, label: o.label })),
              selectedKeys: [s || 'editing'],
              onClick: ({ key }) => changeStatus(r, key),
            }}
          >
            <Tag color={STATUS_META[s]?.color} style={{ cursor: 'pointer', margin: 0 }}>
              {STATUS_META[s]?.label || '编辑中'} ▾
            </Tag>
          </Dropdown>
        </Tooltip>
      ),
    },
    {
      title: '备注',
      dataIndex: 'remark',
      width: 160,
      ellipsis: true,
      render: (v?: string) => v || '-',
    },
    {
      title: '操作',
      key: 'op',
      width: 120,
      fixed: 'right',
      render: (_: any, r: any) => (
        <Space size={4}>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>
            编辑
          </Button>
          <Popconfirm title="确定删除这条自采购记录？" onConfirm={() => remove(r.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card
      title="自采购（选购备忘录）"
      extra={
        <Space>
          <Select
            allowClear
            placeholder="全部状态"
            style={{ width: 110 }}
            value={status}
            options={STATUS_OPTIONS}
            onChange={(v) => {
              setPage(1);
              setStatus(v);
            }}
          />
          <Input.Search
            allowClear
            placeholder="搜 SKU / 名称 / 链接 / 俄语标题"
            style={{ width: 240 }}
            onSearch={(v) => {
              setPage(1);
              setKeyword(v.trim());
            }}
          />
          <Button icon={<DownloadOutlined />} onClick={exportCsv}>
            导出 CSV
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            记一笔
          </Button>
        </Space>
      }
    >
      <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 12 }}>
        自采上架工作台：存 1688 货源链接 + 包装/重量 + 成本。<b>只要填了采购成本与重量，系统就会自动</b>
        算出物流费、定价、毛利/净利/利润率（跟「定价记录」同一套核价引擎，无需手动点按钮）；
        再补俄语标题 / 内容 / 标签，一键复制即可粘到 Ozon 后台。状态可标「编辑中 / 已上架 / 已下架」，
        右上角「导出 CSV」带走整张表。跟单比价仍在「商品库 / 定价工作台」。
      </div>

      <Table
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 2250 }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
      />

      <Drawer
        title={editing ? '编辑自采购条目' : '记一笔：自己想采购的品'}
        width={560}
        open={open}
        onClose={() => setOpen(false)}
        destroyOnClose
        extra={
          <Space>
            <Button icon={<CalculatorOutlined />} loading={calcLoading} onClick={calcPrice}>
              算定价
            </Button>
            <Button type="primary" loading={saving} onClick={save}>
              保存
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" initialValues={{ country: 'RU', vendor: 'GUOO', markupRate: 0.1 }}>
          <Space size={12} wrap style={{ display: 'flex' }}>
            <Form.Item
              name="sku"
              label="SKU（Ozon 商品 id）"
              tooltip="Ozon ↔ 1688 的关联标识。填了 Ozon 链接会自动解析出来，也可手填 / 手改"
              style={{ flex: '0 1 200px' }}
            >
              <Input placeholder="3920720492" allowClear />
            </Form.Item>
            <Form.Item name="name" label="商品名称 / 备注" style={{ flex: '1 1 260px' }}>
              <Input placeholder="如：B10007银 手链 / 羊年2027中号" />
            </Form.Item>
            <Form.Item name="status" label="上架状态" style={{ flex: '0 0 120px' }}>
              <Select options={STATUS_OPTIONS} />
            </Form.Item>
          </Space>
          <Form.Item name="supplyUrl" label="1688 货源链接">
            <Input placeholder="https://detail.1688.com/offer/xxx.html" />
          </Form.Item>
          <Form.Item name="retailUrl" label="Ozon 链接（选填，不参与比价；填了会自动解析 SKU）">
            <Input
              placeholder="https://www.ozon.ru/product/xxx-3920720492/"
              onChange={(e) => {
                const s = extractOzonSku(e.target.value);
                // 只在 SKU 还空着时自动补，别覆盖手填值
                if (s && !form.getFieldValue('sku')) form.setFieldsValue({ sku: s });
              }}
            />
          </Form.Item>
          <Form.Item name="imageUrl" label="商品图 URL（选填）">
            <Input placeholder="https://..." />
          </Form.Item>
          <Form.Item
            name="packageText"
            label="包装信息（1688 件重尺，插件抓取自动填）"
            tooltip="1688 商品详情里的「件重尺」，如 1件 0.35kg 30*20*5"
          >
            <Input placeholder="如：1件 0.35kg 30*20*5" />
          </Form.Item>

          <Divider orientation="left" plain>
            规格与成本
          </Divider>
          <Space size={12} wrap>
            <Form.Item name="purchaseCost" label="采购成本（元）">
              <InputNumber min={0} step={0.01} style={{ width: 130 }} />
            </Form.Item>
            <Form.Item name="weightKg" label="重量（kg）">
              <InputNumber min={0} step={0.001} style={{ width: 130 }} />
            </Form.Item>
            <Form.Item name="lengthCm" label="长（cm）">
              <InputNumber min={0} step={0.1} style={{ width: 100 }} />
            </Form.Item>
            <Form.Item name="widthCm" label="宽（cm）">
              <InputNumber min={0} step={0.1} style={{ width: 100 }} />
            </Form.Item>
            <Form.Item name="heightCm" label="高（cm）">
              <InputNumber min={0} step={0.1} style={{ width: 100 }} />
            </Form.Item>
          </Space>
          <Space size={12} wrap>
            <Form.Item
              name="retailPriceRub"
              label="Ozon 跟卖价（₽）"
              tooltip="Ozon 页面上的在售价，插件在 Ozon 商品页「取当前页 / 抓 Ozon 页」会自动带上（抓到的是 ¥ 时后端已按汇率折成 ₽）"
            >
              <InputNumber min={0} step={0.01} style={{ width: 140 }} />
            </Form.Item>
            <Form.Item
              name="retailPriceCny"
              label="跟卖价（元）"
              tooltip="同一价格的元口径；改卢布后保存会重新按汇率折算"
            >
              <InputNumber min={0} step={0.01} style={{ width: 130 }} />
            </Form.Item>
          </Space>
          <Space size={12} wrap>
            <Form.Item name="weightText" label="重量原文（选填）">
              <Input placeholder="如 300g / 10.5kg" style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="sizeText" label="尺寸原文（选填）">
              <Input placeholder="如 40*30*3" style={{ width: 160 }} />
            </Form.Item>
          </Space>

          <Divider orientation="left" plain>
            物流与加价
          </Divider>
          <Space size={12} wrap>
            <Form.Item name="country" label="国家">
              <Select options={COUNTRIES} style={{ width: 130 }} />
            </Form.Item>
            <Form.Item name="vendor" label="供应商">
              <Select options={VENDORS} style={{ width: 130 }} />
            </Form.Item>
            <Form.Item name="markupRate" label="成本加价率">
              <InputNumber min={0} step={0.01} style={{ width: 110 }} />
            </Form.Item>
            <Form.Item name="logistics" label="物流方式（选填）">
              <Input placeholder="陆空 / 陆运" style={{ width: 120 }} />
            </Form.Item>
          </Space>

          <Divider orientation="left" plain>
            核价结果（点右上角「算定价」自动填，可手改）
          </Divider>
          <Space size={12} wrap>
            <Form.Item name="shippingFee" label="国际运费（元）">
              <InputNumber min={0} step={0.01} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="sellPrice" label="定价（元）">
              <InputNumber min={0} step={0.01} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="sellPriceRub" label="定价（卢布）">
              <InputNumber min={0} step={0.01} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="netProfit" label="净利润">
              <InputNumber step={0.01} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="grossProfit" label="毛利润">
              <InputNumber step={0.01} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="profitRate" label="利润率（比率）">
              <InputNumber step={0.0001} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="billWeightKg" label="计费重量 kg">
              <InputNumber min={0} step={0.001} style={{ width: 120 }} />
            </Form.Item>
          </Space>
          {/* 这几个由算价回填，不在表单里编辑，但要随保存一起提交 */}
          <Form.Item name="channelId" hidden>
            <InputNumber />
          </Form.Item>
          <Form.Item name="channelName" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="shipMode" hidden>
            <Input />
          </Form.Item>

          <Divider orientation="left" plain>
            俄语文案（上架用）
          </Divider>
          <Space style={{ marginBottom: 8 }}>
            <Button
              size="small"
              icon={<CopyOutlined />}
              onClick={() =>
                copyText(
                  ['titleRu', 'descRu', 'tagsRu']
                    .map((k) => String(form.getFieldValue(k) || '').trim())
                    .filter(Boolean)
                    .join('\n\n'),
                  '俄语文案',
                )
              }
            >
              复制全部文案
            </Button>
          </Space>
          <Form.Item
            name="titleRu"
            label="俄语标题"
            extra={
              <Button
                type="link"
                size="small"
                style={{ padding: 0 }}
                icon={<CopyOutlined />}
                onClick={() => copyText(form.getFieldValue('titleRu'), '俄语标题')}
              >
                复制标题
              </Button>
            }
          >
            <Input placeholder="Например: Детский стульчик для ванной..." />
          </Form.Item>
          <Form.Item
            name="descRu"
            label="俄语内容 / 描述"
            extra={
              <Button
                type="link"
                size="small"
                style={{ padding: 0 }}
                icon={<CopyOutlined />}
                onClick={() => copyText(form.getFieldValue('descRu'), '俄语内容')}
              >
                复制内容
              </Button>
            }
          >
            <Input.TextArea rows={4} placeholder="商品描述（俄语）" />
          </Form.Item>
          <Form.Item
            name="tagsRu"
            label="俄语标签（逗号 / 空格分隔）"
            extra={
              <Button
                type="link"
                size="small"
                style={{ padding: 0 }}
                icon={<CopyOutlined />}
                onClick={() => copyText(form.getFieldValue('tagsRu'), '俄语标签')}
              >
                复制标签
              </Button>
            }
          >
            <Input placeholder="например: стульчик, детский, мебель" />
          </Form.Item>

          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} placeholder="想卖给谁、为什么觉得好卖…" />
          </Form.Item>
        </Form>

        {calc ? (
          <>
            <Divider orientation="left" plain>
              本次算价明细
            </Divider>
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="渠道">{calc.name || '-'}</Descriptions.Item>
              <Descriptions.Item label="时效">{calc.etaDays || '-'}</Descriptions.Item>
              <Descriptions.Item label="计费重量">
                {calc.billWeightKg != null ? `${calc.billWeightKg} kg` : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="国际运费">{money(calc.shippingFee)}</Descriptions.Item>
              <Descriptions.Item label="建议定价">
                {money(calc.sellPrice)} / {money(calc.sellPriceRub, '₽')}
              </Descriptions.Item>
              <Descriptions.Item label="加 35% 参考价">{money(calc.markup35)}</Descriptions.Item>
              <Descriptions.Item label="毛利润">{money(calc.grossProfit)}</Descriptions.Item>
              <Descriptions.Item label="净利润">{money(calc.netProfit)}</Descriptions.Item>
              <Descriptions.Item label="利润率">{pct(calc.profitRate)}</Descriptions.Item>
              <Descriptions.Item label="运费利润比">{pct(calc.freightProfitRatio)}</Descriptions.Item>
            </Descriptions>
            {calc.reason ? (
              <div style={{ marginTop: 8, color: '#faad14', fontSize: 12 }}>提示：{calc.reason}</div>
            ) : null}
          </>
        ) : null}
      </Drawer>
    </Card>
  );
}
