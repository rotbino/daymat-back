// src/settings/settings.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

@Injectable()
export class SettingsService {
    private readonly CACHE_TTL = 300;

    constructor(
        private prisma: PrismaService,
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
    ) {}

    // ============================================================
    // ✅ دریافت یک تنظیمات
    // ============================================================
    async get(
        key: string,
        options: {
            userId?: string;
            armId?: string;
            defaultValue?: any;
        } = {},
    ): Promise<any> {
        const { userId, armId, defaultValue } = options;

        // ۱. تنظیمات کاربر-بازار
        if (userId && armId) {
            const scopeId = `user-${userId}_arm-${armId}`;
            const setting = await this.prisma.setting.findUnique({
                where: {
                    key_scope_scopeId: {
                        key,
                        scope: 'user_arm',
                        scopeId,
                    },
                },
            });
            if (setting) return setting.value;
        }

        // ۲. تنظیمات کاربر
        if (userId) {
            const setting = await this.prisma.setting.findUnique({
                where: {
                    key_scope_scopeId: {
                        key,
                        scope: 'user',
                        scopeId: userId,
                    },
                },
            });
            if (setting) return setting.value;
        }

        // ۳. تنظیمات بازار
        if (armId) {
            const setting = await this.prisma.setting.findUnique({
                where: {
                    key_scope_scopeId: {
                        key,
                        scope: 'arm',
                        scopeId: armId,
                    },
                },
            });
            if (setting) return setting.value;
        }

        // ۴. ✅ تنظیمات سیستم - با scopeId: "system"
        const system = await this.prisma.setting.findUnique({
            where: {
                key_scope_scopeId: {
                    key,
                    scope: 'system',
                    scopeId: 'system',  // ✅ به جای "" از "system" استفاده کن
                },
            },
        });
        if (system) return system.value;

        return defaultValue;
    }

    // ============================================================
    // ✅ تنظیم یک مقدار
    // ============================================================
    async set(
        key: string,
        value: any,
        scope: 'system' | 'user' | 'arm' | 'user_arm',
        scopeId: string = 'system',
        group?: string,
        description?: string,
    ): Promise<void> {
        // ✅ برای system، scopeId رو "system" بزار
        const finalScopeId = scope === 'system' ? 'system' : scopeId;

        await this.prisma.setting.upsert({
            where: {
                key_scope_scopeId: {
                    key,
                    scope,
                    scopeId: finalScopeId,
                },
            },
            update: {
                value,
                group: group || undefined,
                description: description || undefined,
                updatedAt: new Date(),
            },
            create: {
                key,
                value,
                scope,
                scopeId: finalScopeId,
                group: group || undefined,
                description: description || undefined,
            },
        });

        await this.cacheManager.del(`setting:${key}`);
    }

    // ============================================================
    // ✅ دریافت گروه تنظیمات
    // ============================================================
    async getGroup(
        group: string,
        options: {
            userId?: string;
            armId?: string;
        } = {},
    ): Promise<Record<string, any>> {
        const { userId, armId } = options;

        const where: any = {
            group,
            OR: [
                { scope: 'system', scopeId: 'system' },  // ✅ به جای "" از "system" استفاده کن
            ],
        };

        if (userId) {
            where.OR.push({ scope: 'user', scopeId: userId });
        }
        if (armId) {
            where.OR.push({ scope: 'arm', scopeId: armId });
        }
        if (userId && armId) {
            where.OR.push({
                scope: 'user_arm',
                scopeId: `user-${userId}_arm-${armId}`,
            });
        }

        const settings = await this.prisma.setting.findMany({ where });

        const result: Record<string, any> = {};
        for (const setting of settings) {
            result[setting.key] = setting.value;
        }

        return result;
    }

    // ============================================================
    // ✅ مقداردهی اولیه سیستم (Seed)
    // ============================================================
    async seedSystemDefaults() {
        const defaults = [
            { key: 'credit.signupBonus', value: 50, group: 'credit', description: 'اعتبار هدیه ثبت‌نام' },
            { key: 'credit.armJoinBonus', value: 10, group: 'credit', description: 'اعتبار هدیه عضویت' },
            { key: 'credit.bumpCost', value: 10, group: 'credit', description: 'هزینه نردبان' },
            { key: 'credit.maxTotalFreeAdPerUser', value: 5, group: 'credit', description: 'حداکثر تعداد آگهی رایگان' },
            { key: 'credit.dailyCallLimit', value: 20, group: 'credit', description: 'محدودیت تماس روزانه' },
            { key: 'general.appName', value: 'دِیمَت', group: 'general', description: 'نام برنامه' },
            { key: 'general.defaultLocale', value: 'fa', group: 'general', description: 'زبان پیش‌فرض' },
            { key: 'general.supportPhone', value: '09123456789', group: 'general', description: 'شماره پشتیبانی' },
            { key: 'general.supportEmail', value: 'support@daymat.com', group: 'general', description: 'ایمیل پشتیبانی' },
            { key: 'security.maxLoginAttempts', value: 5, group: 'security', description: 'حداکثر تلاش برای ورود' },
            { key: 'security.sessionTimeout', value: 3600, group: 'security', description: 'مدت زمان نشست' },
            { key: 'security.requireEmailVerification', value: false, group: 'security', description: 'نیاز به تأیید ایمیل' },
            { key: 'appearance.defaultTheme', value: 'light', group: 'appearance', description: 'تم پیش‌فرض' },
            { key: 'appearance.defaultFont', value: 'Vazirmatn', group: 'appearance', description: 'فونت پیش‌فرض' },
            { key: 'appearance.primaryColor', value: '#610000', group: 'appearance', description: 'رنگ اصلی' },
        ];

        for (const item of defaults) {
            await this.set(item.key, item.value, 'system', 'system', item.group, item.description);
        }
    }
}