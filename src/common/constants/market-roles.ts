// src/common/constants/market-roles.ts
/**
 * ✅ فلسفهٔ بازوها — بازنویسی مالک (شهریور ۱۴۰۴):
 *
 *    «بازوی خرید» تقریباً برای همه لازم است — حتی تولیدکننده هم عمده می‌خرد و
 *    عمده‌فروش هم عمده‌تر می‌خرد. اما «بازوی فروشِ عمده» فقط برای لایه‌های
 *    بالادستیِ زنجیرهٔ تامین معنا دارد: تولید، بازرگانی، توزیع/پخش.
 *
 *    خرده‌فروش (سوپرمارکت، فروشگاه، فروشگاه اینترنتی) و خدمات (نصاب، مشاور،
 *    پیمانکار) فقط «خریدار عمده»اند — اگر بازوی فروش هم بسازند، پیشنهاد تامینِ
 *    بی‌معنا به هم‌گروه‌های خودشان می‌فرستند و بازار شلوغ و بی‌اعتماد می‌شود.
 *    در این نسخه اصلاً وارد «بازار فروش خدمات» نمی‌شویم؛ خدماتی‌ها فقط بازوی خرید دارند.
 *
 *    این قواعد فقط در کد حل می‌شوند (نه روی دوش کاربر):
 *      · گیت ساخت بازوی فروش (catalog.service.create)
 *      · فیلتر کاندیدهای خریدار (customerCandidates — فروشِ فقط پایین‌دست)
 *      · فیلتر کاندیدهای تامین‌کننده (supplierCandidates — فقط بَسته‌فروش‌ها)
 */

/** sectorهای مجاز به داشتن بازوی فروش عمده (لایه‌های بالادستی زنجیره) */
export const WHOLESALE_SECTOR_IDS = ['manufacturing', 'trade', 'distribution'] as const;

/** sectorهای فقط-خریدار (لایهٔ پایین‌دست — این نسخه فروش ندارند) */
export const PURCHASE_ONLY_SECTOR_IDS = ['retail', 'service'] as const;

/**
 * نقش‌های مجاز برای ساخت بازوی فروش — همان CHILD id های BUSINESS_TYPE فرانت.
 * ⚠️ لجستیک/انبارداری فعلاً مجازند (کالای فیزیکی جابه‌جا می‌کنند)؛ اگر بعداً مالک
 *    خواست فروشِ خدماتی‌شان هم بسته شود، فقط از همین لیست حذف شوندند.
 */
export const WHOLESALE_SELLER_ROLES = [
    // توزیع، پخش و واسطه‌گری
    'wholesaler', 'distributor', 'distributor2', 'broker', 'logistics', 'warehouse',
    // تولید و صنعت
    'raw_material', 'parts', 'final_product', 'packaging',
    // بازرگانی و تجارت
    'importer', 'exporter', 'importer_exporter', 'trading_house', 'agent',
] as const;

/** لایهٔ هر sector در زنجیره — ۱ بالادستی‌ترین */
export const SECTOR_TIER: Record<string, number> = {
    manufacturing: 1,
    trade: 1,
    distribution: 2,
    retail: 3,
    service: 3,
};

/**
 * ماتریس فروش عمده — هر فروشنده فقط به «پایین‌دستِ» واقعی می‌فروشد:
 *   · تولید / بازرگانی (لایه ۱) → همه sectorها مشتری مشروع‌اند
 *     (تولید↔تولید = فروش مواد اولیه؛ کاملاً بَسته و درست)
 *   · توزیع/پخش (لایه ۲) → فقط خرده‌فروش و خدمات‌بر (لایه ۳)
 *     — «پخش، تامین‌کنندهٔ پخشِ دیگر نیست» (خواستهٔ صریح مالک)
 *   · خرده‌فروش/خدمات → فقط سازگاری با کاتالوگ‌های لگسی؛ ساختِ تازه بسته است
 * خروجی null = بدون محدودیت (لایهٔ بالا).
 */
export const BUYER_SECTORS_BY_SELLER: Record<string, string[] | null> = {
    manufacturing: null,
    trade: null,
    distribution: ['retail', 'service'],
    retail: null,
    service: null,
};

/** آیا این «نقش بیزینسی» می‌تواند بازوی فروش بسازد؟ */
export function canCreateSalesArmRole(role?: string | null): boolean {
    if (!role) return true; // نقشِ ثبت‌نشدهٔ قدیمی — محدود نشود (سازگاری داده‌های قبل)
    return (WHOLESALE_SELLER_ROLES as readonly string[]).includes(role);
}

/** آیا این «sector» می‌تواند بازوی فروش بسازد؟ */
export function canCreateSalesArmSector(sector?: string | null): boolean {
    if (!sector) return true; // سازگاری با رکوردهای قدیمی
    return (WHOLESALE_SECTOR_IDS as readonly string[]).includes(sector);
}
