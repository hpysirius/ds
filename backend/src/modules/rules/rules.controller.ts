import { Body, Controller, Get, Headers, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RulesService } from './rules.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('采集规则标签')
@Controller('rules')
export class RulesController {
  constructor(private readonly rulesService: RulesService) {}

  /**
   * 插件全量上报采集规则。@Public + 可选 token：
   * 带员工 token → 规则归到该员工店铺；不带/超管 → storeId=null（超管「全部」视图可见）。
   */
  @Public()
  @Post('sync')
  @ApiOperation({ summary: '插件上报采集规则（全量，按 (storeId, ruleId) 幂等）' })
  sync(@Body() dto: any, @Headers('authorization') auth?: string) {
    return this.rulesService.sync(dto, auth);
  }

  @ApiBearerAuth()
  @Get()
  @ApiOperation({ summary: '规则标签列表（含命中商品数，按店铺隔离）' })
  findAll(@CurrentUser() user: any, @Query('storeId') storeId?: string) {
    return this.rulesService.findAll(user, storeId);
  }

  /**
   * 必须在 `:id` 之前声明 —— 否则 /rules/by-tag/xxx 会被当成 id 去 ParseInt 而 400。
   */
  @ApiBearerAuth()
  @Get('by-tag/:tag')
  @ApiOperation({ summary: '按标签名查规则（商品库点标签名时用）' })
  byTag(@Param('tag') tag: string, @CurrentUser() user: any, @Query('storeId') storeId?: string) {
    return this.rulesService.findByTag(decodeURIComponent(tag), user, storeId);
  }

  @ApiBearerAuth()
  @Get(':id')
  @ApiOperation({ summary: '规则标签详情' })
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.rulesService.findOne(id, user);
  }
}
