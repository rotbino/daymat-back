// prisma/seed/settings.seed.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function seedSettings() {
    console.log('🌱 Seeding system settings...');

    const defaults = [
        // ============================================================
        // تنظیمات اعتبار (Credit)
        // ============================================================
        {
            key: 'credit.signupBonus',
            value: 50,
            scope: 'system',
            scopeId: 'system',
            group: 'credit',
            description: 'اعتبار هدیه ثبت‌نام',
        },
        {
            key: 'credit.armJoinBonus',
            value: 10,
            scope: 'system',
            scopeId: 'system',
            group: 'credit',
            description: 'اعتبار هدیه پیوستن به بازار',
        },
        {
            key: 'credit.bumpCost',
            value: 10,
            scope: 'system',
            scopeId: 'system',
            group: 'credit',
            description: 'هزینه نردبان',
        },
        {
            key: 'credit.maxTotalFreeAdPerUser',
            value: 5,
            scope: 'system',
            scopeId: 'system',
            group: 'credit',
            description: 'حداکثر تعداد آگهی های رایگان',
        },
        {
            key: 'credit.dailyCallLimit',
            value: 20,
            scope: 'system',
            scopeId: 'system',
            group: 'credit',
            description: 'محدودیت تماس روزانه',
        },

        // ============================================================
        // تنظیمات عمومی (General)
        // ============================================================
        {
            key: 'general.appName',
            value: 'دِیمَت',
            scope: 'system',
            scopeId: 'system',
            group: 'general',
            description: 'نام برنامه',
        },
        {
            key: 'general.defaultLocale',
            value: 'fa',
            scope: 'system',
            scopeId: 'system',
            group: 'general',
            description: 'زبان پیش‌فرض',
        },
        {
            key: 'general.supportPhone',
            value: '09123456789',
            scope: 'system',
            scopeId: 'system',
            group: 'general',
            description: 'شماره پشتیبانی',
        },
        {
            key: 'general.supportEmail',
            value: 'support@daymat.com',
            scope: 'system',
            scopeId: 'system',
            group: 'general',
            description: 'ایمیل پشتیبانی',
        },

        // ============================================================
        // تنظیمات امنیتی (Security)
        // ============================================================
        {
            key: 'security.maxLoginAttempts',
            value: 5,
            scope: 'system',
            scopeId: 'system',
            group: 'security',
            description: 'حداکثر تلاش برای ورود',
        },
        {
            key: 'security.sessionTimeout',
            value: 3600,
            scope: 'system',
            scopeId: 'system',
            group: 'security',
            description: 'مدت زمان نشست (ثانیه)',
        },
        {
            key: 'security.requireEmailVerification',
            value: false,
            scope: 'system',
            scopeId: 'system',
            group: 'security',
            description: 'نیاز به تأیید ایمیل برای ثبت‌نام',
        },

        // ============================================================
        // تنظیمات ظاهری (Appearance)
        // ============================================================
        {
            key: 'appearance.defaultTheme',
            value: 'light',
            scope: 'system',
            scopeId: 'system',
            group: 'appearance',
            description: 'تم پیش‌فرض',
        },
        {
            key: 'appearance.defaultFont',
            value: 'Vazirmatn',
            scope: 'system',
            scopeId: 'system',
            group: 'appearance',
            description: 'فونت پیش‌فرض',
        },
        {
            key: 'appearance.primaryColor',
            value: '#610000',
            scope: 'system',
            scopeId: 'system',
            group: 'appearance',
            description: 'رنگ اصلی',
        },
    ];

    // ✅ ذخیره کردن تنظیمات در دیتابیس
    for (const item of defaults) {
        await prisma.setting.upsert({
            where: {
                key_scope_scopeId: {
                    key: item.key,
                    scope: item.scope,
                    scopeId: item.scopeId,
                },
            },
            update: {
                value: item.value,
                group: item.group,
                description: item.description,
                updatedAt: new Date(),
            },
            create: {
                key: item.key,
                value: item.value,
                scope: item.scope,
                scopeId: item.scopeId,
                group: item.group,
                description: item.description,
            },
        });
    }

    console.log('✅ System settings seeded successfully!');
}

// ============================================================
// اجرای مستقیم
// ============================================================
if (require.main === module) {
    seedSettings()
        .catch((e) => {
            console.error('❌ Error seeding settings:', e);
            process.exit(1);
        })
        .finally(async () => {
            await prisma.$disconnect();
        });
}