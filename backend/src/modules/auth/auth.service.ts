import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.usersService.findByUsername(dto.username);
    if (!user) throw new UnauthorizedException('登录名或密码错误');
    if (user.status !== 1) throw new UnauthorizedException('账号已被禁用');

    const ok = await bcrypt.compare(dto.password, user.password);
    if (!ok) throw new UnauthorizedException('登录名或密码错误');

    await this.usersService.touchLogin(user.id);

    const payload = { sub: user.id, username: user.username, role: user.role };
    return {
      accessToken: await this.jwtService.signAsync(payload),
      user: { id: user.id, username: user.username, nickname: user.nickname, role: user.role },
    };
  }

  async register(dto: RegisterDto) {
    const user = await this.usersService.create({ ...dto, role: 'user' });
    return this.login({ username: dto.username, password: dto.password } as LoginDto).then((r) => ({
      ...r,
      user,
    }));
  }
}
