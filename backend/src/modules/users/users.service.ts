import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import {
  parsePermissions,
  resolvePermissions,
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
    const { password, permissions, roleRef, ...rest } = user;
    return {
      ...rest,
      permissions: resolvePermissions(user),
      roleId: rest.roleId ?? null,
      roleName: roleRef?.name ?? null,
    };
  }

  async create(dto: CreateUserDto) {
    const exists = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (exists) throw new ConflictException('登录名已存在');

    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        password: await bcrypt.hash(dto.password, 10),
        nickname: dto.nickname,
        role: dto.role || 'user',
        permissions: serializePermissions(dto.permissions ?? []),
        status: dto.status ?? 1,
        ...(dto.roleId !== undefined ? { roleId: dto.roleId } : {}),
      },
      include: { roleRef: true },
    });
    return this.toDto(user);
  }

  async findAll() {
    const users = await this.prisma.user.findMany({ orderBy: { id: 'asc' }, include: { roleRef: true } });
    return users.map((u) => this.toDto(u));
  }

  async findById(id: number) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /** 带角色一起查（登录校验 / profile 需要用它才能解析出角色权限） */
  async findByIdWithRole(id: number) {
    return this.prisma.user.findUnique({ where: { id }, include: { roleRef: true } });
  }

  async findByUsername(username: string) {
    // 带上角色：登录时要按角色解析出最终页面权限
    return this.prisma.user.findUnique({ where: { username }, include: { roleRef: true } });
  }

  /**
   * 更新用户。只允许改白名单里的字段（避免把非数据库列/关联字段直接 spread 进 Prisma）。
   * 传了 password 就重置密码；传了 permissions 就覆盖页面权限。
   */
  async update(id: number, dto: UpdateUserDto, currentUser?: { id: number; role: string }) {
    const target = await this.findById(id);
    if (!target) throw new NotFoundException('用户不存在');

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
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.password) data.password = await bcrypt.hash(dto.password, 10);
    if (dto.permissions !== undefined) data.permissions = serializePermissions(dto.permissions);
    if (dto.roleId !== undefined) data.roleId = dto.roleId;

    const user = await this.prisma.user.update({ where: { id }, data, include: { roleRef: true } });
    return this.toDto(user);
  }

  /** 重置密码（超管专用，前端可单独调用） */
  async resetPassword(id: number, newPassword: string) {
    if (!newPassword || newPassword.length < 6) {
      throw new ForbiddenException('新密码至少 6 位');
    }
    const target = await this.findById(id);
    if (!target) throw new NotFoundException('用户不存在');
    await this.prisma.user.update({ where: { id }, data: { password: await bcrypt.hash(newPassword, 10) } });
    return { id };
  }

  async remove(id: number, currentUser?: { id: number }) {
    if (currentUser && currentUser.id === id) {
      throw new ForbiddenException('不能删除自己的账号');
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
