import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString } from 'class-validator';

export class QueryRunDto {
  @ApiProperty({ required: false, description: '0 淘汰 1 优先跟进 2 可跟进 3 观察' })
  @IsOptional()
  @IsString()
  grade?: string;

  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  @IsInt()
  page?: number;

  @ApiProperty({ required: false, default: 50 })
  @IsOptional()
  @IsInt()
  pageSize?: number;
}
