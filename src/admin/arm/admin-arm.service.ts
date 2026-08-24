// src/admin/arm/admin-arm.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminArmService {
    constructor(private prisma: PrismaService) {}

    // ============================================================
    // دریافت لیست بازارها با فیلتر و صفحه‌بندی
    // ============================================================
    async getArmsList(query: any) {
        const { page = 1, limit = 20, status, search } = query;
        const skip = (page - 1) * limit;

        const where: any = {};
        if (status) where.status = status;
        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { slug: { contains: search, mode: 'insensitive' } },
            ];
        }

        const [items, total] = await Promise.all([
            this.prisma.arm.findMany({
                where,
                skip,
                take: Number(limit),
                include: {
                    owner: {
                        select: {
                            id: true,
                            fullName: true,
                            phone: true,
                        },
                    },
                    _count: {
                        select: {
                            memberships: { where: { status: 'active' } },
                            ads: { where: { status: 'active' } },
                        },
                    },
                },
                orderBy: { createdAt: 'desc' },
            }),
            this.prisma.arm.count({ where }),
        ]);

        const result = items.map((arm) => {
            const config = arm.config as any || {};
            const categoryTree = arm.categoryTree as any[] || [];

            // ✅ شمارش برگ‌ها در categoryTree
            const countLeaves = (nodes: any[]): number => {
                let count = 0;
                for (const node of nodes) {
                    if (node.isLeaf) {
                        count++;
                    }
                    if (node.children) {
                        count += countLeaves(node.children);
                    }
                }
                return count;
            };

            return {
                ...arm,
                configSummary: {
                    currency: config.economy?.currency || 'IRR',
                    bumpCost: config.economy?.bumpCost || 10,
                    maxTotalFreeAdPerUser: config.features?.maxTotalFreeAdPerUser || 5,
                    categoryCount: countLeaves(categoryTree),
                    locationCount: config.locationSelections?.length || 0,
                    supplierCount: config.supplierActivityIds?.length || 0,
                    buyerCount: config.buyerActivityIds?.length || 0,
                },
            };
        });

        return {
            items: result,
            pagination: {
                page: Number(page),
                limit: Number(limit),
                total,
                totalPages: Math.ceil(total / Number(limit)),
            },
        };
    }

    // ============================================================
    // دریافت یک بازار با id
    // ============================================================
    // در admin-arm.service.ts
    async getArmById(id: string) {
        const arm = await this.prisma.arm.findUnique({
            where: { id },
            include: {
                owner: {
                    select: { id: true, fullName: true, phone: true },
                },
                _count: {
                    select: {
                        memberships: { where: { status: 'active' } },
                        ads: { where: { status: 'active' } },
                    },
                },
            },
        });

        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازار یافت نشد',
            });
        }

        const config = arm.config as any || {};

        // ✅ categoryTree مستقیم از فیلد سطح بالا
        const categoryTree = arm.categoryTree || [];

        // ✅ allowedCategoryScopeTree - اول از فیلد سطح بالا، بعد از داخل config
        const allowedCategoryScopeTree = arm.allowedCategoryScopeTree ||
            config.allowedCategoryScopeTree || [];

        // ✅ مهاجرت خودکار داده
        if (!arm.allowedCategoryScopeTree && config.allowedCategoryScopeTree) {
            await this.prisma.arm.update({
                where: { id: arm.id },
                data: {
                    allowedCategoryScopeTree: config.allowedCategoryScopeTree,
                },
            }).catch(() => {});
        }

        // ✅ locationTree از config
        const locationSelections = (config.locationSelections || []).filter((s: any) => s.isActive);
        const locationIds = locationSelections.map((s: any) => s.locationId);

        let locationTree: any[] = [];

        if (locationIds.length > 0) {
            const locations = await this.prisma.location.findMany({
                where: { id: { in: locationIds }, isActive: true },
                select: {
                    id: true, title: true, cityCode: true, provinceCode: true,
                    parentId: true, level: true, path: true, type: true
                },
            });

            const parentIds = [...new Set(locations.map(l => l.parentId).filter(Boolean))];
            const parents = parentIds.length > 0
                ? await this.prisma.location.findMany({
                    where: { id: { in: parentIds as string[] } },
                    select: {
                        id: true, title: true, provinceCode: true, level: true, path: true, type: true
                    },
                })
                : [];

            const allLocations = [...parents, ...locations].map(loc => {
                const selection = locationSelections.find((s: any) => s.locationId === loc.id);
                return {
                    ...loc,
                    isSelected: true,
                    customLabel: selection?.customLabel || null
                };
            });

            locationTree = this.buildTree(allLocations);
        }

        // ✅ پاک‌سازی config از فیلدهای منتقل شده
        const {
            allowedCategoryScopeTree: _removedFromConfig,
            categorySelections: _removedCategorySelections,
            _cachedCategoryTree: _removedCachedTree,
            _treeUpdatedAt: _removedTreeUpdatedAt,
            ...cleanConfig
        } = config;

        return {
            ...arm,
            config: cleanConfig,
            locationTree,
            categoryTree,
            allowedCategoryScopeTree,
        };
    }

    // ============================================================
    // به‌روزرسانی بازار
    // ============================================================
    async updateArm(id: string, data: any) {
        await this.prisma.arm.findUniqueOrThrow({ where: { id } });

        const allowedFields = [
            'slug', 'name', 'shortName', 'slogan', 'description', 'icon',
            'colorPrimary', 'colorSecondary', 'logoUrl', 'bannerUrl', 'mission',
            'status', 'visibility', 'geoScopeType', 'defaultUnitId',
            'featuresEnabled', 'rankingAlgorithm', 'metadata', 'config',
            'categoryTree',
            'allowedCategoryScopeTree',
        ];

        const updateData: any = {};
        for (const key of allowedFields) {
            if (data[key] !== undefined) updateData[key] = data[key];
        }

        // ✅ اگه categoryTree ارسال شده، مستقیم ذخیره کن
        if (data.categoryTree !== undefined) {
            updateData.categoryTree = data.categoryTree;
        }

        // ✅ پردازش config (بدون categorySelections و _cachedCategoryTree)
        if (data.config) {
            const config = { ...data.config };

            // ✅ حذف categorySelections و _cachedCategoryTree از config
            delete config.categorySelections;
            delete config._cachedCategoryTree;
            delete config._treeUpdatedAt;

            // ✅ locationTree فقط اگه locationSelections تغییر کرده
            const oldArm = await this.prisma.arm.findUnique({
                where: { id },
                select: { config: true },
            });
            const oldConfig = (oldArm?.config as any) || {};

            const oldLocationSelections = oldConfig.locationSelections || [];
            const newLocationSelections = config.locationSelections || [];
            const locationSelectionsChanged = JSON.stringify(oldLocationSelections) !== JSON.stringify(newLocationSelections);

            if (locationSelectionsChanged && config.locationSelections) {
                const locationTree = await this.buildLocationTreeFromConfig(config);
                config._cachedLocationTree = locationTree;
            }

            updateData.config = config;
        }

        if (updateData.config?.features?.adValidityDefaultDays) {
            updateData.config.features.adValidityDefaultDays = Number(updateData.config.features.adValidityDefaultDays);
        }
        if (updateData.config?.economy?.bumpCost) {
            updateData.config.economy.bumpCost = Number(updateData.config.economy.bumpCost);
        }

        return this.prisma.arm.update({ where: { id }, data: updateData });
    }

    // ============================================================
    // حذف نرم بازار
    // ============================================================
    async deleteArm(id: string) {
        await this.prisma.arm.findUniqueOrThrow({ where: { id } });
        return this.prisma.arm.update({ where: { id }, data: { status: 'archived' } });
    }

    // ============================================================
    // آمار کلی بازارها
    // ============================================================
    async getStats() {
        const [totalArms, activeArms, totalMembers, totalAds] = await Promise.all([
            this.prisma.arm.count(),
            this.prisma.arm.count({ where: { status: 'active' } }),
            this.prisma.armMembership.count({ where: { status: 'active' } }),
            this.prisma.ad.count({ where: { status: 'active' } }),
        ]);

        const armsWithConfig = await this.prisma.arm.findMany({ select: { config: true } });

        let totalBumpCost = 0;
        let totalFreeQuota = 0;

        for (const arm of armsWithConfig) {
            const config = arm.config as any || {};
            totalBumpCost += config.economy?.bumpCost || 10;
            totalFreeQuota += config.features?.maxTotalFreeAdPerUser || 5;
        }

        return {
            totalArms, activeArms, totalMembers, totalAds,
            avgBumpCost: armsWithConfig.length > 0 ? totalBumpCost / armsWithConfig.length : 0,
            avgFreeQuota: armsWithConfig.length > 0 ? totalFreeQuota / armsWithConfig.length : 0,
        };
    }

    // ============================================================
    // buildTree
    // ============================================================
    private buildTree(items: any[]): any[] {
        const map = new Map();
        const roots: any[] = [];

        for (const item of items) {
            map.set(item.id, { ...item, children: [] });
        }

        for (const [id, node] of map) {
            if (node.parentId && map.has(node.parentId)) {
                map.get(node.parentId).children.push(node);
            } else {
                roots.push(node);
            }
        }

        return roots;
    }

    // ============================================================
    // آمار داشبورد
    // ============================================================
    async getDashboardStats() {
        const [totalUsers, activeUsers, totalArms, activeArms, totalAds, pendingAds, totalBusinesses, pendingMemberships, pendingVerifications, totalCredits] = await Promise.all([
            this.prisma.user.count(),
            this.prisma.user.count({ where: { status: 'active' } }),
            this.prisma.arm.count(),
            this.prisma.arm.count({ where: { status: 'active' } }),
            this.prisma.ad.count({ where: { status: { not: 'deleted' } } }),
            this.prisma.ad.count({ where: { status: 'pending' } }),
            this.prisma.business.count(),
            this.prisma.armMembership.count({ where: { status: 'pending' } }),
            this.prisma.verification.count({ where: { status: 'pending' } }),
            this.prisma.credit.count({ where: { status: 'success' } }),
        ]);

        return {
            totalUsers,
            activeUsers,
            totalArms,
            activeArms,
            totalAds,
            pendingAds,
            totalBusinesses,
            pendingMemberships,
            pendingVerifications,
            totalCredits,
        };
    }

    // ============================================================
    // ساخت درخت موقعیت‌ها از config
    // ============================================================
    private async buildLocationTreeFromConfig(config: any): Promise<any[]> {
        const locationSelections = (config.locationSelections || []).filter((s: any) => s.isActive !== false);
        const locationIds = locationSelections.map((s: any) => s.locationId);

        if (locationIds.length === 0) return [];

        const locations = await this.prisma.location.findMany({
            where: { id: { in: locationIds }, isActive: true },
            select: { id: true, title: true, cityCode: true, provinceCode: true, parentId: true, level: true, path: true, type: true },
        });

        const parentIds = [...new Set(locations.map(l => l.parentId).filter(Boolean))];
        const parents = parentIds.length > 0
            ? await this.prisma.location.findMany({
                where: { id: { in: parentIds as string[] } },
                select: { id: true, title: true, provinceCode: true, level: true, path: true, type: true },
            })
            : [];

        const allLocations = [...parents, ...locations].map(loc => {
            const selection = locationSelections.find((s: any) => s.locationId === loc.id);
            return { ...loc, isSelected: true, customLabel: selection?.customLabel || null };
        });

        return this.buildTree(allLocations);
    }
}