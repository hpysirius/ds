import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ description: '登录名', example: 'admin' })
  @IsNotEmpty({ message: '登录名不能为空' })
  @IsString()
  username: string;

  @ApiProperty({ description: '密码', example: 'admin123' })
  @IsNotEmpty({ message: '密码不能为空' })
  @IsString()
  password: string;
}
