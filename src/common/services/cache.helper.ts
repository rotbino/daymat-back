// src/common/services/cache.helper.ts
// ✅ CacheHelper — لایهٔ کش امن روی cache-manager (حافظهٔ درون-پردازشی)
//
// چرا این helper؟
// - الگوی «epoch»: باطل‌سازی O(1) بدون لیست‌کردن کلیدها — با هر mutation
//   شمارندهٔ epoch آن namespace بامپ می‌شود و کلیدهای قدیمی تا پایان TTL خودکار می‌میرند.
// - گرم‌کردن پس‌زمینه (rewarm): آخرین کلیدهای مصرف‌شدهٔ هر namespace به‌همراه factory
//  شان نگه‌داری می‌شوند؛ بعد از هر bust همان کلیدها در پس‌زمینه دوباره ساخته و با
//   epoch تازه ذخیره می‌شوند — تا اولین کاربرِ بعد از باطل‌سازی هزینهٔ ساخت کش را ندهد.
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

/** حداکثر تعداد کلید «گرم» نگه‌داری‌شده برای rewarm هر namespace */
const REWARM_KEY_CAP = 30;

type RewarmEntry = {
    keyParts: (string | number | boolean | null | undefined)[];
    ttlMs: number;
    factory: () => Promise<unknown>;
};

@Injectable()
export class CacheHelper {
    /** شمارندهٔ محلی برای وقتی که کش در دسترس نیست — تضمین epoch جدید */
    private localCounters = new Map<string, number>();

    /** آخرین کلیدهای مصرف‌شدهٔ هر namespace (LRU تقریبی) — برای گرم‌کردن پس‌زمینه بعد از bust */
    private rewarmRegistry = new Map<string, Map<string, RewarmEntry>>();

    /** قفل درون‌اجرایی هر rewarm — جلوگیری از دوباره‌کاری همزمان روی یک کلید */
    private warming = new Set<string>();

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
        this.rememberForRewarm(prefix, keyParts, ttlMs, factory);
        return fresh;
    }

    /**
     * باطل‌سازی کل namespace — بعد از هر create/update/delete صدا بزنید.
     * بلافاصله، گرم‌کردن پس‌زمینهٔ آخرین کلیدهای پرکاربرد همین namespace هم آغاز می‌شود
     * (fire-and-forget — هرگز مسیر اصلی mutation را کند یا شکسته نمی‌کند).
     */
    async bust(prefix: string): Promise<void> {
        try {
            await this.cacheManager.del(`epoch:${prefix}`);
        } catch {
            // مهم نیست
        }
        this.localCounters.set(prefix, (this.localCounters.get(prefix) || 0) + 1);
        this.scheduleRewarm(prefix);
    }

    // ────────────────────────────────────────────────
    // گرم‌کردن پس‌زمینه — بعد از هر bust، آخرین کلیدهای namespace دوباره ساخته می‌شوند
    // تا اولین درخواست‌کنندهٔ بعد از باطل‌سازی هم پاسخ کش‌شده بگیرد
    // ────────────────────────────────────────────────
    private rememberForRewarm(
        prefix: string,
        keyParts: (string | number | boolean | null | undefined)[],
        ttlMs: number,
        factory: () => Promise<unknown>,
    ): void {
        let registry = this.rewarmRegistry.get(prefix);
        if (!registry) {
            registry = new Map();
            this.rewarmRegistry.set(prefix, registry);
        }
        const rawKey = keyParts.map((p) => String(p ?? '_')).join('|');
        // LRU تقریبی: کلید تکراری → حذف و ارجاع تازه
        registry.delete(rawKey);
        registry.set(rawKey, { keyParts, ttlMs, factory });
        if (registry.size > REWARM_KEY_CAP) {
            const oldest = registry.keys().next().value;
            if (oldest !== undefined) registry.delete(oldest);
        }
    }

    private scheduleRewarm(prefix: string): void {
        const registry = this.rewarmRegistry.get(prefix);
        if (!registry || registry.size === 0) return;
        for (const [rawKey, entry] of [...registry.entries()]) {
            const lock = `${prefix}:${rawKey}`;
            if (this.warming.has(lock)) continue;
            this.warming.add(lock);
            void this.rewarmKey(prefix, entry)
                .catch(() => {})
                .finally(() => this.warming.delete(lock));
        }
    }

    private async rewarmKey(prefix: string, entry: RewarmEntry): Promise<void> {
        // کلید با epoch «تازهٔ» لحظهٔ پایان factory ساخته می‌شود —
        // اگر در بین راه bust جدیدتری بیاید، این نوشته زیر epoch قدیمی می‌ماند و هرگز خوانده نمی‌شود (بی‌خطر)
        const fresh = await entry.factory();
        const key = await this.buildKey(prefix, entry.keyParts);
        await this.cacheManager.set(key, fresh, entry.ttlMs);
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
