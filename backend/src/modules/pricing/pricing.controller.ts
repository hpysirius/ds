import { Body, Controller, Delete, Get, Header, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { PricingService } from './pricing.service';
import { SourcingService } from './sourcing.service';
import {
  CalcDto,
  CreateRecordDto,
  ImageSearchDto,
  KeywordSearchDto,
  OfferFetchDto,
  SaveCookieDto,
  PriceDto,
  ProductImageDto,
  QueryRecordDto,
  QuoteDto,
  UpdateChannelDto,
  UpdateRecordDto,
  UpdateSettingDto,
  UpsertChannelDto,
} from './dto/pricing.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('核价')
@Controller('pricing')
export class PricingController {
  constructor(
    private readonly pricingService: PricingService,
    private readonly sourcingService: SourcingService,
  ) {}

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
  @Post('price')
  @ApiOperation({ summary: '定价：按渠道算运费 + 按成本加价规则反推建议定价' })
  price(@Body() dto: PriceDto) {
    return this.pricingService.price(dto);
  }

  @Public()
  @Post('calc')
  @ApiOperation({ summary: '核价：按渠道算运费 + 利润，并给出各渠道对比' })
  calc(@Body() dto: CalcDto) {
    return this.pricingService.calc(dto);
  }

  // ---- 找货源：1688（纯 HTTP 为主） ----
  @Public()
  @Get('sourcing/cookie-status')
  @ApiOperation({ summary: '查看 1688 登录态是否已同步' })
  cookieStatus() {
    return this.sourcingService.cookieStatus();
  }

  @Public()
  @Post('sourcing/sync-cookie')
  @ApiOperation({ summary: '从调试 Chrome 同步一次 1688 登录态（只读 cookie，不渲染页面）' })
  syncCookie() {
    return this.sourcingService.syncCookieFromChrome();
  }

  @Public()
  @Post('sourcing/cookie')
  @ApiOperation({ summary: '手动粘贴 1688 Cookie' })
  saveCookie(@Body() dto: SaveCookieDto) {
    return this.sourcingService.saveCookie(dto.cookie);
  }

  @Public()
  @Post('sourcing/search-keyword')
  @ApiOperation({ summary: '1688 关键词搜同款（纯 HTTP，秒级）' })
  searchKeyword(@Body() dto: KeywordSearchDto) {
    return this.sourcingService.searchByKeyword(dto.keyword);
  }

  @Public()
  @Post('sourcing/prepare-search')
  @ApiOperation({ summary: '打开 1688 图搜页并把商品主图塞进上传框（不算搜索）' })
  prepareSearch(@Body() dto: ImageSearchDto) {
    return this.sourcingService.prepareImageSearch(dto.imageUrl);
  }

  @Public()
  @Post('sourcing/trigger-search')
  @ApiOperation({ summary: '尽力自动点一下 1688 页面上的「搜索图片」' })
  triggerSearch() {
    return this.sourcingService.triggerImageSearch();
  }

  @Public()
  @Post('sourcing/scan-tabs')
  @ApiOperation({ summary: '扫描浏览器里所有 1688 标签页，收货源卡片' })
  scanTabs() {
    return this.sourcingService.scanTabs();
  }

  @Public()
  @Post('sourcing/image-search')
  @ApiOperation({ summary: '1688 以图搜款：上传主图 → 触发搜索 → 收回候选货源' })
  imageSearch(@Body() dto: ImageSearchDto) {
    return this.sourcingService.searchByImage(dto.imageUrl);
  }

  @Public()
  @Post('sourcing/product-image')
  @ApiOperation({ summary: '抓 Ozon 商品主图（以图搜款前的准备，抓到后回写商品库）' })
  async productImage(@Body() dto: ProductImageDto) {
    const url = dto.url || (dto.sku ? `https://www.ozon.ru/product/${dto.sku}/` : '');
    const { imageUrl } = await this.sourcingService.fetchProductImage(url);
    if (imageUrl && dto.sku) {
      await this.pricingService.setProductImage(dto.sku, imageUrl).catch(() => undefined);
    }
    return { imageUrl };
  }

  @Public()
  @Post('sourcing/offer')
  @ApiOperation({ summary: '抓 1688 货品详情：价格 + 包装信息（长宽高/重量）' })
  fetchOffer(@Body() dto: OfferFetchDto) {
    return this.sourcingService.fetchOffer(dto.url, dto.allowBrowser === true);
  }

  @Public()
  @Get('products')
  @ApiOperation({ summary: '商品库检索，供定价工作台选品' })
  searchProducts(@Query('keyword') keyword = '', @Query('limit') limit?: number) {
    return this.pricingService.searchProducts(keyword, limit ? Number(limit) : 20);
  }

  @Public()
  @Get('from-product/:sku')
  @ApiOperation({ summary: '从商品库带出重量/尺寸/价格' })
  fromProduct(@Param('sku') sku: string) {
    return this.pricingService.fromProduct(sku);
  }

  // ---- 定价记录 ----
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
