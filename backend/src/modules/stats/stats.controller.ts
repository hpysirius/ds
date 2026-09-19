import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { StatsService } from './stats.service';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('数据概览')
@Controller('stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Public()
  @Get('overview')
  @ApiOperation({ summary: '首页概览数据' })
  overview() {
    return this.statsService.overview();
  }
}
