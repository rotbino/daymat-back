// prisma/scripts/migrate-007-industry-confirmed-backfill.ts
// ✅ Backfill فیلد confirmed روی رکوردهای Industry موجود
//
// استراتژی:
//   - رکوردهایی که confirmed ندارن → confirmed: true (چون قبلاً وجود داشتن، فرض می‌کنیم admin-approved هستن)
//   - رکوردهایی که از طریق seed ساخته شدن → confirmed: true
//   - از این به بعد، رکوردهای جدیدی که کاربر می‌سازه → confirmed: false (تا ادمین بررسی کنه)
//
// نکته: این اسکریپت از MongoDB driver مستقیم استفاده می‌کنه (نیازی به Prisma Client نیست).
// نکته: نام collection در MongoDB برابر با نام model در schema هست: «Industry» (با I بزرگ).

import { MongoClient } from 'mongodb';

const url = process.env.DATABASE_URL!;
const client = new MongoClient(url);

async function main() {
    await client.connect();
    const db = client.db();
    // ✅ نام collection همون نام model در Prisma schema هست (Industry با I بزرگ)
    const col = db.collection('Industry');

    // ۱. رکوردهایی که فیلد confirmed ندارن → true (pre-approved)
    const result1 = await col.updateMany(
        { confirmed: { $exists: false } },
        { $set: { confirmed: true } },
    );
    console.log(`✅ Set confirmed=true on ${result1.modifiedCount} industries (were missing the field)`);

    // ۲. آمار کلی
    const total = await col.countDocuments();
    const confirmed = await col.countDocuments({ confirmed: true });
    const unconfirmed = await col.countDocuments({ confirmed: false });
    console.log(`\n📊 Industry stats:`);
    console.log(`   Total:       ${total}`);
    console.log(`   Confirmed:   ${confirmed}`);
    console.log(`   Unconfirmed: ${unconfirmed}`);

    await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
