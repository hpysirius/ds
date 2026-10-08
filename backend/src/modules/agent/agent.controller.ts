import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AgentService } from './agent.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('浏览器 Agent 核价')
@Controller('agent')
export class AgentController {
  constructor(private readonly agent: AgentService) {}

  @ApiBearerAuth()
  @Get('doctor')
  @ApiOperation({ summary: '自检：本机 Chrome 调试端口（9222）是否就绪、ds 后端是否在线' })
  doctor() {
    return this.agent.doctor();
  }

  @ApiBearerAuth()
  @Post('find')
  @ApiOperation({ summary: '驱动本机 Chrome 打开 1688 图搜，返回候选同款（不落库）' })
  async find(@Body() dto: { sku: string }, @Headers('authorization') auth?: string) {
    return this.agent.findCandidates(dto.sku, auth);
  }

  @ApiBearerAuth()
  @Post('apply')
  @ApiOperation({ summary: '选一个同款 → 抓 1688 价 / 算价 / 生成定价记录' })
  async apply(
    @Body() dto: { sku: string; offerUrl: string; sellPrice?: number; storeId?: string },
    @CurrentUser() user: any,
    @Query('storeId') qStoreId?: string,
  ) {
    const storeId = dto.storeId ?? qStoreId;
    return this.agent.applyChosen(dto, user, storeId);
  }
}
