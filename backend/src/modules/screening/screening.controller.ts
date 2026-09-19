import { Body, Controller, Delete, Get, Header, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ScreeningService } from './screening.service';
import { CreatePresetDto } from './dto/create-preset.dto';
import { UpdatePresetDto } from './dto/update-preset.dto';
import { RunScreeningDto } from './dto/run-screening.dto';
import { QueryRunDto } from './dto/query-run.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('智能筛选')
@Controller('screening')
export class ScreeningController {
  constructor(private readonly screeningService: ScreeningService) {}

  // ---- 规则预设 ----
  @Public()
  @Get('presets')
  @ApiOperation({ summary: '规则预设列表' })
  listPresets() {
    return this.screeningService.listPresets();
  }

  @Public()
  @Get('rules/default')
  @ApiOperation({ summary: '默认规则阈值' })
  defaultRules() {
    return this.screeningService.defaultRules();
  }

  @ApiBearerAuth()
  @Post('presets')
  @ApiOperation({ summary: '新建规则预设' })
  createPreset(@Body() dto: CreatePresetDto, @CurrentUser('id') userId: number) {
    return this.screeningService.createPreset(dto, userId);
  }

  @ApiBearerAuth()
  @Patch('presets/:id')
  @ApiOperation({ summary: '修改规则预设' })
  updatePreset(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePresetDto) {
    return this.screeningService.updatePreset(id, dto);
  }

  @ApiBearerAuth()
  @Delete('presets/:id')
  @ApiOperation({ summary: '删除规则预设' })
  removePreset(@Param('id', ParseIntPipe) id: number) {
    return this.screeningService.removePreset(id);
  }

  // ---- 执行与结果 ----
  @Public()
  @Post('run')
  @ApiOperation({ summary: '按规则执行一轮筛选' })
  run(@Body() dto: RunScreeningDto) {
    return this.screeningService.run(dto);
  }

  @Public()
  @Get('runs')
  @ApiOperation({ summary: '筛选批次列表' })
  listRuns(@Query() query: QueryRunDto) {
    return this.screeningService.listRuns(query);
  }

  @Public()
  @Get('runs/:id')
  @ApiOperation({ summary: '筛选结果明细' })
  runDetail(@Param('id', ParseIntPipe) id: number, @Query() query: QueryRunDto) {
    return this.screeningService.runDetail(id, query);
  }

  @Public()
  @Get('runs/:id/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: '导出筛选结果 CSV' })
  async export(@Param('id', ParseIntPipe) id: number, @Query('grade') grade: string, @Res() res: Response) {
    const csv = await this.screeningService.exportCsv(id, grade);
    res.setHeader('Content-Disposition', `attachment; filename="screening_${id}.csv"`);
    res.send(csv);
  }
}
