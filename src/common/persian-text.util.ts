// src/common/persian-text.util.ts
// ============================================================
// نرمال‌سازی متن فارسی — برای جلوگیری قطعی از ثبت تکراری
// ------------------------------------------------------------
// «تن ماهی مکنزی» ، «تن ماهی  مکنزی» ، «تن ماهي مكنزي»
// باید همه یکی حساب بشن:
//   - حروف عربی/فارسی هم‌شکل: ي→ی ، ك→ک ، ة→ه ، أ/إ/ٱ→ا ،ؤ→و ، ئ→ی
//   - اعداد فارسی/عربی → لاتین (برای مقایسه)
//   - نیم‌فاصله (U+200C) و فاصله‌های تکراری → یک فاصله
//   - trim
// ============================================================

const CHAR_MAP: Record<string, string> = {
    'ي': 'ی', 'ى': 'ی', 'ﯼ': 'ی', 'ﯽ': 'ی',
    'ك': 'ک', 'ﮐ': 'ک',
    'ة': 'ه',
    'أ': 'ا', 'إ': 'ا', 'ٱ': 'ا', 'آ': 'ا', // آ و ا هم‌ارز برای مقایسه
    'ؤ': 'و',
    'ئ': 'ی',
    'ۀ': 'ه',
    // اعداد فارسی
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
    '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
    // اعداد عربی
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
    '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

/**
 * نرمال‌سازی برای مقایسه — حروف هم‌شکل، اعداد و فاصله‌ها را یکسان می‌کند.
 * ⚠️ فقط برای dedup استفاده می‌شود؛ متن اصلی ذخیره‌شده دست‌نخورده می‌ماند
 * (فقط trim و فاصله‌های تکراری در ذخیره‌سازی نرمال می‌شود).
 */
export function normalizeForCompare(input: string): string {
    if (!input) return '';
    let s = input.normalize('NFKC');
    s = s.replace(/[يىﯼﯽكﮐةأإٱآؤئۀ۰-۹٠-٩]/g, (ch) => CHAR_MAP[ch] ?? ch);
    s = s.replace(/[\u200c\u200f\u200e\u064B-\u065F\u0670]/g, ''); // نیم‌فاصله، علامت‌های اعراب
    s = s.replace(/\s+/g, ' ').trim().toLowerCase();
    return s;
}

/**
 * متن قابل ذخیره‌سازی — حروف هم‌شکل عربی→فارسی، یک فاصله بین کلمات، trim.
 * (اعداد دست‌نخورده می‌مانند — کاربر ۲۰۰ یا ۲۰۰ تایپ کرده هرچه نوشته همون)
 */
export function normalizeForStore(input: string): string {
    if (!input) return '';
    let s = input.replace(/[يىﯼﯽكﮐةأإٱؤئۀ]/g, (ch) => CHAR_MAP[ch] ?? ch);
    s = s.replace(/[\u200f\u200e]/g, '');
    s = s.replace(/[\u200c](?=[\u0600-\u06FF])/g, '\u200c'); // نیم‌فاصله بین حروف فارسی حفظ
    s = s.replace(/[\u200c]/g, ' ');                         // بقیه نیم‌فاصله‌ها → فاصله
    s = s.replace(/\s+/g, ' ').trim();
    return s;
}

/**
 * الگوی regex برای پیدا کردن عنوان تکراری (تطبیق در JS روی کاندیداها).
 * فاصله/نیم‌فاصله بین کلمات → [\s\u200c]+ ، حروف هم‌شکل → کلاس کاراکتر.
 * انکر ^...$ — تطبیق کاملِ کل عنوان.
 */
export function buildDedupRegexPattern(normalizedTitle: string): string {
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // کلاس رقم‌ها: الگو از normalizeForCompare با ارقام لاتین می‌آید ولی متن ذخیره‌شده
    // ممکن است ارقام فارسی/عربی داشته باشد (normalizeForStore آنها را دست نمی‌زند)
    const DIGIT_CLASS = '[0-9\u06F0-\u06F9\u0660-\u0669]';
    const words = normalizeForCompare(normalizedTitle).split(' ').filter(Boolean);
    if (words.length === 0) return '^$';
    const parts = words.map((w) => {
        let p = '';
        for (const ch of w) {
            if (ch === 'ی') p += '[یيى]';
            else if (ch === 'ک') p += '[کك]';
            else if (ch === 'ه') p += '[هة]';
            else if (ch === 'ا') p += '[اآأإٱ]';
            else if (/[0-9]/.test(ch)) p += DIGIT_CLASS;
            else p += escape(ch);
        }
        return p;
    });
    return '^' + parts.join('[\\s\u200c]+') + '$';
}

/**
 * عنوان تکراری است؟ — کاندیداها با فیلترهای پشتیبانی‌شدهٔ Prisma + تطبیق دقیق fuzzy در JS.
 * ⚠️ نکتهٔ مهم: Prisma اپراتورهای خام مونگو ($regex/$options) را در کوئری تایپ‌شده نمی‌پذیرد
 * (PrismaClientValidationError: Unknown argument `$regex`) — باگ 500 ثبت کالا/برند از همین بود.
 * راه‌حل: کاندیداها با contains حساس به حالت روی همهٔ کلمات (≥۲ حرف) کشیده می‌شوند
 * (سوپرمجموعهٔ مطابق‌های واقعی) و تطبیق نهایی با همان الگوی buildDedupRegexPattern
 * در جاوااسکریپت انجام می‌شود.
 * خروجی: آیتم موجود یا null
 */
export async function findDuplicateTitle(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    model: any,
    normalizedTitle: string,
    excludeId?: string,
    extraWhere: Record<string, unknown> = {},
): Promise<{ id: string; title: string } | null> {
    const pattern = buildDedupRegexPattern(normalizedTitle);
    if (pattern === '^$') return null;
    let re: RegExp;
    try {
        re = new RegExp(pattern, 'i');
    } catch {
        return null; // الگوی نامعتبر — به‌جای کرش، بی‌نتیجه برگردان
    }

    const words = normalizeForCompare(normalizedTitle)
        .split(' ')
        .filter((w) => w.length >= 2);
    if (words.length === 0) return null;

    // هر کلمه باید در عنوانِ موجود حضور داشته باشد — شرط لازمِ هر مطابقت واقعی
    // واریانت ارقام: متن ذخیره‌شده ممکن است ارقام فارسی/عربی داشته باشد ولی
    // کلماتِ الگو همیشه لاتین‌اند (normalizeForCompare)
    const digitVariants = (w: string): string[] => {
        if (!/[0-9]/.test(w)) return [w];
        const fa = w.replace(/[0-9]/g, (d) => '\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9'[+d]);
        const ar = w.replace(/[0-9]/g, (d) => '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669'[+d]);
        return Array.from(new Set([w, fa, ar]));
    };
    const and: Record<string, unknown>[] = words.map((w) => ({
        OR: digitVariants(w).map((v) => ({ title: { contains: v, mode: 'insensitive' } })),
    }));
    for (const [key, value] of Object.entries(extraWhere)) and.push({ [key]: value });
    if (excludeId) and.push({ id: { not: excludeId } });

    const candidates: Array<{ id: string; title: string }> = await model.findMany({
        where: { AND: and },
        select: { id: true, title: true },
        take: 500,
    });
    return candidates.find((c) => re.test(c.title)) || null;
}
