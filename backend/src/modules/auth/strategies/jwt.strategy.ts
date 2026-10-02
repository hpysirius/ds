import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';
import { resolvePermissions } from '../../../common/constants/permissions';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: any) {
    const user = await this.usersService.findByIdWithRole(payload.sub);
    if (!user || user.status !== 1) throw new UnauthorizedException('账号不存在或已禁用');
    return {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      role: user.role,
      // 所属店铺：决定该账号能看到哪个店铺的数据（超管为 null，表示看全部）
      storeId: user.storeId ?? null,
      storeName: user.store?.name ?? null,
      // 最终生效的页面权限：超管全量 > 角色权限 > 个人权限；前端菜单与路由守卫按它过滤
      permissions: resolvePermissions(user),
    };
  }
}
