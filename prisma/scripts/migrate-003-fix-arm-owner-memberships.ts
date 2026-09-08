// prisma/scripts/migrate-003-fix-arm-owner-memberships.ts
// ========================================================================
// PATCH 003: پاکسازی memberships خراب شده
// ========================================================================
// تاریخ: 2026-09-06
// هدف: رفع memberships که به‌اشتباه با businessId/catalogId پر شده‌اند
//
// مشکل:
//   کد قبلی addSeller/addBuyer بر اساس (armId, userId) جستجو می‌کرد
//   و arm_owner membership رو پیدا می‌کرد و به seller/buyer تبدیل می‌کرد.
//   این یعنی arm_owner membership به‌اشتباه businessId و catalogId می‌گرفت.
//
// راه‌حل:
//   ۱) همه arm_owner memberships را به حالت اولیه برمی‌گردانیم
//      (businessId=null, catalogId=null, roleType=null, publishState=null)
//   ۲) memberships غیر-arm_owner که catalogId دارند ولی businessId ندارند را
//      businessId شان را از catalog پر می‌کنیم
//   ۳) memberships duplicate (همون armId+businessId) را حذف می‌کنیم
//   ۴) memberships duplicate (همون armId+catalogId) را حذف می‌کنیم
//
// اجرا: npx tsx prisma/scripts/migrate-003-fix-arm-owner-memberships.ts
// ========================================================================

import { MongoClient } from 'mongodb';

const url = process.env.DATABASE_URL!;
const client = new MongoClient(url);

async function main() {
    await client.connect();
    const db = client.db();
    const col = db.collection('ArmMembership');

    console.log('🔄 Migration 003: Fix arm_owner memberships\n');
    console.log('─'.repeat(60));

    // ═══ ۱) بازنشانی arm_owner memberships ═══
    const armOwners = await col.find({ role: 'arm_owner' }).toArray();
    console.log(`📊 arm_owner memberships: ${armOwners.length}\n`);

    let resetCount = 0;
    for (const m of armOwners) {
        const needsReset = m.businessId || m.catalogId || m.roleType || m.publishState;
        if (!needsReset) {
            console.log(`   ⏭️  ${m._id}: already clean`);
            continue;
        }

        console.log(`   🔧 ${m._id}: clearing businessId=${m.businessId}, catalogId=${m.catalogId}, roleType=${m.roleType}, publishState=${m.publishState}`);
        await col.updateOne(
            { _id: m._id },
            {
                $unset: {
                    businessId: '',
                    catalogId: '',
                    roleType: '',
                    publishState: '',
                },
            },
        );
        resetCount++;
    }
    console.log(`\n✅ Reset ${resetCount} arm_owner memberships\n`);

    // ═══ ۲) پر کردن businessId برای memberships که catalogId دارند ولی businessId ندارند ═══
    console.log('─'.repeat(60));
    const withCatalogNoBiz = await col.find({
        catalogId: { $exists: true, $ne: null },
        $or: [{ businessId: null }, { businessId: { $exists: false } }],
    }).toArray();
    console.log(`\n📊 Memberships با catalog ولی بدون business: ${withCatalogNoBiz.length}\n`);

    let bizFilled = 0;
    for (const m of withCatalogNoBiz) {
        // business رو از catalog بگیر
        const catalog = await db.collection('Catalog').findOne({ _id: m.catalogId });
        if (!catalog) {
            console.log(`   ❌ ${m._id}: catalog not found — deleting membership`);
            await col.deleteOne({ _id: m._id });
            continue;
        }
        await col.updateOne(
            { _id: m._id },
            { $set: { businessId: catalog.businessId } },
        );
        console.log(`   ✅ ${m._id}: businessId filled from catalog`);
        bizFilled++;
    }

    // ═══ ۳) حذف duplicates بر اساس (armId, businessId) ═══
    console.log('\n─'.repeat(60));
    const all = await col.find({}).toArray();
    const byArmBiz = new Map<string, any[]>();
    for (const m of all) {
        if (!m.businessId) continue;
        const key = `${m.armId}_${m.businessId}`;
        const arr = byArmBiz.get(key) ?? [];
        arr.push(m);
        byArmBiz.set(key, arr);
    }

    let duplicatesMerged = 0;
    for (const [key, group] of byArmBiz) {
        if (group.length <= 1) continue;
        // جدیدترین رو نگه دار
        const sorted = group.sort((a, b) =>
            (b.joinedAt?.getTime() || 0) - (a.joinedAt?.getTime() || 0)
        );
        const toKeep = sorted[0];
        const toDelete = sorted.slice(1);
        for (const d of toDelete) {
            await col.deleteOne({ _id: d._id });
            duplicatesMerged++;
        }
        console.log(`   🔀 ${key}: ${group.length} → 1 (kept ${toKeep._id})`);
    }

    // ═══ ۴) حذف duplicates بر اساس (armId, catalogId) ═══
    console.log('\n─'.repeat(60));
    const withCatalog = all.filter(m => m.catalogId);
    const byArmCatalog = new Map<string, any[]>();
    for (const m of withCatalog) {
        const key = `${m.armId}_${m.catalogId}`;
        const arr = byArmCatalog.get(key) ?? [];
        arr.push(m);
        byArmCatalog.set(key, arr);
    }

    let catalogDuplicatesMerged = 0;
    for (const [key, group] of byArmCatalog) {
        if (group.length <= 1) continue;
        const sorted = group.sort((a, b) =>
            (b.joinedAt?.getTime() || 0) - (a.joinedAt?.getTime() || 0)
        );
        const toKeep = sorted[0];
        const toDelete = sorted.slice(1);
        for (const d of toDelete) {
            await col.deleteOne({ _id: d._id });
            catalogDuplicatesMerged++;
        }
        console.log(`   🔀 ${key}: ${group.length} → 1 (kept ${toKeep._id})`);
    }

    // ═══ گزارش نهایی ═══
    console.log('\n─'.repeat(60));
    console.log('✅ Migration complete:');
    console.log(`   - arm_owner reset:        ${resetCount}`);
    console.log(`   - businessId filled:      ${bizFilled}`);
    console.log(`   - duplicates merged:      ${duplicatesMerged}`);
    console.log(`   - catalog duplicates:     ${catalogDuplicatesMerged}\n`);

    // نمایش نهایی
    const final = await col.find({}).toArray();
    console.log('═══ Final memberships ═══');
    for (const m of final) {
        const arm = await db.collection('Arm').findOne({ _id: m.armId });
        const user = await db.collection('User').findOne({ _id: m.userId });
        const biz = m.businessId ? await db.collection('Business').findOne({ _id: m.businessId }) : null;
        const cat = m.catalogId ? await db.collection('Catalog').findOne({ _id: m.catalogId }) : null;
        console.log({
            arm: arm?.name,
            user: user?.phone,
            business: biz?.name,
            catalog: cat?.name,
            role: m.role,
            roleType: m.roleType,
            status: m.status,
            publishState: m.publishState,
        });
    }

    await client.close();
}

main()
    .catch((e) => {
        console.error('❌ خطا:', e);
        process.exit(1);
    });
