/**
 * بک‌فیل مهاجرت کاتالوگ→بازار — فاز ۲
 * پیش‌نیاز: `npx prisma db push` با اسکیمای جدید انجام شده باشد
 * اجرا:     npx ts-node scripts/backfill-catalog-migration.ts
 * Idempotent است — اجرای مکرر بی‌خطر (شرط‌ها روی null فیلتر می‌کنند)
 */
import 'dotenv/config'; // اطمینان از لود .env (پریزما خودش هم لود می‌کند — بی‌ضرر)
import { randomInt } from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ─── تولید کد رفرال — کپی همین‌جا تا اسکریپت خودکفا باشد ───
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
function generateReferralCode(len = 8): string {
    let s = '';
    for (let i = 0; i < len; i++) s += ALPHABET[randomInt(ALPHABET.length)];
    return s;
}

// ۱) کد رفرال برای کاربرانِ بدون کد
async function backfillReferralCodes() {
    const users = await prisma.user.findMany({
        where: { referralCode: null },
        select: { id: true },
    });
    console.log(`[referral] ${users.length} کاربر بدون کد`);
    let done = 0;
    for (const u of users) {
        for (let i = 0; i < 5; i++) {
            try {
                await prisma.user.update({
                    where: { id: u.id },
                    data: { referralCode: generateReferralCode() },
                });
                done++;
                break;
            } catch { /* برخورد یونیک (P2002) → کد بعدی */ }
        }
    }
    console.log(`[referral] ${done} کد ساخته شد`);
}

// ۲) کپی categoryId → catalogCategoryId برای آگهی‌های فقط-کاتالوگی (armId=null)
async function backfillCatalogCategory() {
    const where = {
        armId: null as any,
        categoryId: { not: null as any },
        catalogCategoryId: null as any,
    };
    const ads = await prisma.ad.findMany({ where, select: { id: true, categoryId: true } });
    console.log(`[catalogCategory] ${ads.length} آگهی کاندید`);
    if (ads.length === 0) return;

    const CHUNK = 100;
    for (let i = 0; i < ads.length; i += CHUNK) {
        await Promise.all(
            ads.slice(i, i + CHUNK).map((ad) =>
                prisma.ad.update({
                    where: { id: ad.id },
                    data: { catalogCategoryId: ad.categoryId! },
                }),
            ),
        );
        process.stdout.write(`\r[catalogCategory] ${Math.min(i + CHUNK, ads.length)}/${ads.length}`);
    }
    console.log('');
}

// ۳) اعضای فعالِ دارای کاتالوگ → published
async function backfillPublishState() {
    const res = await prisma.armMembership.updateMany({
        where: { status: 'active', publishState: null, catalogId: { not: null } },
        data: { publishState: 'published' },
    });
    console.log(`[publishState] ${res.count} عضویت → published`);
}

async function main() {
    console.log('── شروع بک‌فیل مهاجرت کاتالوگ ──');
    await backfillReferralCodes();
    await backfillCatalogCategory();
    await backfillPublishState();
    console.log('── تمام شد ──');
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());