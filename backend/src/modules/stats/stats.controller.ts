import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StatsService } from './stats.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('数据概览')
@Controller('stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @ApiBearerAuth()
  @Get('overview')
  @ApiOperation({ summary: '首页概览数据（按店铺隔离）' })
  overview(@CurrentUser() user: any, @Query('storeId') storeId?: string) {
    return this.statsService.overview(user, storeId);
  }
}
