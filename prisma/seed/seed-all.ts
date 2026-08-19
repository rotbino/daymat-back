// prisma/seed/seed-all.ts
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// ═══════════════════════════════════════════
// تنظیمات
// ═══════════════════════════════════════════
const MARKER_FILE = path.join(process.cwd(), '.seeded');
const FORCE_RESET = process.argv.includes('--force-reset');

// ترتیب سیدها (مهم!)
const SEED_SCRIPTS = [
    { name: 'موقعیت‌ها', path: 'prisma/seed/seed-locations.ts' },
    { name: 'دسته‌بندی‌ها', path: 'prisma/seed/seed-categories.ts' },
    { name: 'صنوف', path: 'prisma/seed/seed-industries.ts' },
    { name: 'فعالیت‌ها', path: 'prisma/seed/seed-activities.ts' },
    { name: 'تنظیمات سیستم', path: 'prisma/seed/settings.seed.ts' },
    { name: 'بازوی نمونه', path: 'prisma/seed/seed-arm-masaleh.ts' },
];

// ═══════════════════════════════════════════
// توابع کمکی
// ═══════════════════════════════════════════

function logSection(title: string) {
    console.log('\n' + '='.repeat(60));
    console.log(`  ${title}`);
    console.log('='.repeat(60) + '\n');
}

function isAlreadySeeded(): boolean {
    if (FORCE_RESET) {
        console.log('⚠️  حالت FORCE RESET فعال است — سیدها اجرا می‌شوند');
        return false;
    }

    // چک ۱: فایل نشانگر
    if (fs.existsSync(MARKER_FILE)) {
        console.log('⏭️  فایل .seeded وجود دارد — سیدها قبلاً اجرا شده‌اند');
        return true;
    }

    return false;
}

function runSeedScript(scriptPath: string): void {
    execSync(`npx tsx ${scriptPath}`, {
        stdio: 'inherit',
        env: { ...process.env },
    });
}

function createMarker() {
    fs.writeFileSync(
        MARKER_FILE,
        JSON.stringify(
            {
                seededAt: new Date().toISOString(),
                env: process.env.NODE_ENV || 'development',
            },
            null,
            2,
        ),
    );
    console.log('\n📝 فایل نشانگر .seeded ساخته شد');
}

async function cleanDatabase() {
    console.log('🗑️  پاکسازی دیتابیس (فقط در حالت Force Reset)...\n');

    const deletionOrder = [
        'creditRequest',
        'credit',
        'callEvent',
        'adInteraction',
        'adView',
        'ad',
        'buyLead',
        'file',
        'verification',
        'trustMetric',
        'categoryUnitMapping',
        'customCategory',
        'armMembership',
        'businessActivity',
        'feedback',
        'verificationCode',
        'teamMember',
        'business',
        'arm',
        'activity',
        'industry',
        'productCategory',
        'unit',
        'location',
        'setting',
        'user',
    ];

    for (const table of deletionOrder) {
        try {
            const result = await (prisma as any)[table].deleteMany();
            console.log(`   ✅ ${table}: ${result.count} رکورد حذف شد`);
        } catch (e: any) {
            console.log(`   ⚠️  ${table}: ${e.message?.slice(0, 80)}`);
        }
    }
    console.log('');
}

async function printStats() {
    const stats = {
        users: await prisma.user.count(),
        businesses: await prisma.business.count(),
        arms: await prisma.arm.count(),
        categories: await prisma.productCategory.count(),
        locations: await prisma.location.count(),
        units: await prisma.unit.count(),
        activities: await prisma.activity.count(),
        industries: await prisma.industry.count(),
        settings: await prisma.setting.count(),
    };

    console.log('\n📊 آمار نهایی دیتابیس:');
    console.log('─'.repeat(40));
    console.log(`   👤 کاربران: ${stats.users}`);
    console.log(`   🏢 کسب‌وکارها: ${stats.businesses}`);
    console.log(`   🏗️  بازارها: ${stats.arms}`);
    console.log(`   📦 دسته‌بندی‌ها: ${stats.categories}`);
    console.log(`   📍 موقعیت‌ها: ${stats.locations}`);
    console.log(`   📏 واحدها: ${stats.units}`);
    console.log(`   ⚡ فعالیت‌ها: ${stats.activities}`);
    console.log(`   🏭 صنوف: ${stats.industries}`);
    console.log(`   ⚙️  تنظیمات: ${stats.settings}`);
    console.log('─'.repeat(40));
}

// ═══════════════════════════════════════════
// تابع اصلی
// ═══════════════════════════════════════════

async function main() {
    logSection('🚀 Daymat — فرآیند استقرار و سید');

    // ۱. بررسی وضعیت
    if (isAlreadySeeded()) {
        console.log('✅ دیتابیس از قبل سید شده است.');
        console.log('   برای اجرای مجدد: npx tsx prisma/seed/seed-all.ts --force-reset\n');
        return;
    }

    // ۲. اعمال اسکیما
    logSection('📦 Step 1: اعمال اسکیما');
    execSync('npx prisma db push --skip-generate', { stdio: 'inherit' });
    console.log('✅ اسکیما اعمال شد\n');

    // ۳. پاکسازی (فقط Force Reset)
    if (FORCE_RESET) {
        logSection('🗑️  Step 2: پاکسازی دیتابیس');
        await cleanDatabase();
    }

    // ۴. اجرای سیدها
    logSection('🌱 Step 3: اجرای سیدها');

    for (let i = 0; i < SEED_SCRIPTS.length; i++) {
        const seed = SEED_SCRIPTS[i];
        console.log(`\n📜 [${i + 1}/${SEED_SCRIPTS.length}] ${seed.name}...\n`);

        try {
            runSeedScript(seed.path);
            console.log(`\n✅ ${seed.name} — موفق\n`);
        } catch (e: any) {
            console.error(`\n❌ خطا در ${seed.name}:`);
            console.error(e.message || e);
            console.error('\n⚠️  فرآیند متوقف شد.');
            process.exit(1);
        }
    }

    // ۵. ساخت نشانگر
    createMarker();

    // ۶. گزارش نهایی
    await printStats();

    logSection('🎉 فرآیند با موفقیت کامل شد!');
}

// ═══════════════════════════════════════════
// اجرا
// ═══════════════════════════════════════════

main()
    .catch((e) => {
        console.error('\n❌ خطای غیرمنتظره:');
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });