// prisma/scripts/migrate-010-product-isnew-backfill.ts
// ✅ Backfill فیلد isNew روی رکوردهای ProductReference موجود
// همه‌ی رکوردهای موجود → isNew=false (چون قبلاً وجود داشتن، فرض می‌کنیم رسمی هستن)

import { MongoClient } from 'mongodb';

const url = process.env.DATABASE_URL!;
const client = new MongoClient(url);

async function main() {
    await client.connect();
    const db = client.db();
    const col = db.collection('ProductReference');

    const result = await col.updateMany(
        { isNew: { $exists: false } },
        { $set: { isNew: false } },
    );
    console.log(`✅ ProductReference: ${result.modifiedCount} updated with isNew=false`);

    const total = await col.countDocuments();
    console.log(`📊 Total: ${total}`);
    await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
