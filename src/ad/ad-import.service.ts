// src/ad/ad-import.service.ts
// 📥 ایمپورت گروهی چندمنبعی — «موتور رشد کالاهای بازار»
//    منبع‌ها: متن ساده (نودپد/کپی) | اکسل/CSV | گرید فرانت | خروجی هوش مصنوعی (JSON)
//    فاز ۱ (parse): هر منبع → ردیف‌های خوانا + هشدارهای ساده فارسی + پیش‌حلّ واحد/برند/مرجع
//    فاز ۲ (commit): ساخت آگهی‌ها + اسکریپت باهوشِ دیکشنری:
//       - واحد نبود → خودکار ساخته می‌شود و به واحدهای بازوی فروش هم اضافه می‌شود
//       - برند نبود → خودکار ساخته می‌شود (دستهٔ «سایر»، در انتظار تایید ادمین)
//       - کالای مرجع نبود → ساخته می‌شود؛ بود → همان انتخاب می‌شود؛ هیچ‌وقت تکراری ثبت نمی‌شود
//    خروجی commit: گزارش کامل — چند موفق، چند رد و چرا، چه چیزهای جدیدی ساخته شد.
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogAccessService } from '../common/services/catalog-access.service';
import { CatalogPublishService } from '../common/services/catalog-publish.service';
import { CacheHelper, VITRINE_CACHE_PREFIX } from '../common/services/cache.helper';
import {
    normalizeForStore, normalizeForCompare, findDuplicateTitle,
} from '../common/persian-text.util';
import { normalizeUnitTitle } from '../common/utils/unit.utils';
import { ImportParseDto, ImportCommitDto } from './ad.dto';

/** تبدیل ارقام فارسی/عربی به لاتین */
const FA_DIGITS: Record<string, string> = {
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

const toLatinDigits = (s: string) => s.replace(/[۰-۹٠-٩]/g, (d) => FA_DIGITS[d] ?? d);

/** نرمال‌سازی نام کالا برای مقایسه */
const normalizeItemName = (s: string): string =>
    normalizeForCompare(toLatinDigits(s ?? '')).trim().toLowerCase();

/** حداکثر ردیف در هر ایمپورت — سقفِ موتور رشد */
const MAX_IMPORT_ROWS = 1000;

/** کلیدهای متعارف ستون‌ها — اکسل و خروجی هوش مصنوعی (لاتین + فارسی، بدون نیم‌فاصله/زیرخط) */
const normKey = (k: string): string =>
    normalizeForCompare(toLatinDigits(String(k ?? ''))).replace(/[\s_\-.]/g, '');

const NAME_KEYS = ['name', 'title', 'product', 'productname', 'item', 'itemname', 'نام', 'نامکالا', 'کالا', 'عنوان', 'محصول', 'شرح', 'شرحکالا'];
const PRICE_KEYS = ['price', 'unitprice', 'amount', 'cost', 'قیمت', 'قیمتواحد', 'بها', 'مبلغ', 'نرخ', 'فی'];
const UNIT_KEYS = ['unit', 'unitname', 'unittitle', 'saleunit', 'واحد', 'واحدفروش'];
const QTY_KEYS = ['unitqty', 'qty', 'qtyperunit', 'countperunit', 'count', 'perunit', 'unitsperpack', 'packqty', 'تعداد', 'تعداددر', 'تعداددرواحد', 'تعداددرهر', 'درواحد'];
const BRAND_KEYS = ['brand', 'brandname', 'brandtitle', 'manufacturer', 'maker', 'برند', 'مارک', 'سازنده'];

const pickKey = (obj: Record<string, unknown>, keys: string[]): unknown => {
    for (const k of keys) {
        const v = obj[k];
        if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return undefined;
};

/** عدد شل — «۴۸۵٬۰۰۰»، «1,250,000 تومان»، «485000.00» */
const looseNumber = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (v == null) return null;
    let s = toLatinDigits(String(v)).trim();
    if (!s) return null;
    const negative = s.startsWith('-');
    s = s.replace(/[^\d.,]/g, '');
    if (!s) return null;
    // اگر هم , و هم . هست، آخرین‌بود اعشار است؛ فقط جداکنندهٔ هزارگان حذف می‌شود
    if (s.includes(',') && s.includes('.')) {
        s = s.lastIndexOf(',') > s.lastIndexOf('.')
            ? s.replace(/\./g, '').replace(/,/g, '.')
            : s.replace(/,/g, '');
    } else {
        s = s.replace(/,/g, '');
        // نقطهٔ بین ارقامِ ۳تایی → هزارگان (۱۲.۵۰۰) — فقط اگر بعدش دقیقاً ۳ رقم و تمام است
        if (/\.\d{3}$/.test(s) && (s.match(/\./g) || []).length === 1 && s.split('.')[0].length <= 3) {
            s = s.replace(/\./g, '');
        }
    }
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    return negative ? -n : n;
};

export interface ParsedImportRow {
    name: string;
    price: number;
    valid: boolean;
    reason?: string;
    warnings?: string[];
    duplicateOfAdId?: string;
    referenceId?: string | null;
    referenceTitle?: string | null;
    unitTitle?: string | null;
    unitResolved?: boolean | null; // واحد در دیکشنری موجود است؟ (false = موقع ثبت ساخته می‌شود)
    unitContainsQty?: number | null;
    unitQty?: number | null;
    brandTitle?: string | null;
    brandResolved?: boolean | null;
}

export interface ImportSummary {
    total: number;
    valid: number;
    invalid: number;
    duplicates: number;
    withReference: number;
    withUnit: number;
    withBrand: number;
    newUnits: number; // واحدهایی که موقع ثبت تازه ساخته می‌شوند
    newBrands: number;
}

const emptySummary = (): ImportSummary => ({
    total: 0, valid: 0, invalid: 0, duplicates: 0, withReference: 0,
    withUnit: 0, withBrand: 0, newUnits: 0, newBrands: 0,
});

@Injectable()
export class AdImportService {
    private readonly logger = new Logger(AdImportService.name);

    constructor(
        private prisma: PrismaService,
        private catalogAccess: CatalogAccessService,
        private catalogPublish: CatalogPublishService,
        private cache: CacheHelper,
    ) {}

    // ════════════════════════════════════════════════════════════
    // فاز ۱ — پارس (متن | JSON هوش مصنوعی) + غنی‌سازی پیش‌نمایش
    // ════════════════════════════════════════════════════════════
    async parse(userId: string, dto: ImportParseDto) {
        await this.assertCatalogAccess(dto.catalogId, userId);

        const rawRows = dto.source === 'json'
            ? this.parseJsonItems(dto.text)
            : this.parsePriceListText(dto.text);

        if (!rawRows.length) {
            throw new BadRequestException({ errorCode: 'IMPORT_EMPTY', message: 'چیزی برای خواندن پیدا نکردیم — شکل خط‌ها را با نمونه مقایسه کن' });
        }
        if (rawRows.filter((r) => r.valid).length > MAX_IMPORT_ROWS) {
            throw new BadRequestException({ errorCode: 'IMPORT_TOO_MANY', message: `هر بار حداکثر ${MAX_IMPORT_ROWS.toLocaleString('fa-IR')} قلم — لیستت را چند قسمتی بفرست` });
        }

        const items = await this.enrich(dto.catalogId, rawRows);
        return { items, summary: this.buildSummary(items) };
    }

    /** پارس فایل اکسل/CSV — کنترلر فایل را می‌آورد، اینجا جدول می‌شود */
    async parseExcelFile(userId: string, catalogId: string, fileBuffer: Buffer, fileName: string) {
        await this.assertCatalogAccess(catalogId, userId);
        const lower = (fileName || '').toLowerCase();
        const isCsv = lower.endsWith('.csv') || lower.endsWith('.txt');

        let rawRows: { name: string; price: number; valid: boolean; reason?: string; unitTitle?: string | null; unitQty?: number | null; brandTitle?: string | null }[];
        try {
            if (isCsv) {
                const text = this.stripBom(fileBuffer.toString('utf8'));
                rawRows = this.parseDelimitedText(text);
            } else {
                const wb = XLSX.read(fileBuffer, { type: 'buffer' });
                const sheet = wb.Sheets[wb.SheetNames[0]];
                if (!sheet) throw new Error('empty workbook');
                rawRows = this.parseSheetToRows(sheet);
            }
        } catch (e: any) {
            throw new BadRequestException({ errorCode: 'FILE_UNREADABLE', message: 'فایل خوانده نشد — فرمت اکسل یا CSV معتبر بفرست' });
        }

        if (!rawRows.length) {
            throw new BadRequestException({ errorCode: 'IMPORT_EMPTY', message: 'در فایل هیچ ردیفی پیدا نکردیم — ستون «نام کالا» و «قیمت» را چک کن' });
        }
        if (rawRows.filter((r) => r.valid).length > MAX_IMPORT_ROWS) {
            throw new BadRequestException({ errorCode: 'IMPORT_TOO_MANY', message: `هر بار حداکثر ${MAX_IMPORT_ROWS.toLocaleString('fa-IR')} قلم — فایل را چند قسمتی بفرست` });
        }

        const items = await this.enrich(catalogId, rawRows);
        return { items, summary: this.buildSummary(items) };
    }

    // ════════════════════════════════════════════════════════════
    // فاز ۲ — ثبت نهایی + اسکریپت باهوشِ دیکشنری (واحد/برند/مرجع)
    // ════════════════════════════════════════════════════════════
    async commit(userId: string, dto: ImportCommitDto) {
        await this.assertCatalogAccess(dto.catalogId, userId);

        const items = (dto.items || []).filter((it) => it.name?.trim() && Number.isFinite(it.price) && it.price > 0);
        if (!items.length) {
            throw new BadRequestException({ errorCode: 'IMPORT_EMPTY', message: 'هیچ ردیف معتبری برای ثبت نیست' });
        }
        if (items.length > MAX_IMPORT_ROWS) {
            throw new BadRequestException({ errorCode: 'IMPORT_TOO_MANY', message: `هر بار حداکثر ${MAX_IMPORT_ROWS.toLocaleString('fa-IR')} قلم` });
        }

        const catalog = await this.prisma.catalog.findUnique({
            where: { id: dto.catalogId },
            select: { id: true, name: true, city: true, province: true, countryCode: true, provinceCode: true, cityCode: true, config: true },
        });
        if (!catalog) throw new BadRequestException({ errorCode: 'INVALID_CATALOG', message: 'بازوی فروش یافت نشد' });

        // ── دیکشنری واحد — همه در حافظه (تعداد کم) ──
        const allUnits = await this.prisma.unit.findMany({ select: { id: true, title: true, shortCode: true, containsQty: true } });
        const unitByKey = new Map<string, { id: string; title: string; containsQty: number | null }>();
        for (const u of allUnits) {
            for (const k of [normalizeUnitTitle(u.title), normalizeUnitTitle(u.shortCode || '')]) {
                if (k && !unitByKey.has(k)) unitByKey.set(k, u);
            }
        }
        const defaultUnit = allUnits.find((u) => (u as any).isDefault)
            ?? unitByKey.get(normalizeUnitTitle('عدد'))
            ?? allUnits[0];
        if (!defaultUnit) {
            throw new BadRequestException({ errorCode: 'UNIT_NOT_FOUND', message: 'واحدی برای ثبت قیمت پیدا نشد' });
        }

        // ── دیکشنری برند — عناوین موجود در حافظه + دستهٔ «سایر» برای جدیدها ──
        const allBrands = await this.prisma.brand.findMany({ select: { id: true, title: true }, take: 5000 });
        const brandByKey = new Map<string, { id: string; title: string; brandId?: string }>();
        for (const b of allBrands) {
            const k = normalizeItemName(b.title);
            if (k && !brandByKey.has(k)) brandByKey.set(k, b);
        }
        const otherCategory = await this.prisma.brandCategory.findFirst({
            where: { name: 'سایر' }, select: { id: true, name: true },
        }) ?? await this.prisma.brandCategory.findFirst({ select: { id: true, name: true } });

        // ── تکراری‌های خود کاتالوگ — یک کوئری برای همه ──
        const catalogAds = await this.prisma.ad.findMany({
            where: { catalogId: catalog.id, status: { not: 'deleted' } },
            select: { id: true, productType: true, title: true },
            take: 3000,
        });
        const catalogAdByKey = new Map<string, string>();
        for (const ad of catalogAds) {
            const key = normalizeItemName(ad.productType || ad.title || '');
            if (key && !catalogAdByKey.has(key)) catalogAdByKey.set(key, ad.id);
        }

        // ── کالای مرجع انتخابی کاربر (از پیش‌نمایش) ──
        const requestedRefIds = items.map((it) => it.referenceId).filter((v): v is string => !!v);
        const validRefs = requestedRefIds.length
            ? await this.prisma.productReference.findMany({ where: { id: { in: requestedRefIds } }, select: { id: true, title: true, brandId: true } })
            : [];
        const validRefById = new Map(validRefs.map((r) => [r.id, r]));

        // ── کش‌های درون‌اجرایی ──
        const unitCache = new Map<string, { id: string; title: string; containsQty: number | null }>(); // نرمال‌عنوان → واحد (شامل جدیدساخته‌ها)
        const brandCache = new Map<string, { id: string; title: string }>();
        const refCache = new Map<string, { id: string; title: string; brandId: string | null }>();
        const usedUnits = new Map<string, { id: string; containsQty: number | null }>(); // برای config.units بازوی فروش

        const createdAds: { id: string; title: string }[] = [];
        const createdUnits: string[] = [];
        const createdBrands: string[] = [];
        const createdReferences: string[] = [];
        const failed: { name: string; reason: string }[] = [];
        const now = new Date();

        for (const item of items) {
            const storeTitle = normalizeForStore(item.name);
            if (!storeTitle) {
                failed.push({ name: item.name, reason: 'نام کالا خالی است' });
                continue;
            }
            const nameKey = normalizeItemName(storeTitle);

            // ⛔ تکراری در همین بازوی فروش — رد می‌شود و در گزارش می‌آید
            const dupAdId = catalogAdByKey.get(nameKey);
            if (dupAdId) {
                failed.push({ name: storeTitle, reason: 'این کالا را از قبل داشتی — ثبت نشد' });
                continue;
            }

            // ✅ واحد باهوش: متن کاربر > موجود > ساخت خودکار
            const unit = await this.resolveUnit(item.unitTitle, unitByKey, unitCache, userId, createdUnits, defaultUnit);

            // ✅ برند باهوش: متن کاربر > موجود > ساخت خودکار (دستهٔ «سایر»)
            const brand = item.brandTitle?.trim()
                ? await this.resolveBrand(item.brandTitle, brandByKey, brandCache, userId, otherCategory, createdBrands)
                : null;

            // ✅ کالای مرجع باهوش: انتخاب کاربر > تطبیق عنوان > ساخت جدید (تاییدنشده)
            let reference = item.referenceId ? validRefById.get(item.referenceId) ?? null : null;
            if (!reference) reference = await this.resolveReference(storeTitle, brand?.id ?? null, unit?.title ?? null, refCache, userId, createdReferences);

            const qty = Number.isFinite(item.unitQty) && item.unitQty >= 2 ? Math.floor(item.unitQty) : null;
            const singlePrice = qty ? Math.round(item.price / qty) : null;

            const ad = await this.prisma.ad.create({
                data: {
                    armId: null,
                    catalogId: catalog.id,
                    createdByUserId: userId,
                    catalogCategoryId: null,
                    categoryId: null,
                    categoryPath: [],
                    unitId: unit.id,
                    title: storeTitle,
                    productType: storeTitle,
                    productReferenceId: reference?.id ?? null,
                    brandId: brand?.id ?? null,
                    paymentMethods: null,
                    customFields: {},
                    description: '',
                    unitPrice: item.price,
                    singleUnitPrice: singlePrice, // قیمت تکی — کارتن ÷ تعداد
                    consumerPrice: null,
                    filterPrice: singlePrice ?? item.price, // فیلتر بازار روی قیمت تکی مؤثر است
                    hasCheque: false,
                    chequeMinDays: null,
                    chequeMaxDays: null,
                    minQuantity: 1,
                    availableQuantity: null,
                    availableQuantityBucket: null,
                    city: catalog.city || '',
                    province: catalog.province || '',
                    countryCode: catalog.countryCode || 'IR',
                    provinceCode: catalog.provinceCode ?? null,
                    cityCode: catalog.cityCode ?? null,
                    locationDetail: '',
                    validityHours: 0, // ✅ لیست قیمت — بدون انقضا؛ فقط با آپدیت بعدی تازه می‌شود
                    expiresAt: null,
                    priceUpdatedAt: now,
                    isAnonymous: false,
                    publishToMarket: true,
                    ...(qty ? { unitQty: qty, unitBaseTitle: 'عدد' } : {}),
                    priceHistory: [{ price: item.price, updatedAt: now.toISOString(), note: 'ورود با لیست' }],
                    status: 'active',
                    source: 'import',
                    unitIsVariableQty: false,
                },
                select: { id: true, title: true },
            });
            createdAds.push(ad);
            catalogAdByKey.set(nameKey, ad.id); // تکرار داخل همان لیست هم رد شود

            if (item.unitTitle?.trim()) usedUnits.set(unit.id, { id: unit.id, containsQty: qty });
        }

        // ── واحدهای تازه‌استفاده‌شده → واحدهای بازوی فروش (config.units) ──
        if (usedUnits.size) {
            try {
                const cfg = (catalog.config as any) || {};
                const existing: any[] = Array.isArray(cfg.units) ? cfg.units : [];
                const existingIds = new Set(existing.map((u) => u?.unitId));
                const additions = Array.from(usedUnits.values())
                    .filter((u) => !existingIds.has(u.id))
                    .map((u) => ({ unitId: u.id, containsQty: u.containsQty ?? null, qtyIsFixed: false }));
                if (additions.length) {
                    const newConfig = { ...cfg, units: [...existing, ...additions] };
                    await this.prisma.catalog.update({
                        where: { id: catalog.id },
                        data: { config: newConfig as any, updatedAt: new Date() },
                    });
                }
            } catch (err: any) {
                this.logger.warn(`import config.units update failed: ${err?.message}`);
            }
        }

        // ── مهر خودکار روی همهٔ بازارهای منتشرِ این بازوی فروش ──
        if (createdAds.length) {
            const memberships = await this.prisma.armMembership.findMany({
                where: { catalogId: catalog.id, status: 'active', publishState: 'published' },
                select: { armId: true },
            });
            if (memberships.length) {
                const arms = await this.prisma.arm.findMany({
                    where: { id: { in: memberships.map((m) => m.armId) }, status: 'active' },
                    select: { id: true, categoryTree: true },
                });
                for (const arm of arms) {
                    try {
                        await this.catalogPublish.stampCatalogAds(arm, catalog.id, createdAds.map((a) => a.id), userId);
                    } catch (err: any) {
                        this.logger.warn(`import stampCatalogAds failed for arm ${arm.id}: ${err?.message}`);
                    }
                }
            }
            await this.cache.bust('prod-search').catch(() => undefined);
            await this.cache.bust(VITRINE_CACHE_PREFIX).catch(() => undefined);
        }

        return {
            created: createdAds.length,
            skipped: failed.length,
            failed,
            createdUnits,
            createdBrands,
            createdReferences,
            ads: createdAds,
        };
    }

    // ════════════════════════════════════════════════════════════
    // غنی‌سازی پیش‌نمایش — تکراری‌ها + مرجع + وضعیت واحد/برند
    // ════════════════════════════════════════════════════════════
    private async enrich(catalogId: string, rawRows: { name: string; price: number; valid: boolean; reason?: string; unitTitle?: string | null; unitQty?: number | null; brandTitle?: string | null }[]): Promise<ParsedImportRow[]> {
        const validRows = rawRows.filter((r) => r.valid);

        // تکراری‌های خود کاتالوگ — یک کوئری ساده، تطبیق در حافظه (برای هر تعداد ردیف درست است)
        const existingAds = await this.prisma.ad.findMany({
            where: { catalogId, status: { not: 'deleted' } },
            select: { id: true, productType: true, title: true },
            take: 3000,
        });
        const existingByName = new Map<string, string>();
        for (const ad of existingAds) {
            const key = normalizeItemName(ad.productType || ad.title || '');
            if (key && !existingByName.has(key)) existingByName.set(key, ad.id);
        }

        // پیشنهاد کالای مرجع — تطبیق دقیق عنوان نرمال‌شده
        const firstWords = Array.from(new Set(validRows.map((r) => r.name.split(' ')[0]).filter((w) => w.length >= 2))).slice(0, 150);
        const candidateRefs = firstWords.length
            ? await this.prisma.productReference.findMany({
                where: { isActive: true, OR: firstWords.map((n) => ({ title: { contains: n } })) },
                select: { id: true, title: true },
                take: 800,
            })
            : [];
        const refByNormalized = new Map<string, { id: string; title: string }>();
        for (const ref of candidateRefs) {
            const key = normalizeItemName(ref.title);
            if (key && !refByNormalized.has(key)) refByNormalized.set(key, ref);
        }

        // وضعیت واحد/برند در دیکشنری — «موجود است» یا «موقع ثبت ساخته می‌شود»
        const unitTitles = Array.from(new Set(validRows.map((r) => r.unitTitle?.trim()).filter(Boolean) as string[]));
        const brandTitles = Array.from(new Set(validRows.map((r) => r.brandTitle?.trim()).filter(Boolean) as string[]));
        const allUnits = await this.prisma.unit.findMany({ select: { id: true, title: true, shortCode: true, containsQty: true } });
        const unitByKey = new Map<string, { id: string; title: string; containsQty: number | null }>();
        for (const u of allUnits) {
            for (const k of [normalizeUnitTitle(u.title), normalizeUnitTitle(u.shortCode || '')]) {
                if (k && !unitByKey.has(k)) unitByKey.set(k, u);
            }
        }
        const allBrands = await this.prisma.brand.findMany({ select: { id: true, title: true }, take: 5000 });
        const brandByKey = new Map<string, { id: string; title: string }>();
        for (const b of allBrands) {
            const k = normalizeItemName(b.title);
            if (k && !brandByKey.has(k)) brandByKey.set(k, b);
        }
        const unitStatus = new Map<string, { resolved: boolean; containsQty: number | null }>();
        for (const t of unitTitles) {
            const hit = unitByKey.get(normalizeUnitTitle(t));
            unitStatus.set(t, { resolved: !!hit, containsQty: hit?.containsQty ?? null });
        }
        const brandStatus = new Map<string, boolean>();
        for (const t of brandTitles) brandStatus.set(t, brandByKey.has(normalizeItemName(t)));

        return rawRows.map((row) => {
            if (!row.valid) {
                return { ...row, referenceId: null, referenceTitle: null, unitTitle: row.unitTitle ?? null, unitResolved: null, unitContainsQty: null, unitQty: row.unitQty ?? null, brandTitle: row.brandTitle ?? null, brandResolved: null, warnings: [] };
            }
            const key = normalizeItemName(row.name);
            const unit = row.unitTitle?.trim() ? unitStatus.get(row.unitTitle.trim()) : undefined;
            const brand = row.brandTitle?.trim() ? brandStatus.get(row.brandTitle.trim()) : undefined;
            const warnings: string[] = [];
            if (row.price > 100 * 1000 * 1000 * 1000) warnings.push('قیمت خیلی بزرگ به نظر می‌رسد — مطمئنی تومان است؟');
            if (row.unitQty != null && row.unitQty > 10000) warnings.push('تعداد در واحد خیلی بزرگ است');
            const ref = refByNormalized.get(key) ?? null;
            return {
                ...row,
                duplicateOfAdId: existingByName.get(key),
                referenceId: ref?.id ?? null,
                referenceTitle: ref?.title ?? null,
                unitTitle: row.unitTitle ?? null,
                unitResolved: row.unitTitle?.trim() ? !!unit?.resolved : null,
                unitContainsQty: unit?.containsQty ?? null,
                unitQty: row.unitQty ?? null,
                brandTitle: row.brandTitle ?? null,
                brandResolved: row.brandTitle?.trim() ? !!brand : null,
                warnings,
            };
        });
    }

    private buildSummary(items: ParsedImportRow[]): ImportSummary {
        const s = emptySummary();
        s.total = items.length;
        for (const it of items) {
            if (it.valid) s.valid++;
            else s.invalid++;
            if (it.duplicateOfAdId) s.duplicates++;
            if (it.referenceId) s.withReference++;
            if (it.unitTitle) s.withUnit++;
            if (it.brandTitle) s.withBrand++;
            if (it.valid && it.unitTitle && it.unitResolved === false) s.newUnits++;
            if (it.valid && it.brandTitle && it.brandResolved === false) s.newBrands++;
        }
        return s;
    }

    // ════════════════════════════════════════════════════════════
    // حلّال‌های باهوش — دیکشنری دیمت هرگز تکراری نمی‌سازد
    // ════════════════════════════════════════════════════════════
    private async resolveUnit(
        rawTitle: string | undefined,
        unitByKey: Map<string, { id: string; title: string; containsQty: number | null }>,
        cache: Map<string, { id: string; title: string; containsQty: number | null }>,
        userId: string,
        createdUnits: string[],
        defaultUnit: { id: string; title: string; containsQty: number | null },
    ) {
        const title = normalizeForStore((rawTitle || '').trim());
        if (!title) return defaultUnit; // بدون واحد مشخص → واحد پیش‌فرض («عدد»)
        // ✅ واحدِ بی‌حرف (فقط عدد/علائم) معنی ندارد → پیش‌فرض
        if (!/[A-Za-z\u0600-\u06FF]/.test(title)) return defaultUnit;
        const key = normalizeUnitTitle(title);
        const cached = cache.get(key) ?? unitByKey.get(key);
        if (cached) return cached;

        // ساخت واحد جدید — همان قواعد ثبت دستی (بدون exception تکراری؛ مسابقهٔ همزمان با P2002 حل می‌شود)
        try {
            const created = await this.prisma.unit.create({
                data: { title, shortCode: title, scope: 'wholesale', createdByUserId: userId },
            });
            const u = { id: created.id, title: created.title, containsQty: created.containsQty ?? null };
            unitByKey.set(key, u);
            cache.set(key, u);
            createdUnits.push(created.title);
            await this.cache.bust('units').catch(() => undefined);
            return u;
        } catch (e: any) {
            if (e?.code !== 'P2002') throw e;
            const ex = await this.prisma.unit.findFirst({ where: { OR: [{ title }, { shortCode: title }] }, select: { id: true, title: true, containsQty: true } });
            if (ex) { unitByKey.set(key, ex); cache.set(key, ex); return ex; }
            throw e;
        }
    }

    private async resolveBrand(
        rawTitle: string,
        brandByKey: Map<string, { id: string; title: string }>,
        cache: Map<string, { id: string; title: string }>,
        userId: string,
        otherCategory: { id: string; name: string } | null,
        createdBrands: string[],
    ) {
        const title = normalizeForStore(rawTitle.trim());
        if (!title) return null;
        // ✅ برندِ بی‌حرف (فقط عدد/علائم مثل «12») ساخته نمی‌شود — صرف‌نظر
        if (!/[A-Za-z\u0600-\u06FF]/.test(title)) return null;
        const key = normalizeItemName(title);
        const cached = cache.get(key) ?? brandByKey.get(key);
        if (cached) return cached;

        // تطبیق فازی با عنوان‌های موجود — «m&m» و «ام اند ام» یکی نمی‌شوند ولی «m & m» می‌شوند
        const fuzzy = await findDuplicateTitle(this.prisma.brand, title).catch(() => null);
        if (fuzzy) {
            const b = { id: fuzzy.id, title: fuzzy.title };
            brandByKey.set(key, b);
            cache.set(key, b);
            return b;
        }

        // ساخت برند جدید — دستهٔ «سایر»، کاربرساخته، در انتظار تایید ادمین
        const slug = await this.uniqueSlug(title, 'brand');
        try {
            const created = await this.prisma.brand.create({
                data: {
                    title,
                    slug,
                    brandCategoryId: otherCategory?.id ?? null,
                    category: otherCategory?.name ?? null,
                    keywords: [title],
                    confirmed: false,
                    isByUser: true,
                    createdByUserId: userId,
                },
            });
            const b = { id: created.id, title: created.title };
            brandByKey.set(key, b);
            cache.set(key, b);
            createdBrands.push(created.title);
            await this.cache.bust('brand-search').catch(() => undefined);
            return b;
        } catch (e: any) {
            if (e?.code !== 'P2002') throw e;
            const ex = await this.prisma.brand.findFirst({ where: { title }, select: { id: true, title: true } });
            if (ex) { brandByKey.set(key, ex); cache.set(key, ex); return ex; }
            throw e;
        }
    }

    private async resolveReference(
        storeTitle: string,
        brandId: string | null,
        unitTitle: string | null,
        cache: Map<string, { id: string; title: string; brandId: string | null }>,
        userId: string,
        createdReferences: string[],
    ) {
        const key = normalizeItemName(storeTitle);
        if (!key) return null;
        const cached = cache.get(key);
        if (cached) return cached;

        const dup = await findDuplicateTitle(this.prisma.productReference, storeTitle).catch(() => null);
        if (dup) {
            const full = await this.prisma.productReference.findUnique({ where: { id: dup.id }, select: { id: true, title: true, brandId: true } });
            if (full) {
                cache.set(key, full);
                return full;
            }
        }

        const slug = await this.uniqueSlug(storeTitle, 'reference');
        const keywords = storeTitle.split(/\s+/).filter((w) => w.length >= 2);
        try {
            const created = await this.prisma.productReference.create({
                data: {
                    title: storeTitle,
                    slug,
                    keywords,
                    unitHints: unitTitle ? [unitTitle] : [],
                    brandId: brandId ?? null,
                    confirmed: false,
                    isByUser: true,
                    isNew: true,
                    createdByUserId: userId,
                },
            });
            const r = { id: created.id, title: created.title, brandId: created.brandId ?? null };
            cache.set(key, r);
            createdReferences.push(created.title);
            return r;
        } catch (e: any) {
            if (e?.code !== 'P2002') throw e;
            const ex = await this.prisma.productReference.findFirst({ where: { title: storeTitle }, select: { id: true, title: true, brandId: true } });
            if (ex) { cache.set(key, ex); return ex; }
            return null;
        }
    }

    private async uniqueSlug(title: string, kind: 'brand' | 'reference'): Promise<string> {
        const base = title
            .replace(/[\s\u200c]+/g, '-')
            .replace(/[^\p{L}\p{N}-]/gu, '')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .toLowerCase() || `${kind}-${Date.now() % 100000}`;
        let slug = base;
        let suffix = 1;
        if (kind === 'brand') {
            while (await this.prisma.brand.findUnique({ where: { slug }, select: { id: true } })) {
                slug = `${base}-${suffix++}`;
            }
        } else {
            while (await this.prisma.productReference.findUnique({ where: { slug }, select: { id: true } })) {
                slug = `${base}-${suffix++}`;
            }
        }
        return slug;
    }

    private async assertCatalogAccess(catalogId: string, userId: string) {
        const catalog = await this.prisma.catalog.findUnique({ where: { id: catalogId }, select: { id: true } });
        if (!catalog) {
            throw new BadRequestException({ errorCode: 'INVALID_CATALOG', message: 'بازوی فروش یافت نشد' });
        }
        await this.catalogAccess.assertCanManageCatalog(catalogId, userId, {
            errorCode: 'FORBIDDEN_CATALOG',
            message: 'شما به این بازوی فروش دسترسی ندارید',
        });
    }

    // ════════════════════════════════════════════════════════════
    // پارسرها — متن ساده | جداکننده‌دار (CSV) | اکسل | JSON هوش مصنوعی
    // ════════════════════════════════════════════════════════════

    private stripBom(s: string): string {
        return s && s.charCodeAt(0) === 0xFEFF ? s.slice(1) : (s || '');
    }

    /**
     * پارس متن لیست قیمت — ساده و شفاف:
     * هر خط = یک قلم؛ آخرین عددِ خط = قیمت؛ متن قبلش = نام کالا.
     * سرستون‌های معمول لیست‌ها خودکار حذف می‌شوند.
     */
    private parsePriceListText(rawText: string): { name: string; price: number; valid: boolean; reason?: string }[] {
        const lines = (rawText || '').split(/\r?\n/);
        const rows: { name: string; price: number; valid: boolean; reason?: string }[] = [];
        const seenNames = new Set<string>();

        for (const rawLine of lines) {
            const line = toLatinDigits(rawLine ?? '')
                // جداکنندهٔ هزارگان فارسی/عربی/لاتین بین ارقام
                .replace(/(?<=\d)[٬،,](?=\d{3}(\D|$))/g, '')
                .trim();
            if (!line) continue;
            // سرستون‌های معمول لیست قیمت
            if (/^(ردیف|کالا|محصول|شرح کالا|نام کالا|قیمت|قیمت(ها)?\s*\(?(تومان|ریال)?\)?|list|price|item|#)\s*$/i.test(line)) continue;

            const numberMatches = [...line.matchAll(/(\d+(?:[.,]\d+)*)/g)];
            if (numberMatches.length === 0) {
                rows.push({ name: line, price: 0, valid: false, reason: 'قیمتی در این خط پیدا نکردیم' });
                continue;
            }

            const lastMatch = numberMatches[numberMatches.length - 1];
            const price = Number(lastMatch[1].replace(/,/g, ''));
            let name = line.slice(0, lastMatch.index ?? line.length).trim();
            name = name.replace(/[=:\-–—ـ|*#,;]+$/, '').replace(/\s+/g, ' ').trim();

            if (!name || name.replace(/[^A-Za-z\u0600-\u06FF]/g, '').length < 2) {
                rows.push({ name: name || line, price, valid: false, reason: 'نام کالا واضح نیست' });
                continue;
            }
            if (!Number.isFinite(price) || price <= 0) {
                rows.push({ name, price: 0, valid: false, reason: 'قیمت معتبر نیست' });
                continue;
            }

            const key = normalizeItemName(name);
            if (seenNames.has(key)) {
                rows.push({ name, price, valid: false, reason: 'در همین لیست تکرار شده' });
                continue;
            }
            seenNames.add(key);
            rows.push({ name, price, valid: true });
        }
        return rows;
    }

    /** CSV/TSV — جداکننده‌ها به فاصله → همان پارس لیست متنی */
    private parseDelimitedText(rawText: string): { name: string; price: number; valid: boolean; reason?: string }[] {
        const text = this.stripBom(rawText || '')
            // جداکنندهٔ بین دو غیر-رقم → فاصله (عددها با , هزارگان نمی‌شکنند)
            .replace(/(?<=\D)[,;\t](?=\D)/g, ' ')
            .replace(/(?<=\d)[,;\t](?=\D)/g, ' ')
            .replace(/(?<=\D)[,;\t](?=\d)/g, ' ');
        return this.parsePriceListText(text);
    }

    /** تطبیق ستون‌های سرستون — دقیق اول، بعد پیشوندی («قیمت (تومان)» هم می‌گیرد) */
    private matchHeaderCols(cells: string[]): Record<string, number> {
        const result: Record<string, number> = { name: -1, price: -1, unit: -1, qty: -1, brand: -1 };
        const lists: Record<string, string[]> = { name: NAME_KEYS, price: PRICE_KEYS, unit: UNIT_KEYS, qty: QTY_KEYS, brand: BRAND_KEYS };
        const taken = new Set<number>();
        // گذر دقیق
        for (const [field, keys] of Object.entries(lists)) {
            for (let i = 0; i < cells.length; i++) {
                if (taken.has(i)) continue;
                if (cells[i] && keys.includes(cells[i])) { result[field] = i; taken.add(i); break; }
            }
        }
        // گذر پیشوندی — فقط ستون‌های نیافته (حداقل ۳ حرف تا عمومی‌ها نگیرند)
        for (const [field, keys] of Object.entries(lists)) {
            if (result[field] >= 0) continue;
            for (let i = 0; i < cells.length; i++) {
                if (taken.has(i)) continue;
                const c = cells[i];
                if (c && c.length >= 3 && keys.some((k) => c.startsWith(k) || k.startsWith(c))) {
                    result[field] = i; taken.add(i); break;
                }
            }
        }
        return result;
    }

    /** اکسل — سرستونِ هوشمند + ستون‌های کامل: نام/قیمت/واحد/تعداد/برند */
    private parseSheetToRows(sheet: XLSX.WorkSheet) {
        const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' });
        if (!matrix.length) return [];

        // یافتن سطر سرستون در ۵ سطر اول — باید «نام» و «قیمت» را بشناسد
        let headerRowIdx = -1;
        let colMap: Record<string, number> = {};
        for (let i = 0; i < Math.min(5, matrix.length); i++) {
            const cells = (matrix[i] || []).map((c) => normKey(String(c ?? '')));
            const map = this.matchHeaderCols(cells);
            if (map.name >= 0 && map.price >= 0) {
                headerRowIdx = i;
                colMap = map;
                break;
            }
        }

        const rows: { name: string; price: number; valid: boolean; reason?: string; unitTitle?: string | null; unitQty?: number | null; brandTitle?: string | null }[] = [];
        const seenNames = new Set<string>();
        const dataRows = headerRowIdx >= 0 ? matrix.slice(headerRowIdx + 1) : matrix;

        for (const cells of dataRows) {
            if (!cells || !cells.length) continue;
            const arr = cells as unknown[];

            let name: string;
            let priceRaw: unknown;
            let unitTitle: string | null = null;
            let qtyRaw: unknown;
            let brandTitle: string | null = null;

            if (headerRowIdx >= 0) {
                name = String(arr[colMap.name] ?? '').trim();
                priceRaw = arr[colMap.price];
                if (colMap.unit >= 0) unitTitle = String(arr[colMap.unit] ?? '').trim() || null;
                if (colMap.qty >= 0) qtyRaw = arr[colMap.qty];
                if (colMap.brand >= 0) brandTitle = String(arr[colMap.brand] ?? '').trim() || null;
            } else {
                // بدون سرستون — اولین سلول متنیِ غیرعددی = نام؛ آخرین عدد = قیمت
                const nums: { idx: number; v: number }[] = [];
                let nameCell = '';
                for (let i = 0; i < arr.length; i++) {
                    const cell = arr[i];
                    const n = looseNumber(cell);
                    if (n != null && n !== 0) { nums.push({ idx: i, v: n }); continue; }
                    const s = String(cell ?? '').trim();
                    if (s && !nameCell) nameCell = s;
                }
                name = nameCell || String(arr[0] ?? '').trim();
                priceRaw = nums.length ? nums[nums.length - 1].v : '';
            }

            const price = looseNumber(priceRaw);
            const unitQty = qtyRaw != null ? looseNumber(qtyRaw) : null;

            const cleanName = normalizeForStore(name);
            if (!cleanName) continue; // سطر خالی
            if (/^(ردیف|کالا|محصول|شرح کالا|نام کالا|قیمت|list|price|item|#)$/i.test(normKey(cleanName)) || normKey(cleanName) === 'نامکالا') continue;

            if (!price || price <= 0) {
                rows.push({ name: cleanName, price: 0, valid: false, reason: 'قیمت معتبر نیست', unitTitle, unitQty: null, brandTitle });
                continue;
            }
            const key = normalizeItemName(cleanName);
            if (seenNames.has(key)) {
                rows.push({ name: cleanName, price, valid: false, reason: 'در همین فایل تکرار شده', unitTitle, unitQty: null, brandTitle });
                continue;
            }
            seenNames.add(key);
            rows.push({
                name: cleanName,
                price,
                valid: true,
                unitTitle,
                unitQty: unitQty != null && unitQty >= 2 ? Math.floor(unitQty) : (unitQty != null && unitQty > 0 ? Math.floor(unitQty) : null),
                brandTitle,
            });
        }
        return rows;
    }

    /** JSON خروجی هوش مصنوعی — تحمل فنس ```json، کلیدهای مترادف، اعداد فارسی */
    private parseJsonItems(rawText: string): { name: string; price: number; valid: boolean; reason?: string; unitTitle?: string | null; unitQty?: number | null; brandTitle?: string | null }[] {
        let text = (rawText || '').trim();
        if (!text) return [];

        // فنس مارک‌داون را بردار
        const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fence) text = fence[1].trim();

        // اولین آرایهٔ براکت‌دار را پیدا کن (یا items/products از آبجکت)
        let jsonPart = text;
        const objMatch = text.match(/\{[\s\S]*\}/);
        if (objMatch) {
            try {
                const obj = JSON.parse(this.fixJson(objMatch[0]));
                const inner = obj.items || obj.products || obj.list || obj.data || obj.result;
                if (Array.isArray(inner)) jsonPart = JSON.stringify(inner);
            } catch { /* ادامه — براکت آرایه امتحان می‌شود */ }
        }
        const arrStart = jsonPart.indexOf('[');
        const arrEnd = jsonPart.lastIndexOf(']');
        if (arrStart < 0 || arrEnd <= arrStart) {
            throw new BadRequestException({ errorCode: 'IMPORT_BAD_JSON', message: 'خروجی هوش مصنوعی یک لیست JSON نبود — دوباره از پرامپت آماده استفاده کن' });
        }
        jsonPart = jsonPart.slice(arrStart, arrEnd + 1);

        let arr: unknown[];
        try {
            arr = JSON.parse(this.fixJson(jsonPart));
        } catch {
            throw new BadRequestException({ errorCode: 'IMPORT_BAD_JSON', message: 'JSON ناقص چسبانده شده — کل خروجی را کامل کپی کن' });
        }
        if (!Array.isArray(arr)) {
            throw new BadRequestException({ errorCode: 'IMPORT_BAD_JSON', message: 'خروجی هوش مصنوعی یک لیست نبود' });
        }

        const rows: { name: string; price: number; valid: boolean; reason?: string; unitTitle?: string | null; unitQty?: number | null; brandTitle?: string | null }[] = [];
        const seenNames = new Set<string>();

        for (const el of arr) {
            if (el == null || typeof el !== 'object' || Array.isArray(el)) continue;
            const obj = el as Record<string, unknown>;
            // کلیدها نرمال می‌شوند (نیم‌فاصله/زیرخط/فاصله) تا مترادف‌ها بگیرند
            const normObj: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(obj)) normObj[normKey(k)] = v;

            const name = normalizeForStore(String(pickKey(normObj, NAME_KEYS) ?? '').trim());
            const price = looseNumber(pickKey(normObj, PRICE_KEYS));
            const unitTitle = String(pickKey(normObj, UNIT_KEYS) ?? '').trim() || null;
            const qtyRaw = pickKey(normObj, QTY_KEYS);
            const unitQty = qtyRaw != null ? looseNumber(qtyRaw) : null;
            const brandTitle = String(pickKey(normObj, BRAND_KEYS) ?? '').trim() || null;

            if (!name) continue;
            if (!price || price <= 0) {
                rows.push({ name, price: 0, valid: false, reason: 'قیمت معتبر نیست', unitTitle, unitQty: null, brandTitle });
                continue;
            }
            const key = normalizeItemName(name);
            if (seenNames.has(key)) {
                rows.push({ name, price, valid: false, reason: 'در همین لیست تکرار شده', unitTitle, unitQty: null, brandTitle });
                continue;
            }
            seenNames.add(key);
            rows.push({
                name, price, valid: true, unitTitle,
                unitQty: unitQty != null && unitQty >= 2 ? Math.floor(unitQty) : null,
                brandTitle,
            });
        }
        return rows;
    }

    /** ترمیم‌های سبک JSON — ویرگولِ انتهایی، گیومهٔ هوشمند، اعداد فارسی */
    private fixJson(s: string): string {
        let out = toLatinDigits(s);
        out = out.replace(/[“”«»]/g, '"').replace(/[‘’]/g, "'");
        out = out.replace(/,\s*([}\]])/g, '$1');
        return out;
    }
}
