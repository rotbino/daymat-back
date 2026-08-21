// src/admin/arm/admin-arm.service.ts
import {BadRequestException, Injectable, NotFoundException} from '@nestjs/common';
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
            return {
                ...arm,
                configSummary: {
                    currency: config.economy?.currency || 'IRR',
                    bumpCost: config.economy?.bumpCost || 10,
                    maxTotalFreeAdPerUser: config.features?.maxTotalFreeAdPerUser || 5,
                    categoryCount: config.categorySelections?.length || 0,
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
    // دریافت یک بازار با id (همراه locationTree و categoryTree کامل)
    // ============================================================
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

        // ═══════════════ locationTree ═══════════════
        const locationSelections = (config.locationSelections || []).filter((s: any) => s.isActive);
        const locationIds = locationSelections.map((s: any) => s.locationId);

        let locationTree: any[] = [];

        if (locationIds.length > 0) {
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

            locationTree = this.buildTree(allLocations);
        }

        // ═══════════════ categoryTree ═══════════════
        const categorySelections = (config.categorySelections || []).filter((s: any) => s.isActive);
        const categoryIds = categorySelections.map((s: any) => s.categoryId);

        let categoryTree: any[] = [];

        if (categoryIds.length > 0) {
            // دریافت همه دسته‌بندی‌های انتخاب‌شده
            const categories = await this.prisma.productCategory.findMany({
                where: { id: { in: categoryIds }, isActive: true },
            });

            // جمع‌آوری overrideUnitId ها برای واکشی یکجای واحدها
            const overrideUnitIds = categorySelections
                .map(s => s.overrideUnitId)
                .filter(Boolean) as string[];

            // واکشی همه واحدهای override شده از جدول Unit
            const units = overrideUnitIds.length > 0
                ? await this.prisma.unit.findMany({
                    where: { id: { in: overrideUnitIds } },
                    select: { id: true, title: true, shortCode: true },
                })
                : [];

            const unitMap = new Map(units.map(u => [u.id, u]));

            // برای هر دسته‌بندی، شناسه واحد معتبر را تعیین کن
            const resolveValidUnit = async (catId: string, overrideId: string | null) => {
                // اولویت ۱: overrideUnitId معتبر
                if (overrideId && unitMap.has(overrideId)) {
                    return unitMap.get(overrideId)!;
                }
                // اولویت ۲: واحد پیش‌فرض از CategoryUnitMapping
                const mapping = await this.prisma.categoryUnitMapping.findFirst({
                    where: { categoryId: catId, isDefault: true },
                    include: { unit: { select: { id: true, title: true, shortCode: true } } },
                });
                if (mapping) {
                    return mapping.unit;
                }
                // اولویت ۳: هر واحد متصل به این دسته‌بندی (اولین مورد)
                const anyMapping = await this.prisma.categoryUnitMapping.findFirst({
                    where: { categoryId: catId },
                    include: { unit: { select: { id: true, title: true, shortCode: true } } },
                });
                if (anyMapping) {
                    return anyMapping.unit;
                }
                // اگر هیچ واحدی پیدا نشد، خطا بده
                throw new BadRequestException({
                    errorCode: 'NO_UNIT_FOR_CATEGORY',
                    message: `هیچ واحدی برای دسته‌بندی "${catId}" تعریف نشده است.`,
                });
            };

            // ساخت گره‌ها
            const nodes: any[] = [];
            for (const cat of categories) {
                const selection = categorySelections.find(s => s.categoryId === cat.id)!;
                const unit = await resolveValidUnit(cat.id, selection.overrideUnitId);

                nodes.push({
                    id: cat.id,
                    title: cat.title,
                    slug: cat.slug,
                    path: cat.path,
                    level: cat.level,
                    parentId: cat.parentId,
                    isSelected: true,
                    customLabel: selection.customLabel || null,
                    defaultUnitId: unit.id,
                    unitTitle: unit.title,
                    unitShortCode: unit.shortCode,
                    defaultMinQuantity: selection.overrideMinQuantity || cat.defaultMinQuantity || null,
                    example: selection.example || (cat as any).example || null,
                    children: [],
                });
            }

            // والدها (اجداد) – فقط برای ساختار درختی
            const parentIds = [...new Set(categories.map(c => c.parentId).filter(Boolean))];
            const parents = parentIds.length > 0
                ? await this.prisma.productCategory.findMany({
                    where: { id: { in: parentIds as string[] } },
                })
                : [];

            // گره‌های والد بدون واحد (تنها برای سلسله‌مراتب)
            const parentNodes = parents.map(p => ({
                id: p.id,
                title: p.title,
                slug: p.slug,
                path: p.path,
                level: p.level,
                parentId: p.parentId,
                isSelected: false,
                customLabel: null,
                defaultUnitId: null,
                unitTitle: null,
                unitShortCode: null,
                defaultMinQuantity: null,
                example: null,
                children: [],
            }));

            const allCatNodes = [...parentNodes, ...nodes];
            categoryTree = this.buildTree(allCatNodes);
        }

        return {
            ...arm,
            locationTree,
            categoryTree,
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
        ];

        const updateData: any = {};
        for (const key of allowedFields) {
            if (data[key] !== undefined) updateData[key] = data[key];
        }

        // ✅ اگر config تغییر کرده باشد
        if (data.config) {
            const config = data.config;
            const oldArm = await this.prisma.arm.findUnique({
                where: { id },
                select: { config: true },
            });
            const oldConfig = (oldArm?.config as any) || {};

            // تشخیص تغییر در categorySelections یا locationSelections
            const oldCategorySelections = oldConfig.categorySelections || [];
            const newCategorySelections = config.categorySelections || [];
            const oldLocationSelections = oldConfig.locationSelections || [];
            const newLocationSelections = config.locationSelections || [];

            const categoryChanged = JSON.stringify(oldCategorySelections) !== JSON.stringify(newCategorySelections);
            const locationChanged = JSON.stringify(oldLocationSelections) !== JSON.stringify(newLocationSelections);

            // فقط در صورت تغییر، درخت‌ها را بازسازی کن
            let categoryTree = oldConfig._cachedCategoryTree || [];
            let locationTree = oldConfig._cachedLocationTree || [];

            if (categoryChanged) {
                categoryTree = await this.buildCategoryTreeFromConfig(config);
            }
            if (locationChanged) {
                locationTree = await this.buildLocationTreeFromConfig(config);
            }

            updateData.config = {
                ...config,
                _cachedCategoryTree: categoryTree,
                _cachedLocationTree: locationTree,
                _treeUpdatedAt: new Date().toISOString(),
            };
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
    // 🆕 ساخت درخت دسته‌بندی از config
    // ============================================================
    private async buildCategoryTreeFromConfig(config: any): Promise<any[]> {
        const categorySelections = (config.categorySelections || []).filter((s: any) => s.isActive !== false);
        const categoryIds = categorySelections.map((s: any) => s.categoryId);

        if (categoryIds.length === 0) return [];

        // ۱. دریافت همه دسته‌بندی‌های انتخاب‌شده
        const categories = await this.prisma.productCategory.findMany({
            where: { id: { in: categoryIds }, isActive: true },
        });

        // ۲. جمع‌آوری overrideUnitId ها
        const overrideUnitIds = categorySelections
            .map(s => s.overrideUnitId)
            .filter(Boolean) as string[];

        // ۳. واکشی همه واحدهای override شده
        const units = overrideUnitIds.length > 0
            ? await this.prisma.unit.findMany({
                where: { id: { in: overrideUnitIds } },
                select: { id: true, title: true, shortCode: true },
            })
            : [];

        const unitMap = new Map(units.map(u => [u.id, u]));

        // ۴. ساخت گره‌ها
        const nodes: any[] = [];
        for (const cat of categories) {
            const selection = categorySelections.find(s => s.categoryId === cat.id)!;

            // یافتن واحد معتبر
            let unit = null;
            if (selection.overrideUnitId && unitMap.has(selection.overrideUnitId)) {
                unit = unitMap.get(selection.overrideUnitId)!;
            } else {
                // واحد پیش‌فرض از CategoryUnitMapping
                const mapping = await this.prisma.categoryUnitMapping.findFirst({
                    where: { categoryId: cat.id, isDefault: true },
                    include: { unit: { select: { id: true, title: true, shortCode: true } } },
                });
                if (mapping) unit = mapping.unit;
            }

            nodes.push({
                id: cat.id,
                title: cat.title,
                slug: cat.slug,
                path: cat.path,
                level: cat.level,
                parentId: cat.parentId,
                isSelected: true,
                customLabel: selection.customLabel || null,
                defaultUnitId: unit?.id || null,
                unitTitle: unit?.title || selection.overrideUnitTitle || 'تن',
                unitShortCode: unit?.shortCode || selection.overrideUnitTitle || 'تن',
                defaultMinQuantity: selection.minQuantityOverride || cat.defaultMinQuantity || null,
                example: selection.example || null,
                children: [],
            });
        }

        // ۵. والدها (اجداد) – فقط برای ساختار درختی
        const parentIds = [...new Set(categories.map(c => c.parentId).filter(Boolean))];
        const parents = parentIds.length > 0
            ? await this.prisma.productCategory.findMany({
                where: { id: { in: parentIds as string[] } },
            })
            : [];

        const parentNodes = parents.map(p => ({
            id: p.id,
            title: p.title,
            slug: p.slug,
            path: p.path,
            level: p.level,
            parentId: p.parentId,
            isSelected: false,
            customLabel: null,
            defaultUnitId: null,
            unitTitle: null,
            unitShortCode: null,
            defaultMinQuantity: null,
            example: null,
            children: [],
        }));

        const allNodes = [...parentNodes, ...nodes];
        return this.buildTree(allNodes);
    }

    // ============================================================
    // 🆕 ساخت درخت موقعیت‌ها از config
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