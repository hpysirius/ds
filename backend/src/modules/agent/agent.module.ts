import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { PricingModule } from '../pricing/pricing.module';

/**
 * 浏览器 Agent 核价：
 *   - find   ：驱动本机真实 Chrome（CDP 9222）打开 1688 图搜，返回候选同款（不落库）。
 *             这一步必须连用户自己的 Chrome —— 1688 风控严，只有真浏览器能过。
 *   - apply  ：前端点选某个同款后，后端直接用现有 SourcingService/PricingService
 *             抓价 → 算价 → 生成定价记录（不再拉起第二个 agent 进程）。
 * 整个「人工挑同款」用网页点选替代 CLI 的终端 stdin。
 */
@Module({
  imports: [PricingModule],
  controllers: [AgentController],
  providers: [AgentService],
})
export class AgentModule {}
