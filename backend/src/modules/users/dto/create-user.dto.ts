import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** 允许的角色：super_admin 超级管理员 / admin 管理员 / user 员工 */
export const ALLOWED_ROLES = ['super_admin', 'admin', 'user'];

export class CreateUserDto {
  @ApiProperty({ description: '登录名' })
  @IsNotEmpty({ message: '登录名不能为空' })
  @IsString()
  @MaxLength(50)
  username: string;

  @ApiProperty({ description: '密码' })
  @IsNotEmpty({ message: '密码不能为空' })
  @MinLength(6, { message: '密码至少 6 位' })
  password: string;

  @ApiProperty({ description: '昵称', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  nickname?: string;

  @ApiProperty({
    description: '角色：super_admin 超级管理员 / admin 管理员 / user 员工',
    required: false,
    example: 'user',
  })
  @IsOptional()
  @IsIn(ALLOWED_ROLES, { message: '角色不合法' })
  role?: string;

  @ApiProperty({ description: '页面权限 key 列表', required: false, example: ['dashboard', 'products'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  permissions?: string[];

  @ApiProperty({ description: '状态：1 启用 0 停用', required: false, example: 1 })
  @IsOptional()
  @IsInt()
  status?: number;

  @ApiProperty({ description: '所属角色 id（页面权限由角色决定）；传 null 表示取消角色', required: false })
  @IsOptional()
  @IsInt()
  roleId?: number;

  @ApiProperty({ description: '所属店铺 id；员工挂在店铺下，数据按店铺隔离。传 null 表示不归属店铺', required: false })
  @IsOptional()
  @IsInt()
  storeId?: number;
}
