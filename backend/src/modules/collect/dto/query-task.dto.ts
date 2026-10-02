import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString } from 'class-validator';

export class QueryTaskDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiProperty({ required: false, description: '按店铺隔离（超管可指定店铺，不传看全部）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  storeId?: number;

  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  @IsInt()
  page?: number;

  @ApiProperty({ required: false, default: 20 })
  @IsOptional()
  @IsInt()
  pageSize?: number;
}
