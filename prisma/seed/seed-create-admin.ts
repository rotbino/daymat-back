// prisma/seed/seed-admin.ts
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
    console.log('👤 ایجاد کاربر ادمین...\n');

    const adminPassHash = await bcrypt.hash('admin123456', 10);

    // ═══════════════ بررسی وجود کاربر قبلی ═══════════════
    const existingAdmin = await prisma.user.findUnique({
        where: { phone: '09120000000' },
    });

    if (existingAdmin) {
        console.log('⚠️ کاربر ادمین از قبل وجود دارد');
        console.log(`   📱 شماره: ${existingAdmin.phone}`);
        console.log(`   🎭 نقش: ${existingAdmin.role}`);
        console.log(`   📝 نام: ${existingAdmin.fullName}`);
        console.log('\n✅ نیاز به ایجاد مجدد نیست. خروج...\n');
        return;
    }

    // ═══════════════ ایجاد کاربر ادمین ═══════════════
    const admin = await prisma.user.create({
        data: {
            phone: '09120000000',
            fullName: 'مدیر سیستم',
            passwordHash: adminPassHash,
            role: 'system_admin',
            status: 'active',
            isPhoneVerified: true,
            temporaryPassword: false,
        },
    });

    console.log('✅ کاربر ادمین با موفقیت ایجاد شد');
    console.log('='.repeat(40));
    console.log(`📱 شماره موبایل: 09120000000`);
    console.log(`🔑 رمز عبور:     admin123456`);
    console.log(`🎭 نقش:          system_admin`);
    console.log(`📝 نام:          مدیر سیستم`);
    console.log('='.repeat(40));
    console.log('\n💡 می‌توانید با این مشخصات وارد پنل ادمین شوید.\n');
}

main()
    .catch((e) => {
        console.error('❌ خطا در ایجاد ادمین:', e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());