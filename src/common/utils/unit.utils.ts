// src/common/utils/unit.utils.ts
// ✅ نرمال‌سازی عنوان واحد برای جلوگیری از ثبت تکراری
// (ي/ی عربی-فارسی، ك/ک، همزه‌ها، نیم‌فاصله، فاصله‌های تکراری)
const NORMALIZE_MAP: Record<string, string> = {
    'ي': 'ی', 'ى': 'ی', 'ئ': 'ی',
    'ك': 'ک',
    'أ': 'ا', 'إ': 'ا', 'ٱ': 'ا',
    'ة': 'ه',
    'ؤ': 'و',
    '\u200c': ' ', // نیم‌فاصله → فاصله
};

export function normalizeUnitTitle(raw: string): string {
    let s = (raw || '').trim().toLowerCase();
    s = s.replace(/[يىئكأإٱةؤ\u200c]/g, (ch) => NORMALIZE_MAP[ch] ?? ch);
    s = s.replace(/\s+/g, ' '); // فاصله‌های تکراری → یکی
    s = s.replace(/[\u064B-\u0652\u0670]/g, ''); // اعراب
    return s;
}

export const UNIT_SCOPES = ['wholesale', 'retail'] as const;
export type UnitScope = (typeof UNIT_SCOPES)[number];
