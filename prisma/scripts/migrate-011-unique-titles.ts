// prisma/scripts/migrate-011-unique-titles.ts
// ✅ اضافه کردن unique constraint روی Brand.title و ProductReference.title
// قبل از اعمال constraint، رکوردهای تکراری رو پاک یا merge می‌کنیم

import { MongoClient } from 'mongodb';

const url = process.env.DATABASE_URL!;
const client = new MongoClient(url);

async function main() {
    await client.connect();
    const db = client.db();

    // ۱. Brand — پیدا کردن تکراری‌ها
    const brandDuplicates = await db.collection('Brand').aggregate([
        { $group: { _id: '$title', count: { $sum: 1 }, ids: { $push: '$_id' } } },
        { $match: { count: { $gt: 1 } } },
    ]).toArray();

    console.log(`Brand duplicates: ${brandDuplicates.length}`);
    for (const dup of brandDuplicates) {
        // اولین رو نگه دار، بقیه رو deactivate کن
        const [keepId, ...removeIds] = dup.ids;
        await db.collection('Brand').updateMany(
            { _id: { $in: removeIds } },
            { $set: { isActive: false, title: `${dup._id} (duplicate-${removeIds.length})` } },
        );
        console.log(`  Kept ${keepId}, deactivated ${removeIds.length} duplicates for "${dup._id}"`);
    }

    // ۲. ProductReference — پیدا کردن تکراری‌ها
    const productDuplicates = await db.collection('ProductReference').aggregate([
        { $group: { _id: '$title', count: { $sum: 1 }, ids: { $push: '$_id' } } },
        { $match: { count: { $gt: 1 } } },
    ]).toArray();

    console.log(`ProductReference duplicates: ${productDuplicates.length}`);
    for (const dup of productDuplicates) {
        const [keepId, ...removeIds] = dup.ids;
        await db.collection('ProductReference').updateMany(
            { _id: { $in: removeIds } },
            { $set: { isActive: false, title: `${dup._id} (duplicate-${removeIds.length})` } },
        );
        console.log(`  Kept ${keepId}, deactivated ${removeIds.length} duplicates for "${dup._id}"`);
    }

    console.log('✅ Done — duplicates resolved. Now run `npx prisma db push` to apply unique constraints.');
    await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
