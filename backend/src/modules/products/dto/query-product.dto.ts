import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString } from 'class-validator';

export class QueryProductDto {
  @ApiProperty({ required: false, description: '标题/SKU 关键字' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  category3Name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  brand?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  salesSchema?: string;

  @ApiProperty({ required: false, description: '月销量下限' })
  @IsOptional()
  @IsNumber()
  minSold?: number;

  @ApiProperty({ required: false, description: '月销量上限' })
  @IsOptional()
  @IsNumber()
  maxSold?: number;

  @ApiProperty({ required: false, description: '加购率下限' })
  @IsOptional()
  @IsNumber()
  minCart?: number;

  @ApiProperty({ required: false, description: '退货率上限' })
  @IsOptional()
  @IsNumber()
  maxCancel?: number;

  @ApiProperty({ required: false, description: '上架天数上限' })
  @IsOptional()
  @IsNumber()
  maxDays?: number;

  @ApiProperty({ required: false, description: '只看无评论' })
  @IsOptional()
  @IsBoolean()
  onlyNoReview?: boolean;

  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  @IsInt()
  page?: number;

  @ApiProperty({ required: false, default: 20 })
  @IsOptional()
  @IsInt()
  pageSize?: number;

  @ApiProperty({ required: false, default: 'lastSeenAt' })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiProperty({ required: false, enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}
