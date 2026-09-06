// prisma/scripts/migrate-001-ad-publication.ts
// Migration: Ad.armId → AdPublication
// Idempotent — safe to run multiple times
// Usage: npx tsx prisma/scripts/migrate-001-ad-publication.ts

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🔄 Migration 001: Ad.armId → AdPublication\n');
    console.log('─'.repeat(60));

    const ads = await prisma.ad.findMany({
        where: { armId: { not: null } },
        select: {
            id: true,
            armId: true,
            catalogId: true,
            categoryId: true,
            categoryPath: true,
            status: true,
            createdAt: true,
            updatedAt: true,
        },
    });

    console.log(`📊 آگهی‌های با armId: ${ads.length}`);

    if (ads.length === 0) {
        console.log('✅ چیزی برای migration نیست — خروج.');
        return;
    }

    const existingPublications = await prisma.adPublication.findMany({
        where: { adId: { in: ads.map(a => a.id) } },
        select: { adId: true, armId: true },
    });
    const existingKeys = new Set(
        existingPublications.map(p => `${p.adId}_${p.armId}`)
    );
    console.log(`📊 Publication های موجود: ${existingPublications.length}\n`);

    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const ad of ads) {
        const key = `${ad.id}_${ad.armId}`;
        if (existingKeys.has(key)) {
            skipped++;
            continue;
        }

        try {
            const status =
                ad.status === 'active' ? 'published' :
                ad.status === 'expired' ? 'paused' :
                ad.status === 'inactive' ? 'paused' :
                'paused';

            const finalStatus =
                status === 'published' && !ad.categoryId ? 'needs_category' : status;

            await prisma.adPublication.create({
                data: {
                    adId: ad.id,
                    armId: ad.armId!,
                    catalogId: ad.catalogId,
                    categoryId: ad.categoryId,
                    categoryPath: ad.categoryPath,
                    status: finalStatus,
                    publishedAt: ad.createdAt,
                    updatedAt: ad.updatedAt,
                },
            });
            created++;
        } catch (err: any) {
            console.error(`   ❌ ${ad.id}: ${err.message}`);
            errors++;
        }
    }

    console.log('─'.repeat(60));
    console.log('✅ Migration complete:');
    console.log(`   - ایجاد شده:    ${created}`);
    console.log(`   - رد شده (موجود): ${skipped}`);
    console.log(`   - خطا:          ${errors}\n`);

    const totalPublications = await prisma.adPublication.count();
    const totalAdsWithArm = await prisma.ad.count({ where: { armId: { not: null } } });
    console.log(`📊 total AdPublication: ${totalPublications}`);
    console.log(`📊 total Ad with armId: ${totalAdsWithArm}`);

    if (totalPublications === totalAdsWithArm) {
        console.log('✅ تطابق کامل: هر آگهی با armId یک publication دارد.');
    } else {
        console.log('⚠️  عدم تطابق! بررسی کنید.');
    }
}

main()
    .catch((e) => {
        console.error('❌ خطا در migration:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
