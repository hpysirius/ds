import { Module } from '@nestjs/common';
import { PricingService } from './pricing.service';
import { PricingController } from './pricing.controller';
import { SourcingService } from './sourcing.service';
import { BrowserModule } from '../browser/browser.module';

@Module({
  imports: [BrowserModule],
  controllers: [PricingController],
  providers: [PricingService, SourcingService],
  exports: [PricingService, SourcingService],
})
export class PricingModule {}
