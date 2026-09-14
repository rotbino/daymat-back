// src/common/reserved-slugs.ts
// آدرس‌های رزروشدهٔ ریشهٔ سایت — فهرست مشترک کاتالوگ فروش و صفحهٔ اعلان خرید.
// هر دو نوع صفحه روی ریشه بالا می‌آیند (daymat.ir/{slug}) پس باید با مسیرهای ایستای
// فرانت و اندپوینت‌های سیستم تداخل نداشته باشند. اتحاد فهرست‌های قبلی + مسیرهای app.
export const RESERVED_SLUGS: string[] = [
    // مسیرهای ایستای فرانت (app/*)
    'ad', 'admin', 'api', 'arm', 'arm-admin', 'arms', 'business', 'catalog',
    'catalogs', 'credit', 'docs', 'explore', 'feedback', 'home', 'inquiries',
    'login', 'logout', 'market', 'markets', 'my-catalogs', 'my-inquiries',
    'new', 'new-home', 'no-arm', 'notifications', 'profile', 'register',
    'saved-ads', 'server-unavailable', 'dashboard', 'c', 'assets', 'static',
    'favicon', 'manifest',
];
