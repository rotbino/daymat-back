// prisma/scripts/migrate-002-membership-business.ts
// ========================================================================
// PATCH 002: Migration to (armId, businessId) unique constraint
// ========================================================================
// تاریخ: 2026-09-06
// هدف: نرمال‌سازی memberships فعلی برای schema جدید
//
// تغییرات schema:
//   - businessId از optional به required تبدیل شد
//   - @@unique([armId, userId]) به @@unique([armId, businessId]) تغییر کرد
//   - @@unique([armId, catalogId]) اضافه شد
//
// این اسکریپت:
//   1) memberships که businessId=null دارند را به اولین کسب‌وکار user وصل می‌کند
//   2) memberships duplicate (همون armId+businessId) را merge می‌کند
//   3) memberships duplicate (همون armId+catalogId) را merge می‌کند
//
// اجرا: npx tsx prisma/scripts/migrate-002-membership-business.ts
// ========================================================================

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🔄 Migration 002: Membership → (armId, businessId) unique\n');
    console.log('─'.repeat(60));

    // ═══ ۱) پیدا کردن memberships با businessId=null ═══
    const nullBizMemberships = await prisma.armMembership.findMany({
        where: { businessId: null },
        include: {
            user: { select: { phone: true, fullName: true } },
            arm: { select: { name: true, slug: true } },
        },
    });

    console.log(`📊 Memberships با businessId=null: ${nullBizMemberships.length}\n`);

    let fixed = 0;
    let skipped = 0;

    for (const m of nullBizMemberships) {
        // اولین کسب‌وکار فعال کاربر رو پیدا کن
        const firstBiz = await prisma.business.findFirst({
            where: { ownerUserId: m.userId, status: 'active' },
            select: { id: true, name: true },
        });

        if (!firstBiz) {
            console.log(`   ⚠️  ${m.user?.phone} (${m.arm?.name}): هیچ کسب‌وکاری ندارد — skipped`);
            skipped++;
            continue;
        }

        // اگه این کسب‌وکار در این بازار قبلاً membership دارد، این duplicate است
        const existing = await prisma.armMembership.findFirst({
            where: {
                armId: m.armId,
                businessId: firstBiz.id,
                id: { not: m.id },
            },
        });

        if (existing) {
            // merge: اگه duplicate هست، یکی رو حذف کن (جدیدتر رو نگه دار)
            const toKeep = m.joinedAt > existing.joinedAt ? m : existing;
            const toDelete = m.joinedAt > existing.joinedAt ? existing : m;

            await prisma.armMembership.delete({ where: { id: toDelete.id } });
            await prisma.armMembership.update({
                where: { id: toKeep.id },
                data: { businessId: firstBiz.id },
            });
            console.log(`   🔀 ${m.user?.phone} (${m.arm?.name}): merged duplicate → ${firstBiz.name}`);
            fixed++;
        } else {
            await prisma.armMembership.update({
                where: { id: m.id },
                data: { businessId: firstBiz.id },
            });
            console.log(`   ✅ ${m.user?.phone} (${m.arm?.name}): → ${firstBiz.name}`);
            fixed++;
        }
    }

    // ═══ ۲) پیدا کردن duplicates بر اساس (armId, businessId) ═══
    console.log('\n─'.repeat(60));
    console.log('🔍 چک duplicates (armId, businessId)...\n');

    const allMemberships = await prisma.armMembership.findMany({
        select: { id: true, armId: true, businessId: true, userId: true, catalogId: true, joinedAt: true },
    });

    const byArmBiz = new Map<string, typeof allMemberships>();
    for (const m of allMemberships) {
        if (!m.businessId) continue;
        const key = `${m.armId}_${m.businessId}`;
        const arr = byArmBiz.get(key) ?? [];
        arr.push(m);
        byArmBiz.set(key, arr);
    }

    let duplicatesMerged = 0;
    for (const [key, group] of byArmBiz) {
        if (group.length <= 1) continue;

        // جدیدترین رو نگه دار، بقیه رو حذف کن
        const sorted = group.sort((a, b) => b.joinedAt.getTime() - a.joinedAt.getTime());
        const toKeep = sorted[0];
        const toDelete = sorted.slice(1);

        for (const d of toDelete) {
            await prisma.armMembership.delete({ where: { id: d.id } });
            duplicatesMerged++;
        }
        console.log(`   🔀 ${key}: ${group.length} → 1 (kept ${toKeep.id})`);
    }

    // ═══ ۳) پیدا کردن duplicates بر اساس (armId, catalogId) ═══
    console.log('\n─'.repeat(60));
    console.log('🔍 چک duplicates (armId, catalogId)...\n');

    const withCatalog = allMemberships.filter(m => m.catalogId);
    const byArmCatalog = new Map<string, typeof allMemberships>();
    for (const m of withCatalog) {
        const key = `${m.armId}_${m.catalogId}`;
        const arr = byArmCatalog.get(key) ?? [];
        arr.push(m);
        byArmCatalog.set(key, arr);
    }

    let catalogDuplicatesMerged = 0;
    for (const [key, group] of byArmCatalog) {
        if (group.length <= 1) continue;

        const sorted = group.sort((a, b) => b.joinedAt.getTime() - a.joinedAt.getTime());
        const toKeep = sorted[0];
        const toDelete = sorted.slice(1);

        for (const d of toDelete) {
            await prisma.armMembership.delete({ where: { id: d.id } });
            catalogDuplicatesMerged++;
        }
        console.log(`   🔀 ${key}: ${group.length} → 1 (kept ${toKeep.id})`);
    }

    // ═══ گزارش نهایی ═══
    console.log('\n─'.repeat(60));
    console.log('✅ Migration complete:');
    console.log(`   - businessId filled:     ${fixed}`);
    console.log(`   - skipped (no business): ${skipped}`);
    console.log(`   - duplicates merged:     ${duplicatesMerged}`);
    console.log(`   - catalog duplicates:    ${catalogDuplicatesMerged}`);
    console.log('');

    const total = await prisma.armMembership.count();
    const withBiz = await prisma.armMembership.count({ where: { businessId: { not: null } } });
    console.log(`📊 total memberships: ${total}`);
    console.log(`📊 with businessId:  ${withBiz}`);

    if (total === withBiz) {
        console.log('✅ همه memberships businessId دارند.');
    } else {
        console.log('⚠️  برخی memberships هنوز businessId ندارند!');
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
