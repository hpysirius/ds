import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { StoresModule } from './modules/stores/stores.module';
import { BrowserModule } from './modules/browser/browser.module';
import { CollectModule } from './modules/collect/collect.module';
import { ProductsModule } from './modules/products/products.module';
import { RulesModule } from './modules/rules/rules.module';
import { ScreeningModule } from './modules/screening/screening.module';
import { StatsModule } from './modules/stats/stats.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 300 }]),
    PrismaModule,
    AuthModule,
    UsersModule,
    RolesModule,
    StoresModule,
    BrowserModule,
    CollectModule,
    ProductsModule,
    RulesModule,
    ScreeningModule,
    StatsModule,
    PricingModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // 之前只 import 了 ThrottlerModule 却没注册守卫，限流完全没生效 ——
    // 那些 @Public 的重接口（图片代理、插件上报、1688 抓取）可以被匿名高频调用
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
