// src/settings/arm-settings.service.ts
import { Injectable, ForbiddenException } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ArmSettingsService {
    constructor(
        private settingsService: SettingsService,
        private prisma: PrismaService,
    ) {}

    private async checkArmAdmin(armId: string, userId: string) {
        const membership = await this.prisma.armMembership.findFirst({
            where: {
                armId,
                userId,
                role: 'arm_owner',
                status: 'active',
            },
        });
        if (!membership) {
            throw new ForbiddenException({
                errorCode: 'NOT_ARM_ADMIN',
                message: 'شما مدیر این بازار نیستید',
            });
        }
    }

    async get(armId: string, userId: string, key: string, defaultValue?: any) {
        await this.checkArmAdmin(armId, userId);
        return this.settingsService.get(key, { armId, defaultValue });
    }

    async set(armId: string, userId: string, key: string, value: any) {
        await this.checkArmAdmin(armId, userId);
        return this.settingsService.set(key, value, 'arm', armId);
    }

    async getEconomySettings(armId: string, userId: string) {
        await this.checkArmAdmin(armId, userId);
        const settings = await this.settingsService.getGroup('economy', { armId });
        return {
            currency: settings['economy.currency'] || 'IRR',
            bumpCost: settings['economy.bumpCost'] || 10,
        };
    }

    async updateEconomySettings(
        armId: string,
        userId: string,
        data: { currency: string; bumpCost: number },
    ) {
        await this.checkArmAdmin(armId, userId);
        await this.set(armId, userId, 'economy.currency', data.currency);
        await this.set(armId, userId, 'economy.bumpCost', data.bumpCost);
        return { message: 'تنظیمات اقتصادی به‌روزرسانی شد' };
    }
}