import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class CreatePresetDto {
  @ApiProperty({ description: '预设名称' })
  @IsNotEmpty({ message: '预设名称不能为空' })
  @IsString()
  name: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ required: false, description: '规则阈值（不传走默认）' })
  @IsOptional()
  @IsObject()
  rules?: Record<string, any>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
