import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsObject, IsOptional } from 'class-validator';

export class RunScreeningDto {
  @ApiProperty({ required: false, description: '规则预设 ID' })
  @IsOptional()
  @IsInt()
  presetId?: number;

  @ApiProperty({ required: false, description: '只筛某次采集的商品' })
  @IsOptional()
  @IsInt()
  taskId?: number;

  @ApiProperty({ required: false, description: '临时规则（不保存预设）' })
  @IsOptional()
  @IsObject()
  rules?: Record<string, any>;
}
