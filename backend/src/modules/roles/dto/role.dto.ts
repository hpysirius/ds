import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({ description: '角色名', example: '选品专员' })
  @IsNotEmpty({ message: '角色名不能为空' })
  @IsString()
  @MaxLength(50)
  name: string;

  @ApiProperty({
    description: '角色编码（唯一，英文/数字/下划线）',
    example: 'selector',
  })
  @IsNotEmpty({ message: '角色编码不能为空' })
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9_]+$/, { message: '角色编码只能包含字母、数字和下划线' })
  code: string;

  @ApiPropertyOptional({ description: '页面权限 key 列表', example: ['dashboard', 'products'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  permissions?: string[];

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  remark?: string;
}

export class UpdateRoleDto {
  @ApiPropertyOptional({ description: '角色名' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ description: '角色编码' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9_]+$/, { message: '角色编码只能包含字母、数字和下划线' })
  code?: string;

  @ApiPropertyOptional({ description: '页面权限 key 列表' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  permissions?: string[];

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  remark?: string;
}
