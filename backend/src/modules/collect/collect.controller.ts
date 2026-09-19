import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CollectService } from './collect.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { QueryTaskDto } from './dto/query-task.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('数据采集')
@Controller('collect/tasks')
export class CollectController {
  constructor(private readonly collectService: CollectService) {}

  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: '创建并执行采集任务' })
  create(@Body() dto: CreateTaskDto, @CurrentUser('id') userId: number) {
    return this.collectService.createTask(dto, userId);
  }

  @Public()
  @Get()
  @ApiOperation({ summary: '采集任务列表' })
  findAll(@Query() query: QueryTaskDto) {
    return this.collectService.findAll(query);
  }

  @Public()
  @Get('running')
  @ApiOperation({ summary: '正在运行的任务 ID' })
  running() {
    return this.collectService.runningIds();
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: '采集任务详情（含日志）' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.collectService.findOne(id);
  }

  @ApiBearerAuth()
  @Delete(':id')
  @ApiOperation({ summary: '删除采集任务' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.collectService.remove(id);
  }
}
