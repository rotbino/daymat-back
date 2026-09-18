// src/settings/system-settings.service.ts
import { Injectable } from '@nestjs/common';
import { SettingsService } from './settings.service';

@Injectable()
export class SystemSettingsService {
    constructor(private settingsService: SettingsService) {}

    // ✅ فقط ادمین می‌تواند تنظیمات سیستم را تغییر دهد
    async get(key: string, defaultValue?: any) {
        return this.settingsService.get(key, { defaultValue });
    }

    async set(key: string, value: any, description?: string) {
        return this.settingsService.set(key, value, 'system', '', undefined, description);
    }

    async getGroup(group: string) {
        return this.settingsService.getGroup(group);
    }

    // ✅ تنظیمات اعتبار
    async getCreditSettings() {
        const settings = await this.settingsService.getGroup('credit');
        return {
            signupBonus: settings['credit.signupBonus'] ?? 50,
            armJoinBonus: settings['credit.armJoinBonus'] ?? 10,
            bumpCost: settings['credit.bumpCost'] ?? 10,
            maxTotalFreeAdPerUser: settings['credit.maxTotalFreeAdPerUser'] ?? 5,
            dailyCallLimit: settings['credit.dailyCallLimit'] ?? 20,
        };
    }

    async updateCreditSettings(data: any) {
        const updates = [
            { key: 'credit.signupBonus', value: data.signupBonus },
            { key: 'credit.armJoinBonus', value: data.armJoinBonus },
            { key: 'credit.bumpCost', value: data.bumpCost },
            { key: 'credit.maxTotalFreeAdPerUser', value: data.maxTotalFreeAdPerUser },
            { key: 'credit.dailyCallLimit', value: data.dailyCallLimit },
        ];
        for (const item of updates) {
            await this.set(item.key, item.value, 'تنظیمات اعتبار');
        }
        return { message: 'تنظیمات اعتبار به‌روزرسانی شد' };
    }

    // ============================================================
    // ✅ تنظیمات بازوها — اقتصادِ مچینگِ دوطرفهٔ خریدار↔تامین‌کننده
    //    قیمت اعتبار سراسری و ثابت است؛ بازارها فقط تعدادِ مصرف را تنظیم می‌کنند.
    //    مهم: تا وقتی enforceMatchLimits خاموش است هیچ کاربری محدود نمی‌شود —
    //    فقط مصرف ثبت می‌شود تا بعداً درآمدزایی با یک کلید روشن شود.
    // ============================================================
    async getArmsSettings() {
        const settings = await this.settingsService.getGroup('arms');
        return {
            enforceMatchLimits: settings['arms.enforceMatchLimits'] ?? false,
            matchFreeRevealsDaily: settings['arms.matchFreeRevealsDaily'] ?? 3,
            matchMaxRevealsDaily: settings['arms.matchMaxRevealsDaily'] ?? 10,
            creditPriceToman: settings['arms.creditPriceToman'] ?? 1000,
            freeProductsPerCatalog: settings['arms.freeProductsPerCatalog'] ?? 20,
            packages: settings['arms.packages'] ?? [],
        };
    }

    async updateArmsSettings(data: any) {
        const updates = [
            { key: 'arms.enforceMatchLimits', value: !!data.enforceMatchLimits },
            { key: 'arms.matchFreeRevealsDaily', value: Number(data.matchFreeRevealsDaily) || 0 },
            { key: 'arms.matchMaxRevealsDaily', value: Number(data.matchMaxRevealsDaily) || 0 },
            { key: 'arms.creditPriceToman', value: Number(data.creditPriceToman) || 0 },
            { key: 'arms.freeProductsPerCatalog', value: Number(data.freeProductsPerCatalog) || 0 },
        ];
        if (Array.isArray(data.packages)) {
            updates.push({ key: 'arms.packages', value: data.packages });
        }
        for (const item of updates) {
            await this.set(item.key, item.value, 'تنظیمات بازوها — رایگان/پولی و اعتبار');
        }
        return { message: 'تنظیمات بازوها به‌روزرسانی شد' };
    }
}