// src/settings/settings.module.ts
import { Module, Global } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { SettingsService } from './settings.service';
import { SystemSettingsService } from './system-settings.service';
import { UserSettingsService } from './user-settings.service';
import { ArmSettingsService } from './arm-settings.service';
import { UserArmSettingsService } from './user-arm-settings.service';
import { SystemSettingsController } from './system-settings.controller';
import { UserSettingsController } from './user-settings.controller';
import { ArmSettingsController } from './arm-settings.controller';

@Global() // ✅ برای استفاده در همه جای برنامه بدون نیاز به import مجدد
@Module({
    imports: [
        CacheModule.register({
            ttl: 300, // ۵ دقیقه
            max: 100, // حداکثر آیتم‌های کش
        }),
    ],
    controllers: [
        SystemSettingsController,
        UserSettingsController,
        ArmSettingsController,
    ],
    providers: [
        SettingsService,        // سرویس پایه
        SystemSettingsService,  // تنظیمات سیستم (ادمین)
        UserSettingsService,    // تنظیمات کاربر
        ArmSettingsService,     // تنظیمات بازار
        UserArmSettingsService, // تنظیمات کاربر-بازار
    ],
    exports: [
        SettingsService,
        SystemSettingsService,
        UserSettingsService,
        ArmSettingsService,
        UserArmSettingsService,
    ],
})
export class SettingsModule {}