// prisma/scripts/migrate-005-business-status.ts
// ========================================================================
// PATCH 005: جدا کردن status سیستمی از businessStatus تجاری
// ========================================================================
// مشکل:
//   فیلد status هم برای دسترسی سیستمی (arm_owner/admin) و هم برای وضعیت تجاری
//   (paused) استفاده می‌شد. وقتی arm_owner رو pause می‌کردیم، دسترسی‌اش به پنل
//   از بین می‌رفت.
//
// راه‌حل:
//   - status: فقط active | banned | removed (سیستمی)
//   - businessStatus: active | paused (تجاری)
//
// این اسکریپت:
//   ۱) اگه status=paused باشه → businessStatus=paused، status=active
//   ۲) اگه status=banned/rejected باشه → status=banned، businessStatus=paused
//   ۳) بقیه → businessStatus=active
// ========================================================================

import { MongoClient } from 'mongodb';

const url = process.env.DATABASE_URL!;
const client = new MongoClient(url);

async function main() {
    await client.connect();
    const db = client.db();
    const col = db.collection('ArmMembership');

    console.log('🔄 Migration 005: Separate status from businessStatus\n');

    // ۱) memberships که status=paused هستن → businessStatus=paused, status=active
    const r1 = await col.updateMany(
        { status: 'paused' },
        { $set: { status: 'active', businessStatus: 'paused' } },
    );
    console.log(`✅ Fixed paused → active+businessStatus=paused: ${r1.modifiedCount}`);

    // ۲) memberships که status=banned/rejected هستن → status=banned, businessStatus=paused
    const r2 = await col.updateMany(
        { status: { $in: ['banned', 'rejected'] } },
        { $set: { businessStatus: 'paused' } },
    );
    console.log(`✅ Fixed banned/rejected → businessStatus=paused: ${r2.modifiedCount}`);

    // ۳) بقیه → businessStatus=active (اگه ست نشده)
    const r3 = await col.updateMany(
        { businessStatus: { $exists: false } },
        { $set: { businessStatus: 'active' } },
    );
    console.log(`✅ Set businessStatus=active for others: ${r3.modifiedCount}`);

    // گزارش نهایی
    const all = await col.find({}).toArray();
    console.log('\n═══ Final memberships ═══');
    for (const m of all) {
        const arm = await db.collection('Arm').findOne({ _id: m.armId });
        const user = await db.collection('User').findOne({ _id: m.userId });
        console.log({
            arm: arm?.name,
            user: user?.phone,
            role: m.role,
            roleType: m.roleType ?? 'null',
            status: m.status,                    // سیستمی
            businessStatus: m.businessStatus,    // تجاری
            businessId: m.businessId?.toString() ?? 'null',
            catalogId: m.catalogId?.toString() ?? 'null',
        });
    }

    await client.close();
}

main()
    .catch((e) => {
        console.error('❌ خطا:', e);
        process.exit(1);
    });
