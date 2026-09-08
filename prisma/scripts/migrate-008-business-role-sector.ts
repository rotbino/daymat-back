// prisma/scripts/migrate-008-business-role-sector.ts
// ✅ افزودن فیلدهای businessRole و businessSector به Business
//
// استراتژی:
//   - رکوردهای قدیمی: type رو به businessRole نگاشت می‌کنیم + businessSector رو هم ست می‌کنیم
//   - رکوردهای جدید: موقع create/update توسط فرانت ست می‌شن
//   - فیلد type حفظ می‌شه (backward-compat) ولی دیگه فیلد اصلی نیست
//
// نگاشت قدیم → جدید:
//   producer → manufacturing/final_product
//   wholesaler → distribution/wholesaler
//   importer → trade/importer
//   exporter → trade/exporter
//   distributor → distribution/distributor
//   retailer → retail/store
//   contractor → service/contracting
//   service_provider → service/other_services
//   other → service/other_services

import { MongoClient } from 'mongodb';

const url = process.env.DATABASE_URL!;
const client = new MongoClient(url);

// ✅ نگاشت type قدیم → { sector, role }
const TYPE_MAP: Record<string, { sector: string; role: string }> = {
    producer: { sector: 'manufacturing', role: 'final_product' },
    wholesaler: { sector: 'distribution', role: 'wholesaler' },
    importer: { sector: 'trade', role: 'importer' },
    exporter: { sector: 'trade', role: 'exporter' },
    distributor: { sector: 'distribution', role: 'distributor' },
    retailer: { sector: 'retail', role: 'store' },
    contractor: { sector: 'service', role: 'contracting' },
    service_provider: { sector: 'service', role: 'other_services' },
    other: { sector: 'service', role: 'other_services' },
};

async function main() {
    await client.connect();
    const db = client.db();
    const col = db.collection('Business');

    // ۱. رکوردهایی که businessRole ندارن → از type نگاشت کن
    const businesses = await col.find({ businessRole: { $exists: false } }).toArray();
    console.log(`Found ${businesses.length} businesses without businessRole`);

    let updated = 0;
    for (const biz of businesses) {
        const oldType = biz.type || 'wholesaler';
        const mapping = TYPE_MAP[oldType] || TYPE_MAP['wholesaler'];

        await col.updateOne(
            { _id: biz._id },
            {
                $set: {
                    businessRole: mapping.role,
                    businessSector: mapping.sector,
                },
            },
        );
        updated++;
    }

    console.log(`✅ Migrated ${updated} businesses`);

    // ۲. آمار نهایی
    const total = await col.countDocuments();
    const withRole = await col.countDocuments({ businessRole: { $exists: true, $ne: null } });
    const withoutRole = await col.countDocuments({
        $or: [
            { businessRole: { $exists: false } },
            { businessRole: null },
        ],
    });
    console.log(`\n📊 Stats:`);
    console.log(`   Total:        ${total}`);
    console.log(`   With role:    ${withRole}`);
    console.log(`   Without role: ${withoutRole}`);

    await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
