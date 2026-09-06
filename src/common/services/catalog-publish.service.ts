// src/common/services/catalog-publish.service.ts
// ========================================================================
// موتور انتشار کاتالوگ در بازار — نسخه ۲ (با AdPublication)
// ========================================================================
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { findCategoryPathInTree, findNodeInTree } from '../utils/arm.utils';
import { findNodeByRef } from '../utils/category-map.utils';

const logger = new Logger('CatalogPublishService');

@Injectable()
export class CatalogPublishService {
    constructor(private prisma: PrismaService) {}

    async stampCatalogAds(
        arm: { id: string; categoryTree: any },
        catalogId: string,
        onlyAdIds?: string[],
        publishedBy?: string,
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
                expiresAt: { gt: new Date() },
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

        const groups = new Map<string, { ids: string[]; path: string[] }>();
        const needsCategory: { id: string; title: string; catalogCategoryTitle: string | null }[] = [];

        const add = (key: string, id: string, path: string[]) => {
            const g = groups.get(key) ?? { ids: [], path };
            g.ids.push(id);
            groups.set(key, g);
        };

        for (const ad of ads) {
            if (!ad.catalogCategoryId) {
                if (ad.categoryId) add(`keep:${ad.categoryId}`, ad.id, ad.categoryPath || []);
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
                add('__none__', ad.id, []);
            }
        }

        await this.prisma.$transaction(async (tx) => {
            for (const [key, g] of groups) {
                const targetCategoryId =
                    key === '__none__' ? null :
                    key.startsWith('keep:') ? key.substring(5) :
                    key;

                const targetCategoryPath =
                    key === '__none__' ? [] :
                    key.startsWith('keep:') ? g.path :
                    g.path;

                const status =
                    targetCategoryId === null ? 'needs_category' : 'published';

                for (const adId of g.ids) {
                    await tx.adPublication.upsert({
                        where: { adId_armId: { adId, armId: arm.id } },
                        create: {
                            adId,
                            armId: arm.id,
                            catalogId,
                            categoryId: targetCategoryId,
                            categoryPath: targetCategoryPath,
                            status,
                            publishedBy,
                        },
                        update: {
                            catalogId,
                            categoryId: targetCategoryId,
                            categoryPath: targetCategoryPath,
                            status,
                            publishedBy,
                            unpublishedAt: null,
                            updatedAt: new Date(),
                        },
                    });

                    // ✅ snapshot روی Ad هم آپدیت کن (برای backward-compat)
                    await tx.ad.updateMany({
                        where: {
                            id: adId,
                            OR: [
                                { armId: null },
                                { armId: arm.id },
                            ],
                        },
                        data: {
                            armId: arm.id,
                            categoryId: targetCategoryId,
                            categoryPath: targetCategoryPath,
                        },
                    });
                }
            }
        });

        logger.log(`Stamped ${ads.length} ads in arm ${arm.id} (needsCategory: ${needsCategory.length})`);

        return { stamped: ads.length, needsCategory };
    }

    async unstampCatalogAds(catalogId: string, armId: string): Promise<void> {
        await this.prisma.$transaction(async (tx) => {
            const publications = await tx.adPublication.findMany({
                where: { catalogId, armId },
                select: { adId: true },
            });
            const adIds = publications.map(p => p.adId);

            if (adIds.length === 0) return;

            await tx.adPublication.deleteMany({
                where: { catalogId, armId },
            });

            for (const adId of adIds) {
                const otherPublications = await tx.adPublication.findFirst({
                    where: {
                        adId,
                        armId: { not: armId },
                        status: { in: ['published', 'needs_category'] },
                    },
                    orderBy: { publishedAt: 'desc' },
                });

                if (otherPublications) {
                    await tx.ad.update({
                        where: { id: adId },
                        data: {
                            armId: otherPublications.armId,
                            categoryId: otherPublications.categoryId,
                            categoryPath: otherPublications.categoryPath,
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
        });

        logger.log(`Unstamped catalog ${catalogId} from arm ${armId}`);
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
