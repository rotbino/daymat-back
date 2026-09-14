// prisma/scripts/migrate-014-inquiry-publication.ts
// ✅ مهاجرت یک‌بارهٔ مکانیزم موقت → InquiryPublication
//    ArmMembership.inquiryId + inquiryPublishState='published'  →  سطر InquiryPublication
// Idempotent — چند بار اجرا شدنش بی‌ضرر است ($setOnInsert + فیلتر موجود)
import { MongoClient, ObjectId } from 'mongodb';

const url = process.env.DATABASE_URL!;
const client = new MongoClient(url);

async function main() {
    await client.connect();
    const db = client.db();

    const members = await db.collection('ArmMembership')
        .find({ inquiryId: { $ne: null }, inquiryPublishState: 'published' })
        .toArray();
    console.log(`📋 ArmMembershipهای منتشرشدهٔ لگسی: ${members.length}`);

    let created = 0;
    for (const m of members) {
        const inquiryId = String(m.inquiryId);
        const armId = String(m.armId);

        // دفتر باید واقعاً موجود باشد (عضویت‌های کهنه با دفتر حذف‌شده را رد کن)
        const inquiry = await db.collection('Inquiry').findOne(
            { _id: new ObjectId(inquiryId) },
            { projection: { _id: 1, status: 1 } },
        );
        if (!inquiry) {
            console.log(`⚠️  رد شد — دفتر ${inquiryId} وجود ندارد (membership ${m._id})`);
            continue;
        }
        if (inquiry.status === 'archived') {
            console.log(`⚠️  رد شد — دفتر ${inquiryId} بایگانی است (membership ${m._id})`);
            continue;
        }

        const r = await db.collection('inquiry_publications').updateOne(
            { inquiryId, armId },
            {
                $setOnInsert: {
                    inquiryId,
                    armId,
                    status: 'published',
                    optOut: false,
                    categoryPath: [],
                    publishedAt: new Date(),
                    updatedAt: new Date(),
                },
            },
            { upsert: true },
        );
        if (r.upsertedCount > 0) created++;
    }
    console.log(`✅ InquiryPublication ساخته‌شده: ${created} (کل پردازش‌شده: ${members.length})`);

    // فیلدهای لگسی روی membership دست نمی‌زنیم — برای rollback امن است
    await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
