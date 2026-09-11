// src/common/services/cache.helper.ts
// ✅ CacheHelper — لایهٔ کش امن روی cache-manager (حافظهٔ درون-پردازشی)
//
// چرا این helper؟
// - الگوی «epoch»: باطل‌سازی O(1) بدون لیست‌کردن کلیدها — با هر mutation
//   شمارندهٔ epoch آن namespace بامپ می‌شود و کلیدهای قدیمی تا پایان TTL خودکار می‌میرند.
// - هر خطای کش به‌صورت امن نادیده گرفته می‌شود تا هرگز مسیر اصلی (DB query) نشکند.
// - TTL به میلی‌ثانیه (cache-manager v5+).

import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

/** TTL پیش‌فرض epoch — یک روز؛ با هر bust زودتر از این هم عوض می‌شود */
const EPOCH_TTL_MS = 24 * 60 * 60 * 1000;

/** namespace کش تابلوی بازار (ویترین) — بعد از هر تغییر وضعیت انتشار باید bust شود
 *  وگرنه مکث/حذف کاتالوگ تا ۵ دقیقه در تابلو اعمال نمی‌شود */
export const VITRINE_CACHE_PREFIX = 'vitrine';

@Injectable()
export class CacheHelper {
    /** شمارندهٔ محلی برای وقتی که کش در دسترس نیست — تضمین epoch جدید */
    private localCounters = new Map<string, number>();

    constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

    /**
     * خواندن از کش یا اجرای factory و ذخیرهٔ نتیجه.
     * @param prefix  namespace کش (مثل 'prod-search')
     * @param keyParts اجزای کلید (پارامترهای کوئری) — null/undefined هم جزو کلید می‌شوند
     * @param ttlMs   عمر کش به میلی‌ثانیه
     * @param factory کوئری اصلی دیتابیس
     */
    async wrap<T>(
        prefix: string,
        keyParts: (string | number | boolean | null | undefined)[],
        ttlMs: number,
        factory: () => Promise<T>,
    ): Promise<T> {
        const key = await this.buildKey(prefix, keyParts);
        try {
            const cached = await this.cacheManager.get<T>(key);
            if (cached !== undefined && cached !== null) return cached;
        } catch {
            // خطای کش = بی‌خیال کش، مستقیم DB
        }
        const fresh = await factory();
        try {
            await this.cacheManager.set(key, fresh, ttlMs);
        } catch {
            // ذخیرهٔ کش اختیاری است — خطا مهم نیست
        }
        return fresh;
    }

    /** باطل‌سازی کل namespace — بعد از هر create/update/delete صدا بزنید */
    async bust(prefix: string): Promise<void> {
        try {
            await this.cacheManager.del(`epoch:${prefix}`);
        } catch {
            // مهم نیست
        }
        this.localCounters.set(prefix, (this.localCounters.get(prefix) || 0) + 1);
    }

    // ────────────────────────────────────────────────
    private async buildKey(prefix: string, keyParts: (string | number | boolean | null | undefined)[]): Promise<string> {
        const ep = await this.getEpoch(prefix);
        return `${prefix}:v${ep}:${keyParts.map((p) => String(p ?? '_')).join('|')}`;
    }

    private async getEpoch(prefix: string): Promise<string> {
        try {
            const e = await this.cacheManager.get<string>(`epoch:${prefix}`);
            if (e) return e;
        } catch {
            // می‌افتیم روی شمارندهٔ محلی
        }
        const local = (this.localCounters.get(prefix) || 0) + 1;
        this.localCounters.set(prefix, local);
        const e = `${Date.now().toString(36)}-${local}`;
        try {
            await this.cacheManager.set(`epoch:${prefix}`, e, EPOCH_TTL_MS);
        } catch {
            // مهم نیست
        }
        return e;
    }
}
