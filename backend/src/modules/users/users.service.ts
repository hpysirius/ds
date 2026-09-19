import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateUserDto) {
    const exists = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (exists) throw new ConflictException('登录名已存在');

    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        password: await bcrypt.hash(dto.password, 10),
        nickname: dto.nickname,
        role: dto.role || 'user',
      },
    });
    const { password, ...rest } = user;
    return rest;
  }

  async findAll() {
    const users = await this.prisma.user.findMany({ orderBy: { id: 'asc' } });
    return users.map(({ password, ...u }) => u);
  }

  async findById(id: number) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findByUsername(username: string) {
    return this.prisma.user.findUnique({ where: { username } });
  }

  async update(id: number, dto: UpdateUserDto) {
    const data: any = { ...dto };
    if (dto.password) data.password = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.update({ where: { id }, data });
    const { password, ...rest } = user;
    return rest;
  }

  async remove(id: number) {
    await this.prisma.user.delete({ where: { id } });
    return { id };
  }

  async touchLogin(id: number) {
    await this.prisma.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
  }

  async profile(id: number) {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('用户不存在');
    const { password, ...rest } = user;
    return rest;
  }
}
