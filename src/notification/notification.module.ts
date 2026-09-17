// src/notification/notification.module.ts
import { Global, Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';

@Global() // ✅ سرویس اعلان همه‌جا لازم است (بازوی فروش، کسب‌وکار، بازار)
@Module({
    controllers: [NotificationController],
    providers: [NotificationService],
    exports: [NotificationService],
})
export class NotificationModule {}
