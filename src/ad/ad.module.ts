// src/ad/ad.module.ts
import { Module } from '@nestjs/common';
import { AdController } from './ad.controller';
import { AdService } from './ad.service';
import { AdImportService } from './ad-import.service';
import { ArmModule } from '../arm/arm.module';
import { CreditModule } from '../credit/credit.module'; // ✅ اضافه شد
import { CatalogModule } from '../catalog/catalog.module'; // ✅ مسیریابی تماس — تیم بازوی فروش
import { FileModule } from '../file/file.module'; // ✅ عکس‌های اکسل — آپلود استیجینگ در ایمپورت

@Module({
    imports: [ArmModule, CreditModule, CatalogModule, FileModule], // ✅ CatalogMemberService برای مسیریابی تماس
    controllers: [AdController],
    providers: [AdService, AdImportService],
    exports: [AdService],
})
export class AdModule {}