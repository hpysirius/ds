import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PricingService } from './pricing.service';
import { PricingController } from './pricing.controller';
import { SourcingService } from './sourcing.service';
import { BrowserModule } from '../browser/browser.module';

@Module({
  imports: [
    BrowserModule,
    // 插件上报接口是 @Public，但仍允许带登录 token —— 用它把采集数据归到员工所在店铺
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ secret: config.get<string>('JWT_SECRET') }),
    }),
  ],
  controllers: [PricingController],
  providers: [PricingService, SourcingService],
  exports: [PricingService, SourcingService],
})
export class PricingModule {}
