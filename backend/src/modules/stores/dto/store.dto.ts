import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateStoreDto {
  @ApiProperty({ description: '店铺名称', example: '莫斯科一号店' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(80)
  name: string;

  @ApiPropertyOptional({ description: '店铺编码（唯一，可空）', example: 'msk01' })
  @IsOptional()
  @Matches(/^[A-Za-z0-9_-]*$/, { message: '编码只能包含字母/数字/下划线/连字符' })
  @MaxLength(40)
  code?: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  remark?: string;

  @ApiPropertyOptional({ description: '状态：1 启用 0 停用', example: 1 })
  @IsOptional()
  @IsInt()
  status?: number;
}

export class UpdateStoreDto {
  @ApiPropertyOptional({ description: '店铺名称' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ description: '店铺编码（唯一，可空）' })
  @IsOptional()
  @Matches(/^[A-Za-z0-9_-]*$/, { message: '编码只能包含字母/数字/下划线/连字符' })
  @MaxLength(40)
  code?: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  remark?: string;

  @ApiPropertyOptional({ description: '状态：1 启用 0 停用' })
  @IsOptional()
  @IsInt()
  status?: number;
}
