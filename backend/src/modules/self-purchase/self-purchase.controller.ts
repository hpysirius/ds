import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { SelfPurchaseService } from './self-purchase.service';
import {
  CreateSelfPurchaseDto,
  QuerySelfPurchaseDto,
  UpdateSelfPurchaseDto,
} from './dto/self-purchase.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('自采购')
@Controller('self-purchase')
export class SelfPurchaseController {
  constructor(private readonly service: SelfPurchaseService) {}

  @ApiBearerAuth()
  @Get()
  @ApiOperation({ summary: '自采购列表（按店铺隔离）' })
  list(@Query() q: QuerySelfPurchaseDto, @CurrentUser() user: any) {
    return this.service.findAll(q, user);
  }

  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: '新增自采购条目' })
  create(@Body() dto: CreateSelfPurchaseDto, @CurrentUser() user: any) {
    return this.service.create(dto, user);
  }

  /**
   * 定价预览：只算不落库，逻辑与「落库时自动算价」完全一致（同一个 computePrice）。
   * 页面上点「算定价」即时看结果用。
   */
  @ApiBearerAuth()
  @Post('price-preview')
  @ApiOperation({ summary: '定价预览：复用核价引擎算运费/定价/利润（不落库）' })
  preview(@Body() dto: CreateSelfPurchaseDto) {
    return this.service.previewPrice(dto);
  }

  /**
   * 插件「记一笔」备忘录上报。
   * @Public：插件在网页里没有登录态，靠 identity-bridge 推来的 ds token 归店。
   */
  @Public()
  @Post('memo')
  @ApiOperation({ summary: '插件「记一笔」备忘录上报（@Public，按 token 归店）' })
  memo(@Body() dto: CreateSelfPurchaseDto, @Headers('authorization') auth?: string) {
    return this.service.memo(dto, auth);
  }

  @ApiBearerAuth()
  @Patch(':id')
  @ApiOperation({ summary: '编辑自采购条目' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSelfPurchaseDto,
    @CurrentUser() user: any,
  ) {
    return this.service.update(id, dto, user);
  }

  @ApiBearerAuth()
  @Delete(':id')
  @ApiOperation({ summary: '删除自采购条目' })
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.service.remove(id, user);
  }

  @ApiBearerAuth()
  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: '导出自采购 CSV（含俄语文案 / 上架状态 / 留痕，与列表筛选一致）' })
  async export(@Res() res: Response, @Query() q: QuerySelfPurchaseDto, @CurrentUser() user: any) {
    const csv = await this.service.exportCsv(q, user);
    res.setHeader('Content-Disposition', 'attachment; filename="self-purchase.csv"');
    res.send(csv);
  }
}
