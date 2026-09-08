// src/settings/user-arm-settings.service.ts
import { Injectable } from '@nestjs/common';
import { SettingsService } from './settings.service';

@Injectable()
export class UserArmSettingsService {
    constructor(private settingsService: SettingsService) {}

    private getScopeId(userId: string, armId: string) {
        return `user-${userId}_arm-${armId}`;
    }

    async get(userId: string, armId: string, key: string, defaultValue?: any) {
        return this.settingsService.get(key, { userId, armId, defaultValue });
    }

    async set(userId: string, armId: string, key: string, value: any) {
        return this.settingsService.set(key, value, 'user_arm', this.getScopeId(userId, armId));
    }

    async getAppearance(userId: string, armId: string) {
        const theme = await this.get(userId, armId, 'appearance.theme', 'light');
        const font = await this.get(userId, armId, 'appearance.font', 'Vazirmatn');
        return { theme, font };
    }
}