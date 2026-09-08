// src/ad/ad.module.ts
import { Module } from '@nestjs/common';
import { AdController } from './ad.controller';
import { AdService } from './ad.service';
import { ArmModule } from '../arm/arm.module';
import { CreditModule } from '../credit/credit.module'; // ✅ اضافه شد

@Module({
    imports: [ArmModule, CreditModule], // ✅ اضافه شد
    controllers: [AdController],
    providers: [AdService],
    exports: [AdService],
})
export class AdModule {}