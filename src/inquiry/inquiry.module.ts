// src/inquiry/inquiry.module.ts
// کاتالوگ خرید (استعلام قیمت) — ماژول
import { Module } from '@nestjs/common';
import { InquiryController } from './inquiry.controller';
import { InquiryService } from './inquiry.service';

@Module({
    controllers: [InquiryController],
    providers: [InquiryService],
    exports: [InquiryService],
})
export class InquiryModule {}
