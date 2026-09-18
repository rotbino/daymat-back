// src/ad/ad-import.service.ts
// 📥 ایمپورت گروهی لیست قیمت — «به‌جای قلم‌به‌قلم، لیستت را بچسبان»
//    فاز ۱ (parse): متن خام → ردیف‌های خوانا + هشدارهای ساده فارسی
//    فاز ۲ (commit): ساخت آگهی‌ها بدون انقضا + کالای مرجعِ خودکار + مهر روی بازارهای عضو
//    قاعدهٔ پارس برای کاربر بازار: هر خط یک قلم؛ آخرین عددِ خط = قیمت؛ متن قبلش = نام کالا.
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogAccessService } from '../common/services/catalog-access.service';
import { CatalogPublishService } from '../common/services/catalog-publish.service';
import { CacheHelper, VITRINE_CACHE_PREFIX } from '../common/services/cache.helper';
import { normalizeForStore, findDuplicateTitle } from '../common/persian-text.util';
import { ImportParseDto, ImportCommitDto } from './ad.dto';

/** تبدیل ارقام فارسی/عربی به لاتین */
const FA_DIGITS: Record<string, string> = {
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

const toLatinDigits = (s: string) => s.replace(/[۰-۹٠-٩]/g, (d) => FA_DIGITS[d] ?? d);

/** نرمال‌سازی نام کالا برای مقایسه */
const normalizeItemName = (s: string): string =>
    normalizeForStore(toLatinDigits(s ?? '')).trim().toLowerCase();

/** حداکثر ردیف در هر ایمپورت — برای جلوگیری از درخواست‌های غول‌پیکر */
const MAX_IMPORT_ROWS = 300;

export interface ParsedImportRow {
    name: string;
    price: number;
    valid: boolean;
    reason?: string;
    duplicateOfAdId?: string;
    referenceId?: string | null;
    referenceTitle?: string | null;
}

@Injectable()
export class AdImportService {
    private readonly logger = new Logger(AdImportService.name);

    constructor(
        private prisma: PrismaService,
        private catalogAccess: CatalogAccessService,
        private catalogPublish: CatalogPublishService,
        private cache: CacheHelper,
    ) {}

    /** پارس متن + غنی‌سازی: تکراری‌های کاتالوگ + پیشنهاد کالای مرجع */
    async parse(userId: string, dto: ImportParseDto) {
        await this.assertCatalogAccess(dto.catalogId, userId);

        const rawRows = this.parsePriceListText(dto.text);
        if (!rawRows.length) {
            throw new BadRequestException({ errorCode: 'IMPORT_EMPTY', message: 'چیزی برای خواندن پیدا نکردیم — چند خط لیستت را بچسبان' });
        }

        const validRows = rawRows.filter((r) => r.valid);
        if (validRows.length > MAX_IMPORT_ROWS) {
            throw new BadRequestException({ errorCode: 'IMPORT_TOO_MANY', message: `هر بار حداکثر ${MAX_IMPORT_ROWS} قلم — لیستت را چند قسمتی بفرست` });
        }

        // ── تکراری‌های خود کاتالوگ: کالایی که همین الان با همین نام داری ──
        const names = validRows.map((r) => r.name);
        const existingAds = await this.prisma.ad.findMany({
            where: {
                catalogId: dto.catalogId,
                status: { not: 'deleted' },
                OR: names.map((n) => ({ productType: { contains: n } })),
            },
            select: { id: true, productType: true, title: true },
            take: 500,
        });
        const existingByName = new Map<string, string>();
        for (const ad of existingAds) {
            const key = normalizeItemName(ad.productType || ad.title || '');
            if (key && !existingByName.has(key)) existingByName.set(key, ad.id);
        }

        // ── پیشنهاد کالای مرجع: تطبیق دقیق عنوان (نرمال‌شده) ──
        const normalizedNames = Array.from(new Set(validRows.map((r) => normalizeItemName(r.name)).filter(Boolean)));
        // Prisma+MongoDB: اپراتور خام $in/in روی title کافی است؛ نرمال‌سازی را در JS انجام می‌دهیم
        const candidateRefs = await this.prisma.productReference.findMany({
            where: { isActive: true, OR: names.map((n) => ({ title: { contains: n.split(' ')[0] } })) },
            select: { id: true, title: true },
            take: 400,
        });
        const refByNormalized = new Map<string, { id: string; title: string }>();
        for (const ref of candidateRefs) {
            const key = normalizeItemName(ref.title);
            if (key && !refByNormalized.has(key)) refByNormalized.set(key, ref);
        }

        const items: ParsedImportRow[] = rawRows.map((row) => {
            if (!row.valid) return { ...row, referenceId: null, referenceTitle: null };
            const key = normalizeItemName(row.name);
            const dupAdId = existingByName.get(key);
            const ref = refByNormalized.get(key) ?? null;
            return {
                ...row,
                duplicateOfAdId: dupAdId,
                referenceId: ref?.id ?? null,
                referenceTitle: ref?.title ?? null,
            };
        });

        return {
            items,
            summary: {
                total: items.length,
                valid: items.filter((i) => i.valid).length,
                invalid: items.filter((i) => !i.valid).length,
                duplicates: items.filter((i) => i.duplicateOfAdId).length,
                withReference: items.filter((i) => i.referenceId).length,
            },
        };
    }

    /** ساخت واقعی آگهی‌ها — فقط ردیف‌های تاییدشدهٔ کاربر از پیش‌نمایش */
    async commit(userId: string, dto: ImportCommitDto) {
        await this.assertCatalogAccess(dto.catalogId, userId);

        const items = (dto.items || []).filter((it) => it.name?.trim() && Number.isFinite(it.price) && it.price > 0);
        if (!items.length) {
            throw new BadRequestException({ errorCode: 'IMPORT_EMPTY', message: 'هیچ ردیف معتبری برای ثبت نیست' });
        }
        if (items.length > MAX_IMPORT_ROWS) {
            throw new BadRequestException({ errorCode: 'IMPORT_TOO_MANY', message: `هر بار حداکثر ${MAX_IMPORT_ROWS} قلم` });
        }

        const catalog = await this.prisma.catalog.findUnique({
            where: { id: dto.catalogId },
            select: { id: true, name: true, city: true, province: true, countryCode: true, provinceCode: true, cityCode: true },
        });
        if (!catalog) throw new BadRequestException({ errorCode: 'INVALID_CATALOG', message: 'بازوی فروش یافت نشد' });

        // ── واحد مشترک — پیش‌فرض «عدد» ──
        let unit = dto.unitId
            ? await this.prisma.unit.findUnique({ where: { id: dto.unitId } })
            : null;
        if (!unit) {
            unit = await this.prisma.unit.findFirst({ where: { isDefault: true } })
                ?? await this.prisma.unit.findFirst({ where: { title: 'عدد' } })
                ?? await this.prisma.unit.findFirst();
        }
        if (!unit) {
            throw new BadRequestException({ errorCode: 'UNIT_NOT_FOUND', message: 'واحدی برای ثبت قیمت پیدا نشد' });
        }

        // ── کالای مرجع: از پیشنهادِ کاربر یا ساخت/یافتن خودکار ──
        const requestedRefIds = items.map((it) => it.referenceId).filter((v): v is string => !!v);
        const validRefs = requestedRefIds.length
            ? await this.prisma.productReference.findMany({ where: { id: { in: requestedRefIds } }, select: { id: true, title: true, brandId: true } })
            : [];
        const validRefById = new Map(validRefs.map((r) => [r.id, r]));

        const createdAds: { id: string; title: string }[] = [];
        const now = new Date();

        for (const item of items) {
            const storeTitle = normalizeForStore(item.name);
            if (!storeTitle) continue;

            // مرجع: انتخاب کاربر > تطبیق دقیق موجود > ساخت جدید (تاییدنشده، طبق قانون دیمت)
            let reference = item.referenceId ? validRefById.get(item.referenceId) ?? null : null;
            if (!reference) {
                const dup = await findDuplicateTitle(this.prisma.productReference, storeTitle);
                if (dup) {
                    reference = await this.prisma.productReference.findUnique({ where: { id: dup.id }, select: { id: true, title: true, brandId: true } });
                }
            }
            if (!reference) {
                reference = await this.ensureReference(storeTitle, userId);
            }

            // جلوگیری از ردیف تکراری داخل یک دستهٔ ارسالی
            const alreadyAd = await this.prisma.ad.findFirst({
                where: { catalogId: catalog.id, productType: storeTitle, status: { not: 'deleted' } },
                select: { id: true },
            });
            if (alreadyAd) continue;

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
                    brandId: reference?.brandId ?? null,
                    paymentMethods: null,
                    customFields: {},
                    description: '',
                    unitPrice: item.price,
                    singleUnitPrice: null,
                    consumerPrice: null,
                    filterPrice: item.price,
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
                    priceHistory: [{ price: item.price, updatedAt: now.toISOString(), note: 'ورود با لیست' }],
                    status: 'active',
                    source: 'import',
                    unitQty: null,
                    unitIsVariableQty: false,
                },
                select: { id: true, title: true },
            });
            createdAds.push(ad);
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
                    } catch (err) {
                        this.logger.warn(`import stampCatalogAds failed for arm ${arm.id}: ${err?.message}`);
                    }
                }
            }
            await this.cache.bust('prod-search').catch(() => undefined);
            await this.cache.bust(VITRINE_CACHE_PREFIX).catch(() => undefined);
        }

        return {
            created: createdAds.length,
            skipped: items.length - createdAds.length,
            ads: createdAds,
        };
    }

    /** کالای مرجع تازه — اسلاگ یکتا + flags قانون دیمت (کاربرساخته، در انتظار تایید ادمین) */
    private async ensureReference(storeTitle: string, userId: string) {
        let slug = this.slugify(storeTitle);
        let suffix = 1;
        while (await this.prisma.productReference.findUnique({ where: { slug }, select: { id: true } })) {
            slug = `${this.slugify(storeTitle)}-${suffix++}`;
        }
        const keywords = storeTitle.split(/\s+/).filter((w) => w.length >= 2);
        return this.prisma.productReference.create({
            data: {
                title: storeTitle,
                slug,
                keywords,
                confirmed: false,
                isByUser: true,
                isNew: true,
                createdByUserId: userId,
            },
            select: { id: true, title: true, brandId: true },
        }).catch(async (e: any) => {
            if (e?.code !== 'P2002') throw e;
            const ex = await this.prisma.productReference.findFirst({ where: { title: storeTitle }, select: { id: true, title: true, brandId: true } });
            return ex;
        });
    }

    private slugify(title: string): string {
        const base = title
            .replace(/[\s\u200c]+/g, '-')
            .replace(/[^\p{L}\p{N}-]/gu, '')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .toLowerCase();
        return base || `ref-${Date.now() % 100000}`;
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
            name = name.replace(/[=:\-–—ـ|*#]+$/, '').replace(/\s+/g, ' ').trim();

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
}
