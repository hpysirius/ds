import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { QueryProductDto } from './dto/query-product.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('商品库')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @ApiBearerAuth()
  @Get()
  @ApiOperation({ summary: '商品列表（多条件筛选，按店铺隔离）' })
  findAll(@Query() query: QueryProductDto, @CurrentUser() user: any) {
    return this.productsService.findAll(query, user);
  }

  @ApiBearerAuth()
  @Get('categories')
  @ApiOperation({ summary: '类目分布（按店铺隔离）' })
  categories(@CurrentUser() user: any, @Query('storeId') storeId?: string) {
    return this.productsService.categories(user, storeId);
  }

  @ApiBearerAuth()
  @Get(':sku/history')
  @ApiOperation({ summary: '商品指标历史' })
  history(@Param('sku') sku: string, @CurrentUser() user: any) {
    return this.productsService.history(sku, user);
  }

  @ApiBearerAuth()
  @Get(':sku')
  @ApiOperation({ summary: '商品详情' })
  findOne(@Param('sku') sku: string, @CurrentUser() user: any) {
    return this.productsService.findOne(sku, user);
  }

  @ApiBearerAuth()
  @Delete(':id')
  @ApiOperation({ summary: '删除商品' })
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.productsService.remove(id, user);
  }

  /**
   * 批量删除。用 POST 而不是 DELETE：DELETE 带 body 容易被 nginx/代理丢掉。
   *   { ids: [1,2,3] }  只删这几个
   *   { filter: {...} } 按列表页当前筛选条件删（不传 ids 时生效）
   */
  @ApiBearerAuth()
  @Post('bulk-delete')
  @ApiOperation({ summary: '批量删除商品（按 id 或按筛选条件）' })
  removeMany(@Body() dto: { ids?: number[]; filter?: any; storeId?: number }, @CurrentUser() user: any, @Query('storeId') storeId?: string) {
    return this.productsService.removeMany(dto || {}, user, storeId);
  }
}
