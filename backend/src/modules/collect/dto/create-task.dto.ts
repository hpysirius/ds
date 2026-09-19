import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateTaskDto {
  @ApiProperty({ description: '榜单地址' })
  @IsNotEmpty({ message: '榜单地址不能为空' })
  @IsString()
  url: string;

  @ApiProperty({ description: '任务名称', required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ description: '滚动屏数', required: false, default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  scrolls?: number;

  @ApiProperty({ description: '每屏滚动像素', required: false, default: 900 })
  @IsOptional()
  @IsInt()
  @Min(300)
  step?: number;
}
