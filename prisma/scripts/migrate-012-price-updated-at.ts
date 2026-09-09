// prisma/scripts/migrate-012-price-updated-at.ts
// ✅ Backfill priceUpdatedAt و expiresAt روی رکوردهای Ad موجود
import { MongoClient } from 'mongodb';

const url = process.env.DATABASE_URL!;
const client = new MongoClient(url);

async function main() {
    await client.connect();
    const db = client.db();
    const col = db.collection('Ad');

    // ۱. priceUpdatedAt — اگه وجود نداره، از updatedAt کپی کن
    const r1 = await col.updateMany(
        { priceUpdatedAt: { $exists: false } },
        [{ $set: { priceUpdatedAt: '$updatedAt' } }],
    );
    console.log(`✅ priceUpdatedAt: ${r1.modifiedCount} updated`);

    // ۲. expiresAt — اگه null نباشه، null کن (دیگه انقضا لازم نیست)
    const r2 = await col.updateMany(
        { expiresAt: { $ne: null } },
        { $set: { expiresAt: null } },
    );
    console.log(`✅ expiresAt: ${r2.modifiedCount} set to null`);

    await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
