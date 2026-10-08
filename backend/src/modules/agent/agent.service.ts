import { BadRequestException, Injectable } from '@nestjs/common';
import { spawn } from 'child_process';
import * as path from 'path';
import { PricingService } from '../pricing/pricing.service';
import { SourcingService } from '../pricing/sourcing.service';
import { currentStoreId } from '../../common/constants/permissions';

/**
 * agent 脚本目录：backend/../scripts/browser-agent
 * （start.sh 以 backend/ 为 cwd 启动 node dist/main，故 process.cwd() === backend/）
 */
const AGENT_DIR = path.resolve(process.cwd(), '..', 'scripts', 'browser-agent');

/**
 * 包装 scripts/browser-agent：用子进程跑 `node src/agent.mjs candidates --sku X`，
 * 捕获 stdout 里以 `@@RESULT@@` 标记的那行 JSON（由 agent 在结尾打印）。
 */
interface AgentRun {
  ok: boolean;
  data?: any;
  error?: string;
  raw?: string;
}

@Injectable()
export class AgentService {
  constructor(
    private readonly pricing: PricingService,
    private readonly sourcing: SourcingService,
  ) {}

  /** 驱动本机 Chrome 打开 1688 图搜，返回候选货源（不含落库） */
  async findCandidates(sku: string, authToken?: string): Promise<any> {
    if (!sku) throw new BadRequestException('请先提供 SKU');
    const env: NodeJS.ProcessEnv = { ...process.env, DS_API: 'http://localhost:3101' };
    if (authToken) env.DS_TOKEN = authToken.replace(/^Bearer\s+/i, '');
    const { ok, data, error } = await this.runAgent(['candidates', '--sku', String(sku)], env);
    if (!ok) {
      throw new BadRequestException(
        error ||
          '图搜失败。请确认：① 已用 `open -a "Google Chrome" --args --user-data-dir="$HOME/chrome-debug-profile" --remote-debugging-port=9222` 启动核价专用 Chrome（Chrome 154+ 必须指定非默认 --user-data-dir）；② 1688 已登录；③ 未触发风控。',
      );
    }
    return data;
  }

  /**
   * 选一个同款 → 抓 1688 价格 + 算价 + 生成定价记录。
   * 纯后端 API，复用现有 SourcingService / PricingService，不再拉起第二个 agent 进程。
   */
  async applyChosen(
    dto: { sku: string; offerUrl: string; sellPrice?: number },
    user: any,
    storeId?: number | string | null,
  ): Promise<any> {
    const src: any = await this.sourcing.fetchOffer(dto.offerUrl, false);
    const purchaseCost = Number(src?.price ?? src?.priceCny ?? src?.purchaseCost ?? 0) || 0;
    const weightG = Number(src?.weightG ?? src?.weight ?? 0) || 0;
    if (!purchaseCost) {
      throw new BadRequestException('没抓到 1688 采购价，请改用手填或换一个货源链接');
    }
    const st: any = await this.pricing.getSettings();
    const product: any = await this.pricing.fromProduct(dto.sku, user);
    const weightKg = weightG ? weightG / 1000 : product.weightKg;
    const sellPriceRub = dto.sellPrice ? Math.round(dto.sellPrice / st.exchangeRate) : product.priceRub;
    const finalSellPrice = dto.sellPrice ?? Number((sellPriceRub * st.exchangeRate).toFixed(2));

    const calc: any = await this.pricing.calc({
      country: st.defaultCountry,
      vendor: st.defaultVendor,
      weightKg,
      lengthCm: product.lengthCm || 20,
      widthCm: product.widthCm || 20,
      heightCm: product.heightCm || 20,
      purchaseCost,
      sellPriceRub,
      exchangeRate: st.exchangeRate,
      labelFee: st.labelFee,
      commissionRate: st.commissionRate,
      agentRate: st.agentRate,
      withdrawRate: st.withdrawRate,
    });
    const b = calc.best;
    if (!b) throw new BadRequestException('没有可用物流渠道，无法定价');

    const payload: any = {
      name: product.title,
      sku: dto.sku,
      purchaseCost,
      weightKg,
      lengthCm: product.lengthCm || 20,
      widthCm: product.widthCm || 20,
      heightCm: product.heightCm || 20,
      sellPrice: finalSellPrice,
      sellPriceRub: sellPriceRub || Math.round(finalSellPrice / st.exchangeRate),
      exchangeRate: st.exchangeRate,
      labelFee: st.labelFee,
      commissionRate: st.commissionRate,
      agentRate: st.agentRate,
      withdrawRate: st.withdrawRate,
      country: st.defaultCountry,
      vendor: st.defaultVendor,
      channelId: b.channelId,
      channelName: b.name,
      shipMode: b.shipMode,
      logistics: b.shipMode,
      shippingFee: b.shippingFee,
      billWeightKg: b.billWeightKg,
      supplyUrl: dto.offerUrl,
      retailUrl: product.productUrl,
      imageUrl: product.imageUrl,
      offer1688Title: src?.title || '',
      weightSource: weightG ? '1688' : 'ds',
      remark: product.title,
      source: 'agent',
    };
    const rec = await this.pricing.createRecord(payload, user.id, currentStoreId(user, storeId));
    return { record: rec, channel: b };
  }

  /** 自检：Chrome 调试端口 + ds 后端 */
  async doctor(): Promise<{ chrome: boolean; ds: boolean; agentDir: string }> {
    let chrome = false;
    try {
      const r = await fetch('http://127.0.0.1:9222/json/version', { signal: AbortSignal.timeout(3000) });
      chrome = r.ok;
    } catch {
      chrome = false;
    }
    let ds = false;
    try {
      const base = process.env.DS_API || 'http://localhost:3101';
      const r = await fetch(`${base}/pricing/meta`, { signal: AbortSignal.timeout(3000) });
      ds = r.ok;
    } catch {
      ds = false;
    }
    return { chrome, ds, agentDir: AGENT_DIR };
  }

  /** 拉起 agent 子进程，等它打印 `@@RESULT@@<json>` 后解析 */
  private runAgent(args: string[], env: NodeJS.ProcessEnv): Promise<AgentRun> {
    return new Promise<AgentRun>((resolve) => {
      let out = '';
      const child = spawn(process.execPath, ['src/agent.mjs', ...args], { cwd: AGENT_DIR, env });
      child.stdout?.on('data', (d) => (out += d.toString()));
      child.stderr?.on('data', (d) => (out += d.toString()));
      child.on('error', (e) => resolve({ ok: false, error: e.message, raw: out }));
      // 图搜（上传 + 等识别）可能要 20-40s；给 90s 上限兜底，避免请求永久挂起
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve({ ok: false, error: '图搜超时（90 秒），请检查 Chrome 是否卡在验证码或加载', raw: out });
      }, 90000);
      child.on('close', (code) => {
        clearTimeout(timer);
        const m = out.match(/@@RESULT@@(\{[\s\S]*\})\s*$/);
        if (m) {
          try {
            const data = JSON.parse(m[1]);
            resolve({ ok: data.ok !== false, data, raw: out });
            return;
          } catch {
            /* 落到下面的通用错误 */
          }
        }
        resolve({ ok: false, error: `agent 异常退出（code ${code}）`, raw: out });
      });
    });
  }
}
