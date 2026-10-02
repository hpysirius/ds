import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ description: '新密码（至少 6 位）' })
  @IsString()
  @MinLength(6, { message: '新密码至少 6 位' })
  password: string;
}
