import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty()
  @IsNotEmpty({ message: '登录名不能为空' })
  @MaxLength(50)
  username: string;

  @ApiProperty()
  @IsNotEmpty({ message: '密码不能为空' })
  @MinLength(6, { message: '密码至少 6 位' })
  password: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  nickname?: string;
}
