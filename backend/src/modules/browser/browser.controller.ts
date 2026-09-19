import { Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BrowserService } from './browser.service';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('浏览器接管')
@Controller('browser')
export class BrowserController {
  constructor(private readonly browserService: BrowserService) {}

  @Public()
  @Get('status')
  @ApiOperation({ summary: '查看调试端口与 Chrome 状态' })
  status() {
    return this.browserService.status();
  }

  @Public()
  @Post('start')
  @ApiOperation({ summary: '准备并启动带调试端口的 Chrome' })
  start() {
    return this.browserService.ensure();
  }

  @Public()
  @Post('stop')
  @ApiOperation({ summary: '关闭调试实例' })
  stop() {
    return this.browserService.stop();
  }
}
