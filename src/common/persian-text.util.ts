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
 * الگوی regex برای پیدا کردن عنوان تکراری در دیتابیس (Mongo $regex).
 * فاصله/نیم‌فاصله بین کلمات → [\s\u200c]+ ، حروف هم‌شکل → کلاس کاراکتر.
 * خروجی برای { $regex: pattern, $options: 'i' } با انکر ^...$
 */
export function buildDedupRegexPattern(normalizedTitle: string): string {
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const words = normalizeForCompare(normalizedTitle).split(' ').filter(Boolean);
    if (words.length === 0) return '^$';
    const parts = words.map((w) => {
        let p = '';
        for (const ch of w) {
            if (ch === 'ی') p += '[یيى]';
            else if (ch === 'ک') p += '[کك]';
            else if (ch === 'ه') p += '[هة]';
            else if (ch === 'ا') p += '[اآأإٱ]';
            else p += escape(ch);
        }
        return p;
    });
    return '^' + parts.join('[\\s\u200c]+') + '$';
}

/**
 * عنوان تکراری است؟ — findFirst با الگوی نرمال‌شده.
 * خروجی: آیتم موجود یا null
 */
export function findDuplicateTitle(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    model: any,
    normalizedTitle: string,
    excludeId?: string,
    extraWhere: Record<string, unknown> = {},
) {
    const where: Record<string, any> = {
        title: {
            $regex: buildDedupRegexPattern(normalizedTitle),
            $options: 'i',
        },
        ...extraWhere,
    };
    if (excludeId) where.id = { $ne: excludeId };
    return model.findFirst({ where, select: { id: true, title: true } });
}
