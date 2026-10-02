import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as bodyParser from 'body-parser';
import * as express from 'express';
import * as path from 'path';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 请求体大小限制
  app.use(bodyParser.json({ limit: '50mb' }));
  app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

  // 静态文件
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

  // CORS
  /*
   * 允许的来源 = FRONTEND_URL + 线上站点地址 + EXTRA_CORS_ORIGINS。
   * 线上那几条是给「本地抓取回退」用的：在线上页面（域名或 IP）里操作核价时，
   * 如果线上机房 IP 被 1688 风控，前端会直接请求用户本机的后端（http://localhost:3101）
   * 来抓 1688 —— 本机出口是家庭宽带，不会命中风控。这时浏览器 origin 是线上地址，
   * 所以本地后端必须放行它，否则会被 CORS 拦掉。
   *
   * 注意：线上主站已从 IP 换成域名 http://ozon.qinxianty.com，两个地址都保留，
   * 避免老书签/老插件配置直接失效。
   */
  const DEFAULT_PUBLIC_SITES = 'http://ozon.qinxianty.com,http://114.132.99.141';
  const allowedOrigins = [
    ...(process.env.FRONTEND_URL || 'http://localhost:3100').split(','),
    ...(process.env.PUBLIC_SITE_URL || DEFAULT_PUBLIC_SITES).split(','),
    ...(process.env.EXTRA_CORS_ORIGINS || '').split(','),
  ]
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  /*
   * Chrome 的「Private Network Access」(PNA)：扩展（chrome-extension:// 源）请求 localhost 属于
   * 访问私有网络，除普通 CORS 头外还要求服务端返回 `Access-Control-Allow-Private-Network: true`，
   * 否则浏览器直接按网络失败处理 —— 现象就是插件里一堆 "Failed to fetch"（而 curl 完全正常）。
   * 必须放在 enableCors 之前，这样预检(OPTIONS)响应里也带上。
   */
  app.use((_req: any, res: any, next: any) => {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    next();
  });

  /*
   * CORS：除前端白名单外，还要放行 chrome-extension:// —— 「DS 采集助手」插件运行在用户
   * 自己的正常 Chrome 里（origin 是 chrome-extension://<id>，重装后 id 会变，
   * 所以按前缀放行而不是写死某个 id）。插件只走 /pricing/extension/* 这几个 @Public 接口。
   */
  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return cb(null, true); // curl / 服务端直调没有 origin
      if (allowedOrigins.includes(origin)) return cb(null, true);
      if (origin.startsWith('chrome-extension://')) return cb(null, true);
      cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
    // 导出 CSV 时前端要读文件名；跨域场景（本地 dev 前后端不同端口）默认读不到该响应头
    exposedHeaders: ['Content-Disposition'],
  });

  app.useGlobalFilters(new AllExceptionsFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('电商选品分析系统 API')
    .setDescription('Ozon 选品数据采集、商品库与智能筛选接口文档')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const port = process.env.PORT || 3101;
  await app.listen(port);
  console.log(`🚀 电商选品分析系统后端运行在: http://localhost:${port}`);
  console.log(`📄 API文档: http://localhost:${port}/api`);
}

bootstrap();
