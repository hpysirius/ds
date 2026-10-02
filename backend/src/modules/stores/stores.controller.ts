import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StoresService } from './stores.service';
import { CreateStoreDto, UpdateStoreDto } from './dto/store.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { SUPER_ADMIN_ROLE } from '../../common/constants/permissions';

@ApiTags('店铺管理')
@Controller('stores')
export class StoresController {
  constructor(private readonly storesService: StoresService) {}

  @ApiBearerAuth()
  @Roles(SUPER_ADMIN_ROLE)
  @Get()
  @ApiOperation({ summary: '店铺列表（含各店员工数/商品数/定价数）' })
  findAll() {
    return this.storesService.findAll();
  }

  @ApiBearerAuth()
  @Roles(SUPER_ADMIN_ROLE)
  @Post()
  @ApiOperation({ summary: '创建店铺' })
  create(@Body() dto: CreateStoreDto) {
    return this.storesService.create(dto);
  }

  @ApiBearerAuth()
  @Roles(SUPER_ADMIN_ROLE)
  @Put(':id')
  @ApiOperation({ summary: '修改店铺' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateStoreDto) {
    return this.storesService.update(id, dto);
  }

  @ApiBearerAuth()
  @Roles(SUPER_ADMIN_ROLE)
  @Delete(':id')
  @ApiOperation({ summary: '删除店铺（员工/商品/定价自动解绑为未分配）' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.storesService.remove(id);
  }
}
