// src/common/services/catalog-publish.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { findCategoryPathInTree, findNodeInTree } from '../utils/arm.utils';
import { findNodeByRef } from '../utils/category-map.utils';

/**
 * موتور انتشار کاتالوگ در بازار.
 *
 * مدل داده (نهایی):
 *   Ad.catalogId           → کاتالوگ مالک (الزامی)
 *   Ad.catalogCategoryId   → گره در درختِ کاتالوگ (پایدار)
 *   Ad.categoryId/Path     → دسته روی تابلوی بازار (هنگام انتشار محاسبه می‌شود)
 *   Ad.armId               → مهر انتشار (null = فقط کاتالوگ)
 */
@Injectable()
export class CatalogPublishService {
    constructor(private prisma: PrismaService) {}

    async stampCatalogAds(
        arm: { id: string; categoryTree: any },
        catalogId: string,
        onlyAdIds?: string[],
    ): Promise<{
        stamped: number;
        needsCategory: { id: string; title: string; catalogCategoryTitle: string | null }[];
    }> {
        const marketTree = (arm.categoryTree as any[]) || [];

        // ✅ درختِ کاتالوگ — از خود کاتالوگ (نه از نهاد)
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
            select: { id: true, title: true, catalogCategoryId: true, categoryId: true },
        });

        const groups = new Map<string, { ids: string[]; path: string[] }>();
        const needsCategory: { id: string; title: string; catalogCategoryTitle: string | null }[] = [];

        const add = (key: string, id: string, path: string[]) => {
            const g = groups.get(key) ?? { ids: [], path };
            g.ids.push(id);
            groups.set(key, g);
        };

        for (const ad of ads) {
            if (!ad.catalogCategoryId) {
                if (ad.categoryId) add(`keep:${ad.categoryId}`, ad.id, []);
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

        for (const [key, g] of groups) {
            await this.prisma.ad.updateMany({
                where: { id: { in: g.ids } },
                data: {
                    armId: arm.id,
                    ...(key === '__none__'
                        ? { categoryId: null, categoryPath: [] }
                        : key.startsWith('keep:')
                            ? {}
                            : { categoryId: key, categoryPath: g.path }),
                },
            });
        }

        return { stamped: ads.length, needsCategory };
    }

    /** برداشتن مهر انتشار — آگهی فقط به «فقط-کاتالوگی» برمی‌گردد */
    async unstampCatalogAds(catalogId: string, armId: string): Promise<void> {
        await this.prisma.ad.updateMany({
            where: { catalogId, armId },
            data: { armId: null },
        });
    }
}