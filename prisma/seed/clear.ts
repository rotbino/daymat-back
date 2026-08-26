import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function clearDatabase() {
    console.log('🧹 پاکسازی دیتابیس...');

    await prisma.$transaction([
        prisma.adView.deleteMany({}),
        prisma.callEvent.deleteMany({}),
        prisma.ad.deleteMany({}),
        prisma.buyLead.deleteMany({}),
        prisma.armMembership.deleteMany({}),
        // ✅ مدل‌های حذف‌شده را حذف کنید
        // prisma.armCategorySelection.deleteMany({}), // حذف شد
        // prisma.armLocationSelection.deleteMany({}), // حذف شد
        // prisma.armConfig.deleteMany({}), // حذف شد
        prisma.credit.deleteMany({}),
        prisma.trustMetric.deleteMany({}),
        prisma.arm.deleteMany({}),
        prisma.business.deleteMany({}),
        prisma.user.deleteMany({}),
    ]);

    console.log('✅ دیتابیس پاکسازی شد');
}

clearDatabase()
    .catch(console.error)
    .finally(() => prisma.$disconnect());