import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import {
  parsePermissions,
  resolvePermissions,
  roleLevel,
  serializePermissions,
  SUPER_ADMIN_ROLE,
} from '../../common/constants/permissions';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 统一出口：不返回密码；permissions 输出「最终生效权限」（角色权限优先，见 resolvePermissions）。
   * 同时输出 roleId / roleName 方便前端展示。
   */
  private toDto(user: any) {
    if (!user) return user;
    const { password, permissions, roleRef, store, ...rest } = user;
    return {
      ...rest,
      permissions: resolvePermissions(user),
      roleId: rest.roleId ?? null,
      roleName: roleRef?.name ?? null,
      storeId: rest.storeId ?? null,
      storeName: store?.name ?? null,
    };
  }

  // ---------------- 角色 / 店铺范围守卫 ----------------

  /**
   * 计算允许写入的角色，堵住「admin 造一个 super_admin」的提权链。
   * - 没有 currentUser（公开注册 / 内部调用）：一律降为普通员工
   * - 不能赋予高于自身的角色
   */
  private resolveRole(currentUser: any, wanted?: string | null): string {
    if (!currentUser || !wanted) return 'user';
    if (roleLevel(wanted) > roleLevel(currentUser.role)) {
      throw new ForbiddenException('不能赋予高于自身的角色');
    }
    return wanted;
  }

  /** 非超管只能在自己所属店铺内建人 / 挪人，防止跨店挂靠 */
  private resolveStoreId(currentUser: any, wanted?: number | null): number | null {
    if (!currentUser) return null;
    if (currentUser.role === SUPER_ADMIN_ROLE) return wanted ?? null;
    return currentUser.storeId ?? null;
  }

  /** 目标账号是否在当前账号可见范围内。越权统一抛 404，不暴露账号是否存在 */
  private assertInScope(currentUser: any, target: any) {
    if (!currentUser || currentUser.role === SUPER_ADMIN_ROLE) return;
    if ((target.storeId ?? -1) !== (currentUser.storeId ?? -1)) {
      throw new NotFoundException('用户不存在');
    }
  }

  async create(dto: CreateUserDto, currentUser?: any) {
    const exists = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (exists) throw new ConflictException('登录名已存在');

    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        password: await bcrypt.hash(dto.password, 10),
        nickname: dto.nickname,
        role: this.resolveRole(currentUser, dto.role),
        permissions: serializePermissions(dto.permissions ?? []),
        status: dto.status ?? 1,
        ...(dto.roleId !== undefined ? { roleId: dto.roleId } : {}),
        storeId: this.resolveStoreId(currentUser, dto.storeId ?? null),
      },
      include: { roleRef: true, store: true },
    });
    return this.toDto(user);
  }

  /** 用户列表：超管看全部；其余只看本店（未挂店 → 等效无数据） */
  async findAll(user?: any) {
    const where = user && user.role !== SUPER_ADMIN_ROLE ? { storeId: user.storeId ?? -1 } : {};
    const users = await this.prisma.user.findMany({
      where,
      orderBy: { id: 'asc' },
      include: { roleRef: true, store: true },
    });
    return users.map((u) => this.toDto(u));
  }

  async findById(id: number) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /** 带角色一起查（登录校验 / profile 需要用它才能解析出角色权限） */
  async findByIdWithRole(id: number) {
    return this.prisma.user.findUnique({ where: { id }, include: { roleRef: true, store: true } });
  }

  async findByUsername(username: string) {
    // 带上角色：登录时要按角色解析出最终页面权限
    return this.prisma.user.findUnique({ where: { username }, include: { roleRef: true, store: true } });
  }

  /**
   * 更新用户。只允许改白名单里的字段（避免把非数据库列/关联字段直接 spread 进 Prisma）。
   * 传了 password 就重置密码；传了 permissions 就覆盖页面权限。
   */
  async update(id: number, dto: UpdateUserDto, currentUser?: any) {
    const target = await this.findById(id);
    if (!target) throw new NotFoundException('用户不存在');
    // 跨店改人一律 404（不暴露该 id 是否真实存在）
    this.assertInScope(currentUser, target);

    // 不允许把自己降级 / 停用 / 改掉超管身份，避免把自己锁在系统外面
    if (currentUser && currentUser.id === id) {
      if (dto.status !== undefined && Number(dto.status) !== 1) {
        throw new ForbiddenException('不能停用自己的账号');
      }
      if (dto.role !== undefined && dto.role !== target.role) {
        throw new ForbiddenException('不能修改自己的角色');
      }
    }

    const data: any = {};
    if (dto.username !== undefined) data.username = dto.username;
    if (dto.nickname !== undefined) data.nickname = dto.nickname;
    // 角色与店铺都要过一遍守卫：admin 不能把别人提成超管，也不能把人挪到别的店
    if (dto.role !== undefined) data.role = this.resolveRole(currentUser, dto.role);
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.password) data.password = await bcrypt.hash(dto.password, 10);
    if (dto.permissions !== undefined) data.permissions = serializePermissions(dto.permissions);
    if (dto.roleId !== undefined) data.roleId = dto.roleId;
    if (dto.storeId !== undefined) data.storeId = this.resolveStoreId(currentUser, dto.storeId ?? null);

    const user = await this.prisma.user.update({ where: { id }, data, include: { roleRef: true, store: true } });
    return this.toDto(user);
  }

  /**
   * 重置密码。
   * 之前这个接口完全不校验调用者是谁，导致任意 admin 可以重置超管密码来接管账号。
   */
  async resetPassword(id: number, newPassword: string, currentUser?: any) {
    if (!newPassword || newPassword.length < 6) {
      throw new ForbiddenException('新密码至少 6 位');
    }
    const target = await this.findById(id);
    if (!target) throw new NotFoundException('用户不存在');
    this.assertInScope(currentUser, target);
    if (currentUser && roleLevel(target.role) > roleLevel(currentUser.role)) {
      throw new ForbiddenException('不能重置更高权限账号的密码');
    }
    await this.prisma.user.update({ where: { id }, data: { password: await bcrypt.hash(newPassword, 10) } });
    return { id };
  }

  async remove(id: number, currentUser?: any) {
    if (currentUser && currentUser.id === id) {
      throw new ForbiddenException('不能删除自己的账号');
    }
    const target = await this.findById(id);
    if (!target) throw new NotFoundException('用户不存在');
    this.assertInScope(currentUser, target);
    if (currentUser && roleLevel(target.role) > roleLevel(currentUser.role)) {
      throw new ForbiddenException('不能删除更高权限的账号');
    }
    await this.prisma.user.delete({ where: { id } });
    return { id };
  }

  async touchLogin(id: number) {
    await this.prisma.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
  }

  async profile(id: number) {
    const user = await this.findByIdWithRole(id);
    if (!user) throw new NotFoundException('用户不存在');
    return this.toDto(user);
  }

  /** 是否超级管理员 */
  isSuperAdmin(user: { role?: string } | null | undefined) {
    return user?.role === SUPER_ADMIN_ROLE;
  }
}
