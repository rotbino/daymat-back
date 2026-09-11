// src/common/services/catalog-publish.service.ts
// ========================================================================
// موتور انتشار کاتالوگ در بازار — نسخه ۲ (با AdPublication)
// ========================================================================
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { findCategoryPathInTree, findNodeInTree } from '../utils/arm.utils';
import { findNodeByRef } from '../utils/category-map.utils';
import { CacheHelper, VITRINE_CACHE_PREFIX } from './cache.helper';

const logger = new Logger('CatalogPublishService');

@Injectable()
export class CatalogPublishService {
    constructor(
        private prisma: PrismaService,
        private cache: CacheHelper,
    ) {}

    /**
     * تابلوی بازار (ویترین) کش ۵ دقیقه‌ای دارد — بعد از هر تغییر وضعیت انتشار باید بشکند،
     * وگرنه مکث/حذف/برگشت کاتالوگ تا ۵ دقیقه در تابلو اعمال نمی‌شود
     * (باگ واقعی: مالک بازار عضویت را متوقف می‌کند ولی آگهی‌ها هنوز نمایش داده می‌شوند)
     */
    private async bustVitrineCache(): Promise<void> {
        await this.cache.bust(VITRINE_CACHE_PREFIX);
    }

    async stampCatalogAds(
        arm: { id: string; categoryTree: any },
        catalogId: string,
        onlyAdIds?: string[],
        publishedBy?: string,
        forceRepublish = false,
    ): Promise<{
        stamped: number;
        needsCategory: { id: string; title: string; catalogCategoryTitle: string | null }[];
    }> {
        const marketTree = (arm.categoryTree as any[]) || [];

        const catalog = await this.prisma.catalog.findUnique({
            where: { id: catalogId },
            select: { config: true },
        });
        const catalogTree = (((catalog?.config as any)?.categoryTree) as any[]) || [];

        const ads = await this.prisma.ad.findMany({
            where: {
                catalogId,
                status: 'active',
                publishToMarket: true,
                // ✅ expiresAt دیگر آگهی را از بازار حذف نمی‌کند (فقط یادآوری آپدیت قیمت است)
                ...(onlyAdIds?.length ? { id: { in: onlyAdIds } } : {}),
            },
            select: {
                id: true,
                title: true,
                catalogCategoryId: true,
                categoryId: true,
                categoryPath: true,
            },
        });

        if (ads.length === 0) {
            return { stamped: 0, needsCategory: [] };
        }

        // ✅ publicationهای موجود این کاتالوگ در این بازار — برای حفظ دستهٔ دستی و رد کردن optOut
        const existingPubs = await this.prisma.adPublication.findMany({
            where: { catalogId, armId: arm.id },
            select: { adId: true, categoryId: true, categoryPath: true, optOut: true },
        });
        const pubByAd = new Map(existingPubs.map((p) => [p.adId, p]));

        const groups = new Map<string, { ids: string[]; path: string[] }>();
        const needsCategory: { id: string; title: string; catalogCategoryTitle: string | null }[] = [];

        const add = (key: string, id: string, path: string[]) => {
            const g = groups.get(key) ?? { ids: [], path };
            g.ids.push(id);
            groups.set(key, g);
        };

        for (const ad of ads) {
            // ✅ انصراف صریح فروشنده از انتشار این آگهی در این بازار — مگر با publish صریح تک‌آگهی (forceRepublish)
            const existingPub = pubByAd.get(ad.id);
            if (existingPub?.optOut && !forceRepublish) continue;

            if (!ad.catalogCategoryId) {
                // ✅ دستهٔ دستیِ قبلی (از publication یا snapshot) حفظ می‌شود — گروه keep: که مقصدش خودِ دسته است
                const handCat = existingPub?.categoryId ?? ad.categoryId ?? null;
                if (handCat) add(`keep:${handCat}`, ad.id, existingPub?.categoryPath ?? ad.categoryPath ?? []);
                else add('__none__', ad.id, []);
                continue;
            }

            const catNode = findNodeInTree(catalogTree, ad.catalogCategoryId);
            const ref = catNode?.refCategoryId || ad.catalogCategoryId;
            const target = ref ? findNodeByRef(marketTree, ref) : null;

            if (target) {
                add(target.id, ad.id, findCategoryPathInTree(marketTree, target.id) || []);
            } else {
                needsCategory.push({
                    id: ad.id,
                    title: ad.title,
                    catalogCategoryTitle: catNode?.title ?? null,
                });
                // ✅ بدون تطابق درختی — دستهٔ دستیِ قبلی باقی می‌ماند
                const handCat = existingPub?.categoryId ?? ad.categoryId ?? null;
                if (handCat) add(`keep:${handCat}`, ad.id, existingPub?.categoryPath ?? ad.categoryPath ?? []);
                else add('__none__', ad.id, []);
            }
        }

        await this.prisma.$transaction(async (tx) => {
            // ✅ batched — بدون حلقهٔ per-ad (تراکنش ۵ ثانیه‌ای Prisma با دیتابیس راه‌دور timeout می‌شد)
            const toCreate = [];
            // گروه‌بندی بر اساس مقصد (categoryId + categoryPath) → هر گروه فقط یک updateMany
            const updateGroups = new Map();
            const addToUpdate = (adId, categoryId, categoryPath) => {
                const k = `${categoryId}|${(categoryPath || []).join('/')}`;
                const g = updateGroups.get(k) ?? { adIds: [], categoryId, categoryPath: categoryPath || [] };
                g.adIds.push(adId);
                updateGroups.set(k, g);
            };

            for (const [key, g] of groups) {
                const targetCategoryId =
                    key === '__none__' ? null :
                    key.startsWith('keep:') ? key.substring(5) :
                    key;

                const targetCategoryPath =
                    key === '__none__' ? [] :
                    g.path;

                // ✅ status همیشه published است — برگشت از paused/unpublished هم همین‌جا انجام می‌شود
                for (const adId of g.ids) {
                    if (pubByAd.has(adId)) addToUpdate(adId, targetCategoryId, targetCategoryPath);
                    else toCreate.push({
                        adId,
                        armId: arm.id,
                        catalogId,
                        categoryId: targetCategoryId,
                        categoryPath: targetCategoryPath,
                        status: 'published',
                        publishedBy,
                    });
                }
            }

            if (toCreate.length) {
                await tx.adPublication.createMany({ data: toCreate });
            }
            for (const g of updateGroups.values()) {
                await tx.adPublication.updateMany({
                    where: { adId: { in: g.adIds }, armId: arm.id },
                    data: {
                        catalogId,
                        categoryId: g.categoryId,
                        categoryPath: g.categoryPath,
                        status: 'published',
                        publishedBy,
                        unpublishedAt: null,
                        // ✅ publish صریح تک‌آگهی → انصراف قبلی (optOut) لغو می‌شود
                        ...(forceRepublish ? { optOut: false } : {}),
                        updatedAt: new Date(),
                    },
                });
            }

            // ✅ snapshot روی Ad (برای backward-compat) — گروهی، بدون حلقهٔ per-ad
            if (toCreate.length) {
                // آگهی‌های تازه‌ساخته — هر گروه مقصدِ خودش را داشت؛ بر اساس همان گروه می‌زنیم
                for (const [key, g] of groups) {
                    const targetCategoryId = key === '__none__' ? null : key.startsWith('keep:') ? key.substring(5) : key;
                    const targetCategoryPath = key === '__none__' ? [] : g.path;
                    const freshIds = g.ids.filter(id => !pubByAd.has(id));
                    if (freshIds.length) {
                        await tx.ad.updateMany({
                            where: { id: { in: freshIds }, OR: [{ armId: null }, { armId: arm.id }] },
                            data: { armId: arm.id, categoryId: targetCategoryId, categoryPath: targetCategoryPath },
                        });
                    }
                }
            }
            for (const g of updateGroups.values()) {
                await tx.ad.updateMany({
                    where: { id: { in: g.adIds }, OR: [{ armId: null }, { armId: arm.id }] },
                    data: { armId: arm.id, categoryId: g.categoryId, categoryPath: g.categoryPath },
                });
            }
        }, { timeout: 30_000, maxWait: 10_000 });

        logger.log(`Stamped ${ads.length} ads in arm ${arm.id} (needsCategory: ${needsCategory.length})`);
        await this.bustVitrineCache();

        return { stamped: ads.length, needsCategory };
    }

    async unstampCatalogAds(catalogId: string, armId: string): Promise<void> {
        // ✅ حذف نرم — رکوردها status=unpublished می‌شوند تا دسته‌بندی بازاریِ ست‌شده
        //    (دستی یا خودکار) برای برگشت بعدی حفظ شود؛ تابلو فقط status=published را نشان می‌دهد
        // ✅ batched — حلقهٔ per-ad داخل تراکنش با دیتابیس راه‌دور timeout می‌شد
        await this.prisma.$transaction(async (tx) => {
            const publications = await tx.adPublication.findMany({
                where: { catalogId, armId, status: { in: ['published', 'paused', 'needs_category'] } },
                select: { adId: true },
            });
            const adIds = publications.map((p) => p.adId);

            if (adIds.length === 0) return;

            await tx.adPublication.updateMany({
                where: { catalogId, armId },
                data: {
                    status: 'unpublished',
                    unpublishedAt: new Date(),
                    updatedAt: new Date(),
                },
            });

            // همهٔ publicationهای معتبر دیگرِ این آگهی‌ها — در یک کوئری
            const others = await tx.adPublication.findMany({
                where: { adId: { in: adIds }, armId: { not: armId }, status: 'published' },
                orderBy: { publishedAt: 'desc' },
                select: { adId: true, armId: true, categoryId: true, categoryPath: true },
            });
            const latestByAd = new Map();
            for (const o of others) {
                if (!latestByAd.has(o.adId)) latestByAd.set(o.adId, o);
            }

            const rewireGroups = new Map();
            const nullAds: string[] = [];
            for (const adId of adIds) {
                const other = latestByAd.get(adId);
                if (other) {
                    const k = `${other.armId}|${other.categoryId ?? ''}|${(other.categoryPath || []).join('/')}`;
                    const g = rewireGroups.get(k) ?? { adIds: [], armId: other.armId, categoryId: other.categoryId, categoryPath: other.categoryPath || [] };
                    g.adIds.push(adId);
                    rewireGroups.set(k, g);
                } else {
                    nullAds.push(adId);
                }
            }
            for (const g of rewireGroups.values()) {
                await tx.ad.updateMany({
                    where: { id: { in: g.adIds } },
                    data: { armId: g.armId, categoryId: g.categoryId, categoryPath: g.categoryPath },
                });
            }
            if (nullAds.length) {
                await tx.ad.updateMany({
                    where: { id: { in: nullAds } },
                    data: { armId: null, categoryId: null, categoryPath: [] },
                });
            }
        }, { timeout: 30_000, maxWait: 10_000 });

        logger.log(`Unstamped (soft) catalog ${catalogId} from arm ${armId}`);
        await this.bustVitrineCache();
    }

    /**
     * snapshot آگهی را به یک publication معتبر دیگر وصل می‌کند یا پاک می‌کند
     * (بعد از برداشتن مهر از یک بازار)
     */
    private async rewireAdSnapshot(tx: any, adId: string, removedArmId: string) {
        const otherPublication = await tx.adPublication.findFirst({
            where: {
                adId,
                armId: { not: removedArmId },
                status: 'published',
            },
            orderBy: { publishedAt: 'desc' },
        });

        if (otherPublication) {
            await tx.ad.update({
                where: { id: adId },
                data: {
                    armId: otherPublication.armId,
                    categoryId: otherPublication.categoryId,
                    categoryPath: otherPublication.categoryPath,
                },
            });
        } else {
            await tx.ad.update({
                where: { id: adId },
                data: {
                    armId: null,
                    categoryId: null,
                    categoryPath: [],
                },
            });
        }
    }

    /**
     * برداشتن مهرِ تک‌آگهی از یک بازار — برخلاف unstampCatalogAds فقط همان آگهی است
     * + optOut ثبت می‌شود تا re-stamp کلیِ کاتالوگ آن را دوباره منتشر نکند
     */
    async unpublishAdFromArm(adId: string, armId: string): Promise<void> {
        await this.prisma.$transaction(async (tx) => {
            await tx.adPublication.updateMany({
                where: { adId, armId },
                data: {
                    status: 'unpublished',
                    optOut: true,
                    unpublishedAt: new Date(),
                    updatedAt: new Date(),
                },
            });
            await this.rewireAdSnapshot(tx, adId, armId);
        }, { timeout: 15_000, maxWait: 5_000 });
        logger.log(`Unpublished ad ${adId} from arm ${armId} (optOut)`);
        await this.bustVitrineCache();
    }

    /**
     * تغییر وضعیت همهٔ publicationهای یک کاتالوگ در یک بازار — برای مکث/فعال‌سازی عضویت
     * (دسته‌بندی‌ها و optOut حفظ می‌شوند)
     */
    async setPublicationsStatus(catalogId: string, armId: string, status: 'paused' | 'published'): Promise<void> {
        await this.prisma.adPublication.updateMany({
            where: { catalogId, armId, optOut: false, status: { in: ['published', 'paused'] } },
            data: {
                status,
                ...(status === 'paused' ? { unpublishedAt: new Date() } : { unpublishedAt: null }),
                updatedAt: new Date(),
            },
        });
        logger.log(`Publications of catalog ${catalogId} in arm ${armId} → ${status}`);
        await this.bustVitrineCache();
    }

    async pausePublication(adId: string, armId: string): Promise<void> {
        await this.prisma.adPublication.updateMany({
            where: { adId, armId },
            data: {
                status: 'paused',
                unpublishedAt: new Date(),
                updatedAt: new Date(),
            },
        });
        await this.bustVitrineCache();
    }

    async resumePublication(adId: string, armId: string): Promise<void> {
        await this.prisma.adPublication.updateMany({
            where: { adId, armId },
            data: {
                status: 'published',
                unpublishedAt: null,
                updatedAt: new Date(),
            },
        });
        await this.bustVitrineCache();
    }

    async getAdPublications(adId: string) {
        return this.prisma.adPublication.findMany({
            where: { adId },
            include: {
                arm: {
                    select: {
                        id: true,
                        slug: true,
                        name: true,
                        icon: true,
                        colorPrimary: true,
                    },
                },
            },
            orderBy: { publishedAt: 'desc' },
        });
    }

    async getCatalogPublications(catalogId: string) {
        return this.prisma.adPublication.findMany({
            where: { catalogId, status: { in: ['published', 'needs_category'] } },
            include: {
                arm: {
                    select: {
                        id: true,
                        slug: true,
                        name: true,
                        icon: true,
                        colorPrimary: true,
                    },
                },
            },
            orderBy: { publishedAt: 'desc' },
        });
    }

    async getPublicationCount(adId: string): Promise<number> {
        return this.prisma.adPublication.count({
            where: {
                adId,
                status: { in: ['published', 'needs_category'] },
            },
        });
    }
}
