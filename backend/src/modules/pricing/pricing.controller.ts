import { Body, Controller, Delete, Get, Header, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { PricingService } from './pricing.service';
import { CalcDto, CreateRecordDto, QueryRecordDto, QuoteDto, UpdateChannelDto, UpdateRecordDto, UpdateSettingDto, UpsertChannelDto } from './dto/pricing.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('核价')
@Controller('pricing')
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  // ---- 元数据 / 参数 ----
  @Public()
  @Get('meta')
  @ApiOperation({ summary: '国家、供应商、品类枚举' })
  meta() {
    return this.pricingService.meta();
  }

  @Public()
  @Get('settings')
  @ApiOperation({ summary: '核价默认参数（汇率、佣金、贴单费等）' })
  getSettings() {
    return this.pricingService.getSettings();
  }

  @ApiBearerAuth()
  @Patch('settings')
  @ApiOperation({ summary: '修改核价默认参数' })
  updateSettings(@Body() dto: UpdateSettingDto) {
    return this.pricingService.updateSettings(dto);
  }

  // ---- 物流渠道 ----
  @Public()
  @Get('channels')
  @ApiOperation({ summary: '物流渠道列表' })
  listChannels(@Query('country') country?: string, @Query('vendor') vendor?: string, @Query('category') category?: string) {
    return this.pricingService.listChannels({ country, vendor, category });
  }

  @ApiBearerAuth()
  @Post('channels')
  @ApiOperation({ summary: '新增物流渠道' })
  createChannel(@Body() dto: UpsertChannelDto) {
    return this.pricingService.createChannel(dto);
  }

  @ApiBearerAuth()
  @Post('channels/reset')
  @ApiOperation({ summary: '恢复内置渠道（清空后重建）' })
  resetChannels() {
    return this.pricingService.resetChannels();
  }

  @ApiBearerAuth()
  @Patch('channels/:id')
  @ApiOperation({ summary: '修改物流渠道' })
  updateChannel(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateChannelDto) {
    return this.pricingService.updateChannel(id, dto);
  }

  @ApiBearerAuth()
  @Delete('channels/:id')
  @ApiOperation({ summary: '删除物流渠道' })
  removeChannel(@Param('id', ParseIntPipe) id: number) {
    return this.pricingService.removeChannel(id);
  }

  // ---- 试算 / 核价 ----
  @Public()
  @Post('quote')
  @ApiOperation({ summary: '物流运费试算（只算运费）' })
  quote(@Body() dto: QuoteDto) {
    return this.pricingService.quote(dto);
  }

  @Public()
  @Post('calc')
  @ApiOperation({ summary: '核价：按渠道算运费 + 利润，并给出各渠道对比' })
  calc(@Body() dto: CalcDto) {
    return this.pricingService.calc(dto);
  }

  @Public()
  @Get('from-product/:sku')
  @ApiOperation({ summary: '从商品库带出重量/尺寸/价格' })
  fromProduct(@Param('sku') sku: string) {
    return this.pricingService.fromProduct(sku);
  }

  // ---- 核价记录 ----
  @Public()
  @Get('records')
  @ApiOperation({ summary: '核价记录列表' })
  listRecords(@Query() query: QueryRecordDto) {
    return this.pricingService.listRecords(query);
  }

  @ApiBearerAuth()
  @Post('records')
  @ApiOperation({ summary: '保存核价记录' })
  createRecord(@Body() dto: CreateRecordDto, @CurrentUser('id') userId: number) {
    return this.pricingService.createRecord(dto, userId);
  }

  @ApiBearerAuth()
  @Patch('records/:id')
  @ApiOperation({ summary: '修改核价记录' })
  updateRecord(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRecordDto) {
    return this.pricingService.updateRecord(id, dto);
  }

  @ApiBearerAuth()
  @Delete('records/:id')
  @ApiOperation({ summary: '删除核价记录' })
  removeRecord(@Param('id', ParseIntPipe) id: number) {
    return this.pricingService.removeRecord(id);
  }

  @Public()
  @Get('records/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: '导出核价表 CSV（列头与原定价表一致）' })
  async export(@Res() res: Response) {
    const csv = await this.pricingService.exportCsv();
    res.setHeader('Content-Disposition', 'attachment; filename="pricing.csv"');
    res.send(csv);
  }
}
