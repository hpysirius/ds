import { Controller, Delete, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { QueryProductDto } from './dto/query-product.dto';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('商品库')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: '商品列表（多条件筛选）' })
  findAll(@Query() query: QueryProductDto) {
    return this.productsService.findAll(query);
  }

  @Public()
  @Get('categories')
  @ApiOperation({ summary: '类目分布' })
  categories() {
    return this.productsService.categories();
  }

  @Public()
  @Get(':sku/history')
  @ApiOperation({ summary: '商品指标历史' })
  history(@Param('sku') sku: string) {
    return this.productsService.history(sku);
  }

  @Public()
  @Get(':sku')
  @ApiOperation({ summary: '商品详情' })
  findOne(@Param('sku') sku: string) {
    return this.productsService.findOne(sku);
  }

  @ApiBearerAuth()
  @Delete(':id')
  @ApiOperation({ summary: '删除商品' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.productsService.remove(id);
  }
}
