import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { parsePermissions, serializePermissions } from '../../common/constants/permissions';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  private toDto(role: any, userCount?: number) {
    if (!role) return role;
    // _count 是 Prisma 的 include 产物，不该出现在接口响应里
    const { permissions, _count, ...rest } = role;
    return { ...rest, permissions: parsePermissions(permissions), userCount: userCount ?? 0 };
  }

  async findAll() {
    const roles = await this.prisma.role.findMany({
      orderBy: { id: 'asc' },
      include: { _count: { select: { users: true } } },
    });
    return roles.map((r) => this.toDto(r, r._count?.users ?? 0));
  }

  async create(dto: CreateRoleDto) {
    const exists = await this.prisma.role.findUnique({ where: { code: dto.code } });
    if (exists) throw new ConflictException('角色编码已存在');

    const role = await this.prisma.role.create({
      data: {
        name: dto.name,
        code: dto.code,
        remark: dto.remark,
        permissions: serializePermissions(dto.permissions ?? []),
      },
    });
    return this.toDto(role, 0);
  }

  async update(id: number, dto: UpdateRoleDto) {
    const target = await this.prisma.role.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('角色不存在');

    if (dto.code && dto.code !== target.code) {
      const dup = await this.prisma.role.findUnique({ where: { code: dto.code } });
      if (dup) throw new ConflictException('角色编码已存在');
    }

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.code !== undefined) data.code = dto.code;
    if (dto.remark !== undefined) data.remark = dto.remark;
    if (dto.permissions !== undefined) data.permissions = serializePermissions(dto.permissions);

    const role = await this.prisma.role.update({ where: { id }, data });
    const count = await this.prisma.user.count({ where: { roleId: id } });
    return this.toDto(role, count);
  }

  /** 删除角色：已分配该角色的员工会被置为「无角色」（外键 onDelete: SetNull） */
  async remove(id: number) {
    const target = await this.prisma.role.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('角色不存在');
    await this.prisma.role.delete({ where: { id } });
    return { id };
  }
}
