// src/scripts/fill-empty-refra-code.ts
// فقط کاربرانِ بدون کد کد می‌گیرد (null یا missing یا '').
// کدهای موجود هرگز بازنویسی نمی‌شوند. Idempotent.
import 'dotenv/config';
import { randomInt } from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
const gen = (len = 8) =>
    Array.from({ length: len }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

async function main() {
    const used = new Set<string>(); // یکتایی کدها در همین اجرا — چون ایندکس هنوز ساخته نشده

    for (let round = 1; round <= 10; round++) {
        // همه کاربران خوانده می‌شوند؛ جدا کردنِ بدون‌کدها در JS:
        // !referralCode یعنی undefined (missing) یا null یا '' — هر سه حالت
        const users = await prisma.user.findMany({ select: { id: true, referralCode: true } });
        const pending = users.filter((u) => !u.referralCode);

        if (pending.length === 0) break;
        if (round === 1) console.log(`[referral] ${pending.length} کاربر بدون کد (missing یا null)`);

        for (const u of pending) {
            let code = gen();
            while (used.has(code)) code = gen();
            used.add(code);

            // نوشتن اتمیک با گارد raw: فقط اگر فیلد هنوز خالی است
            const res: any = await prisma.$runCommandRaw({
                update: 'User',
                updates: [{
                    q: {
                        _id: { $oid: u.id },
                        $or: [
                            { referralCode: { $exists: false } },
                            { referralCode: null },
                            { referralCode: '' },
                        ],
                    },
                    u: { $set: { referralCode: code } },
                    multi: false,
                }],
            });

            if ((res?.n ?? 0) === 1) console.log(`[referral] ${u.id} → ${code}`);
            // n=0 یعنی در فاصلهٔ کوتاه کد گرفته شده → نمی‌زنیم
        }
    }

    // جمع‌بندی نهایی — با همان روش JS، نه فیلتر null پرزما
    const final = await prisma.user.findMany({ select: { id: true, referralCode: true } });
    const coded = final.filter((u) => !!u.referralCode);
    const missing = final.length - coded.length;
    const dup = coded.length - new Set(coded.map((u) => u.referralCode)).size;

    console.log(`[referral] جمع‌بندی: کل=${final.length} · کددار=${coded.length} · بدون‌کد=${missing} · کد تکراری=${dup}`);
    if (missing > 0 || dup > 0) {
        console.warn('[referral] ⚠️ مشکل باقی است — اسکریپت را دوباره اجرا کن');
        process.exitCode = 1;
    }
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());