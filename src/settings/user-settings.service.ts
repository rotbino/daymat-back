// src/settings/user-settings.service.ts
import { Injectable } from '@nestjs/common';
import { SettingsService } from './settings.service';

@Injectable()
export class UserSettingsService {
    constructor(private settingsService: SettingsService) {}

    async get(userId: string, key: string, defaultValue?: any) {
        return this.settingsService.get(key, { userId, defaultValue });
    }

    async set(userId: string, key: string, value: any) {
        return this.settingsService.set(key, value, 'user', userId);
    }

    async getAppearance(userId: string) {
        const settings = await this.settingsService.getGroup('appearance', { userId });
        return {
            theme: settings['appearance.theme'] || 'light',
            font: settings['appearance.font'] || 'Vazirmatn',
        };
    }

    async updateAppearance(userId: string, data: { theme: string; font: string }) {
        await this.set(userId, 'appearance.theme', data.theme);
        await this.set(userId, 'appearance.font', data.font);
        return { message: 'تنظیمات ظاهری به‌روزرسانی شد' };
    }
}