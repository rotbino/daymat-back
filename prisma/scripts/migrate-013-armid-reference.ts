// prisma/scripts/migrate-013-armid-reference.ts
// ✅ armId روی Brand و ProductReference — فعلا null (بعداً پر می‌شه)
import { MongoClient } from 'mongodb';

const url = process.env.DATABASE_URL!;
const client = new MongoClient(url);

async function main() {
    await client.connect();
    const db = client.db();

    const r1 = await db.collection('Brand').updateMany(
        { armId: { $exists: false } },
        { $set: { armId: null } },
    );
    console.log(`✅ Brand: ${r1.modifiedCount} updated with armId=null`);

    const r2 = await db.collection('ProductReference').updateMany(
        { armId: { $exists: false } },
        { $set: { armId: null } },
    );
    console.log(`✅ ProductReference: ${r2.modifiedCount} updated with armId=null`);

    await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
