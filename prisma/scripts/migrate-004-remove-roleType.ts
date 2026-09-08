// prisma/scripts/migrate-004-remove-roleType.ts
// ========================================================================
// PATCH 004: حذف فیلد roleType از ArmMembership
// ========================================================================
// تاریخ: 2026-09-06
// هدف: حذف نقش seller/buyer از membership (این نقش از بقایای سیستم قبلی بود)
//
// در سیستم جدید:
//   - role فقط systemic است: arm_owner / arm_member
//   - seller = membership با catalogId != null
//   - buyer = membership با businessId != null و catalogId == null
//   - arm_owner می‌تواند همزمان seller/buyer هم باشد (با membership جداگانه)
//
// این اسکریپت:
//   1) فیلد roleType را از همه memberships حذف می‌کند
//   2) memberships که catalogId دارند ولی publishState ندارند را fix می‌کند
//
// اجرا: npx tsx prisma/scripts/migrate-004-remove-roleType.ts
// ========================================================================

import { MongoClient } from 'mongodb';

const url = process.env.DATABASE_URL!;
const client = new MongoClient(url);

async function main() {
    await client.connect();
    const db = client.db();
    const col = db.collection('ArmMembership');

    console.log('🔄 Migration 004: Remove roleType field\n');
    console.log('─'.repeat(60));

    // ۱) حذف فیلد roleType از همه memberships
    const result = await col.updateMany(
        { roleType: { $exists: true } },
        { $unset: { roleType: '' } },
    );
    console.log(`✅ Removed roleType from ${result.modifiedCount} memberships\n`);

    // ۲) fix publishState برای seller memberships (catalogId != null)
    const sellerFix = await col.updateMany(
        { catalogId: { $ne: null }, publishState: null },
        { $set: { publishState: 'published' } },
    );
    console.log(`✅ Fixed publishState for ${sellerFix.modifiedCount} seller memberships`);

    // ۳) اطمینان از اینکه buyer memberships publishState ندارن
    const buyerFix = await col.updateMany(
        { catalogId: null, businessId: { $ne: null }, publishState: { $ne: null } },
        { $unset: { publishState: '' } },
    );
    console.log(`✅ Cleared publishState for ${buyerFix.modifiedCount} buyer memberships\n`);

    // گزارش نهایی
    const all = await col.find({}).toArray();
    console.log('═══ Final memberships ═══');
    for (const m of all) {
        const arm = await db.collection('Arm').findOne({ _id: m.armId });
        const user = await db.collection('User').findOne({ _id: m.userId });
        const biz = m.businessId ? await db.collection('Business').findOne({ _id: m.businessId }) : null;
        const cat = m.catalogId ? await db.collection('Catalog').findOne({ _id: m.catalogId }) : null;

        const membershipType = m.role === 'arm_owner'
            ? '🏢 arm_owner'
            : m.catalogId
                ? '🏪 seller'
                : m.businessId
                    ? '🛒 buyer'
                    : '👤 member';

        console.log({
            type: membershipType,
            arm: arm?.name,
            user: user?.phone,
            business: biz?.name ?? '-',
            catalog: cat?.name ?? '-',
            role: m.role,
            status: m.status,
            publishState: m.publishState ?? '-',
        });
    }

    await client.close();
}

main()
    .catch((e) => {
        console.error('❌ خطا:', e);
        process.exit(1);
    });
