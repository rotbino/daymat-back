// prisma/scripts/migrate-006-remove-needs-category.ts
// تبدیل همه needs_category به published
// (categoryId خالی بودن نشان‌دهنده بدون دسته بودن است، نیازی به status جداگانه نیست)

import { MongoClient } from 'mongodb';

const url = process.env.DATABASE_URL!;
const client = new MongoClient(url);

async function main() {
    await client.connect();
    const db = client.db();
    const col = db.collection('ad_publications');

    const result = await col.updateMany(
        { status: 'needs_category' },
        { $set: { status: 'published' } },
    );
    console.log(`✅ Converted ${result.modifiedCount} publications from needs_category to published`);
    await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
