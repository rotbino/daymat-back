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
}