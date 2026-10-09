import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PricingModule } from '../pricing/pricing.module';
import { SelfPurchaseService } from './self-purchase.service';
import { SelfPurchaseController } from './self-purchase.controller';

@Module({
  imports: [
    // 算价直接复用核价引擎（PricingService.price），不在自采购里重造物流/利润算法
    PricingModule,
    // 插件「记一笔」是 @Public，但仍允许带登录 token —— 用它把备忘录归到员工所在店铺
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ secret: config.get<string>('JWT_SECRET') }),
    }),
  ],
  controllers: [SelfPurchaseController],
  providers: [SelfPurchaseService],
  exports: [SelfPurchaseService],
})
export class SelfPurchaseModule {}
