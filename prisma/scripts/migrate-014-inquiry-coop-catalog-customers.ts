// prisma/scripts/migrate-014-inquiry-coop-catalog-customers.ts
// ✅ عضویت متقابل بازوی فروش — backfill: همهٔ همکاری‌های «فعال» بازوی خرید که خریدارشان
//    هنوز در «اعضای بازوی فروش» تامین‌کننده (لِین خریدار) ثبت نشده را یک‌جا اصلاح می‌کند.
//    (رفع باگ گزارش مالک: تایید درخواست همکاری، تامین‌کننده را در اعضای بازو آورد ولی
//    خریدار در اعضای بازوی فروش تامین‌کننده نیامده بود — از این به بعد خودکار sync می‌شود)
//    اجرا: npx tsx prisma/scripts/migrate-014-inquiry-coop-catalog-customers.ts
import { MongoClient } from 'mongodb';

const url = process.env.DATABASE_URL!;
const client = new MongoClient(url);

async function main() {
    await client.connect();
    const db = client.db();

    const members = (await db.collection('InquiryMember').find({ status: 'active' }).toArray()) as any[];
    console.log(`🔎 ${members.length} همکاری فعال پیدا شد`);

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const m of members) {
        const inquiry = (await db.collection('Inquiry').findOne({ _id: m.inquiryId })) as any;
        const catalog = (await db.collection('Catalog').findOne({ _id: m.catalogId })) as any;
        if (!inquiry || !catalog) {
            skipped++;
            continue;
        }
        // بازوی فروشِ کسب‌وکارِ خودِ خریدار نمی‌تواند خریدار خودش باشد
        if (
            inquiry.businessId &&
            catalog.businessId &&
            inquiry.businessId.toString() === catalog.businessId.toString()
        ) {
            skipped++;
            continue;
        }

        const biz = inquiry.businessId
            ? ((await db.collection('Business').findOne({ _id: inquiry.businessId })) as any)
            : null;
        const now = new Date();
        const lane: any = {
            status: 'active',
            leftAt: null,
            customerBusinessId: biz?._id ?? null,
            customerStatus: 'active',
            customerVia: 'self_request',
            customerLeftAt: null,
            memberCity: biz?.city || inquiry.city || null,
            memberProvince: biz?.province || null,
            updatedAt: now,
        };
        const res = await db.collection('CatalogMember').updateOne(
            { catalogId: m.catalogId, userId: inquiry.ownerUserId },
            {
                $set: lane,
                $setOnInsert: { role: 'catalog_member', joinedAt: now, customerJoinedAt: now, invitedBy: null, createdAt: now },
            },
            { upsert: true },
        );
        if (res.upsertedCount) created++;
        else updated++;
    }

    console.log(`✅ انجام شد — ساخته‌شده: ${created}، به‌روزشده: ${updated}، ردشده: ${skipped}`);
    await client.close();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
