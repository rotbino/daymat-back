// src/inquiry/inquiry.module.ts
// صفحه خرید (استعلام قیمت) — ماژول
import { Module } from '@nestjs/common';
import { InquiryController } from './inquiry.controller';
import { InquiryService } from './inquiry.service';
import { NotificationModule } from '../notification/notification.module';

@Module({
    imports: [NotificationModule], // 🔔 اعلان پیشنهاد جدید / نتیجهٔ پیشنهاد
    controllers: [InquiryController],
    providers: [InquiryService],
    exports: [InquiryService],
})
export class InquiryModule {}
