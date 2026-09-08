// prisma/scripts/migrate-009-isbyuser-backfill.ts
// ✅ Backfill فیلد isByUser روی رکوردهای موجود Industry, Brand, ProductReference, Location
//
// استراتژی:
//   - رکوردهایی که isByUser ندارن → false (چون قبلاً وجود داشتن، فرض می‌کنیم seed/admin هستن)
//   - رکوردهایی که confirmed=false دارن ولی isByUser ندارن → احتمالاً کاربر-ساخته‌ان → isByUser=true

import { MongoClient } from 'mongodb';

const url = process.env.DATABASE_URL!;
const client = new MongoClient(url);

async function main() {
    await client.connect();
    const db = client.db();

    // ۱. Industry
    const industryCol = db.collection('Industry');
    const indResult = await industryCol.updateMany(
        { isByUser: { $exists: false } },
        [{ $set: { isByUser: { $ne: [{ $ifNull: ['$confirmed', true] }, true] } } }],
    );
    console.log(`✅ Industry: ${indResult.modifiedCount} updated`);

    // ۲. Brand
    const brandCol = db.collection('Brand');
    const brandResult = await brandCol.updateMany(
        { isByUser: { $exists: false } },
        [{ $set: { isByUser: { $ne: [{ $ifNull: ['$confirmed', true] }, true] } } }],
    );
    console.log(`✅ Brand: ${brandResult.modifiedCount} updated`);

    // ۳. ProductReference
    const productCol = db.collection('ProductReference');
    const productResult = await productCol.updateMany(
        { isByUser: { $exists: false } },
        [{ $set: { isByUser: { $ne: [{ $ifNull: ['$confirmed', true] }, true] } } }],
    );
    console.log(`✅ ProductReference: ${productResult.modifiedCount} updated`);

    // ۴. Location — همه‌شون پیش‌فرض confirmed=true و isByUser=false
    const locCol = db.collection('Location');
    const locResult = await locCol.updateMany(
        { isByUser: { $exists: false } },
        { $set: { isByUser: false, confirmed: true } },
    );
    console.log(`✅ Location: ${locResult.modifiedCount} updated`);

    await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
