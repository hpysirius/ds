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
  const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3100')
    .split(',')
    .map((s) => s.trim());
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
