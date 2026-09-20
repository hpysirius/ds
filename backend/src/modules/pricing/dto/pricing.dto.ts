import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { COUNTRIES, VENDORS, CATEGORIES } from '../pricing.calc';

const COUNTRY_VALUES = COUNTRIES.map((c) => c.value);
const VENDOR_VALUES = VENDORS.map((v) => v.value);

export class QuoteDto {
  @ApiPropertyOptional({ description: '国家代码 RU/BY/KZ/KG' })
  @IsOptional()
  @IsIn(COUNTRY_VALUES)
  country?: string;

  @ApiPropertyOptional({ description: '供应商 GUOO / XY' })
  @IsOptional()
  @IsIn(VENDOR_VALUES)
  vendor?: string;

  @ApiPropertyOptional({ description: '品类' })
  @IsOptional()
  @IsIn(CATEGORIES)
  category?: string;

  @ApiProperty({ description: '实重 kg' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  weightKg: number;

  @ApiProperty({ description: '长 cm' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  lengthCm: number;

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

  @ApiPropertyOptional({ description: '销售价值（卢布）。核价时不传则按定价与汇率自动折算' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  valueRub?: number;

  @ApiPropertyOptional({ description: '是否连同不可用渠道一起返回' })
  @IsOptional()
  @IsBoolean()
  includeUnavailable?: boolean;
}

export class CalcDto extends QuoteDto {
  @ApiPropertyOptional({ description: '定价（人民币）。与 sellPriceRub 二选一' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sellPriceCny?: number;

  @ApiPropertyOptional({ description: '定价（卢布）。填它时按汇率折成人民币核算' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sellPriceRub?: number;

  @ApiPropertyOptional({ description: '汇率：1 卢布 = ? 人民币' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  exchangeRate?: number;

  @ApiPropertyOptional({ description: '采购成本（元）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  purchaseCost?: number;

  @ApiPropertyOptional({ description: '贴单费（元）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  labelFee?: number;

  @ApiPropertyOptional({ description: '平台佣金率，0.12 = 12%' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  commissionRate?: number;

  @ApiPropertyOptional({ description: 'Ozon 代理佣金率' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  agentRate?: number;

  @ApiPropertyOptional({ description: '提现费率' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  withdrawRate?: number;

  @ApiPropertyOptional({ description: '手填国际运费（元），填了就不按渠道算' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  manualShippingFee?: number;

  @ApiPropertyOptional({ description: '目标利润率（净利润/采购成本），用于反算建议定价' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  targetProfitRate?: number;

  @ApiPropertyOptional({ description: '只算指定渠道' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  channelId?: number;
}

export class CreateRecordDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() sku?: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() purchaseCost?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() weightKg?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() lengthCm?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() widthCm?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() heightCm?: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() sellPrice?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() sellPriceRub?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() exchangeRate?: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() labelFee?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() commissionRate?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() agentRate?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() withdrawRate?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() country?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() vendor?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() channelId?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() channelName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() shipMode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() logistics?: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() shippingFee?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() billWeightKg?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() supplyUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() retailUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() remark?: string;

  @ApiPropertyOptional({ description: '成本加价率，0.1 = 成本加 10%' })
  @IsOptional() @Type(() => Number) @IsNumber() markupRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() imageUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() categoryPath?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() offer1688Title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() weightSource?: string;
}

export class UpdateRecordDto extends CreateRecordDto {}

export class QueryRecordDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() page?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() pageSize?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() keyword?: string;
}

export class UpdateSettingDto {
  @ApiPropertyOptional({ description: '1 卢布 = ? 人民币' })
  @IsOptional() @Type(() => Number) @IsNumber() exchangeRate?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() rubPerCny?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() labelFee?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() commissionRate?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() agentRate?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() withdrawRate?: number;
  @ApiPropertyOptional({ description: '成本加价率，0.1 = 成本加 10%' })
  @IsOptional() @Type(() => Number) @IsNumber() markupRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() defaultCountry?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() defaultVendor?: string;
}

/** 定价工作流：按渠道算运费 → 按「成本×(1+加价率)」规则反推建议定价 → 算利润 */
export class PriceDto extends CalcDto {
  @ApiPropertyOptional({ description: '成本加价率，0.1 = 成本加 10%（不传取参数默认 10%）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  markupRate?: number;

  @ApiPropertyOptional({ description: '手工指定定价（元）；不传则用建议定价' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  manualSellPrice?: number;

  @ApiPropertyOptional({ description: '商品库 SKU，用于回填商品信息' })
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiPropertyOptional({ description: '1688 货源链接' })
  @IsOptional()
  @IsString()
  supplyUrl?: string;

  @ApiPropertyOptional({ description: 'Ozon 跟卖链接' })
  @IsOptional()
  @IsString()
  retailUrl?: string;
}

/** 1688 以图搜款：传商品主图 */
export class ImageSearchDto {
  @ApiProperty({ description: '商品主图 URL（Ozon CDN）' })
  @IsString()
  @IsNotEmpty()
  imageUrl: string;
}

export class ProductImageDto {
  @ApiPropertyOptional({ description: 'Ozon 商品链接' })
  @IsOptional()
  @IsString()
  url?: string;

  @ApiPropertyOptional({ description: '商品库 SKU，抓到后回写商品库' })
  @IsOptional()
  @IsString()
  sku?: string;
}

/** 1688 关键词搜同款 */
export class KeywordSearchDto {
  @ApiProperty({ description: '搜索关键词，一般用商品的中文类目名' })
  @IsString()
  @IsNotEmpty()
  keyword: string;
}

/** 手动粘贴 1688 Cookie */
export class SaveCookieDto {
  @ApiProperty({ description: '从 DevTools 复制的 Cookie 请求头' })
  @IsString()
  @IsNotEmpty()
  cookie: string;
}

/** 抓 1688 货品详情（价格 + 包装信息） */
export class OfferFetchDto {
  @ApiProperty({ description: '1688 商品链接或 offerId' })
  @IsString()
  @IsNotEmpty()
  url: string;

  @ApiPropertyOptional({ description: 'HTTP 抓不到时是否退到浏览器兜底' })
  @IsOptional()
  @IsBoolean()
  allowBrowser?: boolean;
}

/** 渠道增量更新：字段全部可选 */
export class UpdateChannelDto {
  @ApiPropertyOptional() @IsOptional() @IsString() country?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() vendor?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() category?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() shipMode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() delivery?: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() pricePerKg?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() pricePerOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() priceText?: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() minWeightKg?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() maxWeightKg?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() minValueRub?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() maxValueRub?: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() maxSumCm?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() maxSideLongCm?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() maxSideShortCm?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() volumetric?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() divisor?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() roundUp?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsString() etaDays?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() battery?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() sort?: number;
}

export class UpsertChannelDto {
  @ApiProperty() @IsString() @IsNotEmpty() country: string;
  @ApiProperty() @IsString() @IsNotEmpty() vendor: string;
  @ApiProperty() @IsString() @IsNotEmpty() category: string;
  @ApiProperty() @IsString() @IsNotEmpty() name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() shipMode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() delivery?: string;

  @ApiProperty() @Type(() => Number) @IsNumber() pricePerKg: number;
  @ApiProperty() @Type(() => Number) @IsNumber() pricePerOrder: number;
  @ApiPropertyOptional() @IsOptional() @IsString() priceText?: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() minWeightKg?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() maxWeightKg?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() minValueRub?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() maxValueRub?: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() maxSumCm?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() maxSideLongCm?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() maxSideShortCm?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() volumetric?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() divisor?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() roundUp?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsString() etaDays?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() battery?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() sort?: number;
}
