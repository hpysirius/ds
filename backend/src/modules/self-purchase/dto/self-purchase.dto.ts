import { ApiPropertyOptional } from '@nestjs/swagger';
import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** 列表查询 */
export class QuerySelfPurchaseDto {
  @ApiPropertyOptional({ description: '关键词：SKU / 名称 / 货源链接 / Ozon 链接 / 备注 / 俄语标题 模糊匹配' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({ description: '上架状态筛选：editing 编辑中 / listed 已上架 / delisted 已下架' })
  @IsOptional()
  @IsIn(['editing', 'listed', 'delisted'])
  status?: string;

  @ApiPropertyOptional({ description: '店铺 id（超管切店用；ValidationPipe 下必须显式声明）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  storeId?: number;

  @ApiPropertyOptional({ description: '页码，从 1 开始' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: '每页条数' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}

/**
 * 新增 / 编辑自采购条目。
 *
 * 全部字段可选（备忘录性质，允许先只贴一个链接），
 * 但「商品名称」与「1688 货源链接」至少要有一个，由 service 校验。
 */
export class CreateSelfPurchaseDto {
  @ApiPropertyOptional({ description: 'Ozon SKU（Ozon ↔ 1688 的关联 id；可从 Ozon 链接自动解析）' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  sku?: string;

  @ApiPropertyOptional({ description: '产品备注 / 自选商品名' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ description: '1688 规格名（插件抓 1688 页时选中的规格，如「蓝色」）' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  specName?: string;

  @ApiPropertyOptional({ description: '上架状态：editing 编辑中 / listed 已上架 / delisted 已下架' })
  @IsOptional()
  @IsIn(['editing', 'listed', 'delisted'])
  status?: string;

  @ApiPropertyOptional({ description: '1688 货源链接（主）' })
  @IsOptional()
  @IsString()
  supplyUrl?: string;

  @ApiPropertyOptional({ description: 'Ozon 链接（选填，只记录想卖的品，不参与比价）' })
  @IsOptional()
  @IsString()
  retailUrl?: string;

  @ApiPropertyOptional({ description: '商品图 URL' })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  /**
   * Ozon 跟卖价（插件在 Ozon 商品页采集时抓的页面在售价）。
   *
   * ⚠ 页面可能把价格渲染成 ¥：所以必须连币种符号一起上报（retailPriceSymbol），
   *   由后端按当前汇率折算成 ₽ 存 retailPriceRub、元存 retailPriceCny。
   *   也可以直接传 retailPriceRub / retailPriceCny（页面手填时用）。
   */
  @ApiPropertyOptional({ description: 'Ozon 跟卖价（页面原值；配合 retailPriceSymbol 换算）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  retailPrice?: number;

  @ApiPropertyOptional({ description: '跟卖价币种符号：₽ / ¥ / RUB / CNY（缺省按 ₽）' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  retailPriceSymbol?: string;

  @ApiPropertyOptional({ description: 'Ozon 跟卖价（卢布）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  retailPriceRub?: number;

  @ApiPropertyOptional({ description: 'Ozon 跟卖价（元）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  retailPriceCny?: number;

  @ApiPropertyOptional({ description: '包装信息原文（1688「件重尺」抓取：如 1件 0.35kg 30*20*5）' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  packageText?: string;

  // ---- 上架文案（俄语，手工填；页面提供一键复制，直接粘到 Ozon 后台）----
  @ApiPropertyOptional({ description: '俄语标题' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  titleRu?: string;

  @ApiPropertyOptional({ description: '俄语内容 / 描述' })
  @IsOptional()
  @IsString()
  descRu?: string;

  @ApiPropertyOptional({ description: '俄语标签（逗号 / 空格分隔）' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  tagsRu?: string;

  @ApiPropertyOptional({ description: '采购成本（元）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  purchaseCost?: number;

  // ---- 规格：数值列用于算价，*Text 保留手填原文（如 300g / 40*30*3）----
  @ApiPropertyOptional({ description: '实重 kg' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  weightKg?: number;

  @ApiPropertyOptional({ description: '长 cm' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  lengthCm?: number;

  @ApiPropertyOptional({ description: '宽 cm' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  widthCm?: number;

  @ApiPropertyOptional({ description: '高 cm' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  heightCm?: number;

  @ApiPropertyOptional({ description: '重量原文，如 300g / 10.5kg' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  weightText?: string;

  @ApiPropertyOptional({ description: '尺寸原文，如 40*30*3' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  sizeText?: string;

  // ---- 物流渠道（算价用，留空则走核价默认参数）----
  @ApiPropertyOptional({ description: '国家 RU / BY / KZ / KG' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ description: '供应商 GUOO / XY' })
  @IsOptional()
  @IsString()
  vendor?: string;

  @ApiPropertyOptional({ description: '品类，如 Extra Small / Budget / Small / Big' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: '物流渠道 id' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  channelId?: number;

  @ApiPropertyOptional({ description: '物流渠道名称' })
  @IsOptional()
  @IsString()
  channelName?: string;

  @ApiPropertyOptional({ description: '运输方式' })
  @IsOptional()
  @IsString()
  shipMode?: string;

  @ApiPropertyOptional({ description: '物流方式：陆空 / 陆运 …' })
  @IsOptional()
  @IsString()
  logistics?: string;

  // ---- 核价结果快照（前端点「算定价」调 /pricing/price 后回填，列表直接展示）----
  @ApiPropertyOptional({ description: '定价（元）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sellPrice?: number;

  @ApiPropertyOptional({ description: '定价（卢布）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sellPriceRub?: number;

  @ApiPropertyOptional({ description: '国际运费（元）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  shippingFee?: number;

  @ApiPropertyOptional({ description: '计费重量 kg' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  billWeightKg?: number;

  @ApiPropertyOptional({ description: '毛利润' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  grossProfit?: number;

  @ApiPropertyOptional({ description: '净利润' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  netProfit?: number;

  @ApiPropertyOptional({ description: '利润率' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  profitRate?: number;

  @ApiPropertyOptional({ description: '成本加价率' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  markupRate?: number;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;

  @ApiPropertyOptional({ description: '本次是否为「从 1688 抓取」录入（后端据此写 caughtAt 留痕）' })
  @IsOptional()
  @IsBoolean()
  fromCapture?: boolean;

  @ApiPropertyOptional({ description: '店铺 id（超管可指定；员工固定写自己所在店）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  storeId?: number;
}

export class UpdateSelfPurchaseDto extends PartialType(CreateSelfPurchaseDto) {}
