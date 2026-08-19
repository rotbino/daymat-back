// src/admin/ad/admin-ad.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminAdService {
    constructor(private prisma: PrismaService) {}

    async getAds(query: {
        page?: number; limit?: number; search?: string;
        categoryId?: string; armSlug?: string;
        status?: string; city?: string; provinceCode?: string; countryCode?: string;cityCode?: string;
        minPrice?: number; maxPrice?: number;
        startDate?: string; endDate?: string;
        isAnonymous?: string; isBumped?: string;
        sortBy?: string; sortOrder?: 'asc' | 'desc';
    }) {
        const {
            page = 1, limit = 20, search, categoryId, armSlug, status,
            city,cityCode, provinceCode, countryCode, minPrice, maxPrice,
            startDate, endDate, isAnonymous, isBumped,
            sortBy = 'createdAt', sortOrder = 'desc',
        } = query;

        const skip = (Number(page) - 1) * Number(limit);
        const where: any = { status: { not: 'deleted' } };

        if (status && status !== 'all') where.status = status;

        if (search) {
            where.OR = [
                { title: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } },
            ];
        }

        // ✅ اولویت‌بندی فیلتر موقعیت: شهر > استان > کشور
        if (cityCode) {
            where.cityCode = cityCode;
        } else if (provinceCode) {
            where.provinceCode = provinceCode;
        } else if (countryCode) {
            where.countryCode = countryCode;
        }

        if (categoryId) where.categoryId = categoryId;

        if (armSlug) {
            const arm = await this.prisma.arm.findUnique({
                where: { slug: armSlug },
                select: { id: true },
            });
            if (arm) where.armId = arm.id;
        }

        if (minPrice !== undefined) where.unitPrice = { ...where.unitPrice, gte: Number(minPrice) };
        if (maxPrice !== undefined) where.unitPrice = { ...where.unitPrice, lte: Number(maxPrice) };
        if (startDate) where.createdAt = { ...where.createdAt, gte: new Date(startDate) };
        if (endDate) where.createdAt = { ...where.createdAt, lte: new Date(endDate + 'T23:59:59.999Z') };

        if (isAnonymous === 'true') where.isAnonymous = true;
        if (isAnonymous === 'false') where.isAnonymous = false;
        if (isBumped === 'true') where.isBumped = true;

        const orderMap: any = {
            createdAt: { createdAt: sortOrder },
            unitPrice: { unitPrice: sortOrder },
            viewCount: { viewCount: sortOrder },
            callCount: { callCount: sortOrder },
            expiresAt: { expiresAt: sortOrder },
        };

        const [items, total] = await Promise.all([
            this.prisma.ad.findMany({
                where,
                skip,
                take: Number(limit),
                select: {
                    id: true, title: true, unitPrice: true, minQuantity: true,
                    city: true, province: true, cityCode: true, provinceCode: true, countryCode: true,
                    status: true, isAnonymous: true,
                    isBumped: true, viewCount: true, callCount: true,
                    createdAt: true, expiresAt: true,
                    unit: { select: { id: true, title: true, shortCode: true } },
                    category: { select: { id: true, title: true, path: true } },
                    business: { select: { id: true, name: true, verificationTier: true } },
                    arm: { select: { id: true, slug: true, name: true } },
                    createdBy: { select: { id: true, fullName: true, phone: true } },
                },
                orderBy: orderMap[sortBy] || { createdAt: 'desc' },
            }),
            this.prisma.ad.count({ where }),
        ]);

        return {
            items,
            pagination: {
                page: Number(page),
                limit: Number(limit),
                total,
                totalPages: Math.ceil(total / Number(limit)),
            },
        };
    }

    async getAdDetail(id: string) {
        return this.prisma.ad.findUnique({
            where: { id },
            include: {
                unit: true, category: true,
                business: true,
                arm: { select: { id: true, slug: true, name: true } },
                createdBy: { select: { id: true, fullName: true, phone: true } },
                views: { take: 10, orderBy: { viewedAt: 'desc' }, select: { viewedAt: true, source: true } },
                callEvents: { take: 10, orderBy: { initiatedAt: 'desc' } },
                files: true,
            },
        });
    }

    async updateAdStatus(id: string, status: string) {
        return this.prisma.ad.update({ where: { id }, data: { status } });
    }

    async deleteAd(id: string) {
        return this.prisma.ad.update({ where: { id }, data: { status: 'deleted' } });
    }

    async getCategoryTreeForAds(armSlug?: string) {
        if (armSlug) {
            const arm = await this.prisma.arm.findUnique({
                where: { slug: armSlug },
                select: { config: true },
            });
            if (!arm) return [];

            const config = arm.config as any || {};
            const selections = config.categorySelections || [];
            const categoryIds = selections.filter((s: any) => s.isActive).map((s: any) => s.categoryId);

            const categories = await this.prisma.productCategory.findMany({
                where: { id: { in: categoryIds }, isActive: true },
                orderBy: { path: 'asc' },
            });
            return this.buildTree(categories);
        }

        const categories = await this.prisma.productCategory.findMany({
            where: { isActive: true },
            orderBy: { path: 'asc' },
        });
        return this.buildTree(categories);
    }

    async getArmsForFilter() {
        return this.prisma.arm.findMany({
            where: { status: 'active' },
            select: { id: true, slug: true, name: true, colorPrimary: true },
            orderBy: { name: 'asc' },
        });
    }
    // src/admin/ad/admin-ad.service.ts - اضافه کن:

    async getLocationTreeForAds(armSlug?: string) {


        if (!armSlug) {
            return this.prisma.location.findMany({
                where: { type: 'country', isActive: true },
                select: { id: true, title: true, countryCode: true },
            });
        }

        const arm = await this.prisma.arm.findUnique({
            where: { slug: armSlug },
            select: { config: true },
        });


        if (!arm) return [];

        const config = arm.config as any || {};


        const selections = (config.locationSelections || []).filter((s: any) => s.isActive);
        console.log('📍 active selections:', selections);

        const locationIds = selections.map((s: any) => s.locationId);
        console.log('📍 locationIds:', locationIds);

        if (locationIds.length === 0) return [];

        const cities = await this.prisma.location.findMany({
            where: { id: { in: locationIds }, isActive: true },
            select: { id: true, title: true, cityCode: true, provinceCode: true, parentId: true, level: true, path: true },
        });
        console.log('📍 cities found:', cities.length, cities.map(c => c.title));

        const parentIds = [...new Set(cities.map(c => c.parentId).filter(Boolean))];
        console.log('📍 parentIds:', parentIds);

        const provinces = parentIds.length > 0
            ? await this.prisma.location.findMany({
                where: { id: { in: parentIds as string[] } },
                select: { id: true, title: true, provinceCode: true, level: true, path: true },
            })
            : [];
        console.log('📍 provinces found:', provinces.length, provinces.map(p => p.title));

        const result = provinces.map(p => ({
            ...p,
            children: cities.filter(c => c.parentId === p.id),
        }));
        console.log('📍 result:', JSON.stringify(result, null, 2));

        return result;
    }

    async getStats(query: { armSlug?: string; categoryId?: string; startDate?: string; endDate?: string }) {
        const where: any = { status: { not: 'deleted' } };
        if (query.armSlug) {
            const arm = await this.prisma.arm.findUnique({ where: { slug: query.armSlug }, select: { id: true } });
            if (arm) where.armId = arm.id;
        }
        if (query.categoryId) where.categoryId = query.categoryId;
        if (query.startDate) where.createdAt = { ...where.createdAt, gte: new Date(query.startDate) };
        if (query.endDate) where.createdAt = { ...where.createdAt, lte: new Date(query.endDate + 'T23:59:59.999Z') };

        const [total, active, pending, rejected, viewsAgg, callsAgg, priceAgg] = await Promise.all([
            this.prisma.ad.count({ where }),
            this.prisma.ad.count({ where: { ...where, status: 'active' } }),
            this.prisma.ad.count({ where: { ...where, status: 'pending' } }),
            this.prisma.ad.count({ where: { ...where, status: 'rejected' } }),
            this.prisma.ad.aggregate({ where, _sum: { viewCount: true } }),
            this.prisma.ad.aggregate({ where, _sum: { callCount: true } }),
            this.prisma.ad.aggregate({
                where: { ...where, status: 'active' },
                _avg: { unitPrice: true },
            }),
        ]);

        return {
            total,
            active,
            pending,
            rejected,
            totalViews: viewsAgg._sum.viewCount || 0,
            totalCalls: callsAgg._sum.callCount || 0,
            avgPrice: Math.round(priceAgg._avg.unitPrice || 0),
        };
    }

    private buildTree(items: any[]): any[] {
        const map = new Map();
        const roots: any[] = [];
        for (const item of items) map.set(item.id, { ...item, children: [] });
        for (const [id, node] of map) {
            if (node.parentId && map.has(node.parentId)) map.get(node.parentId).children.push(node);
            else roots.push(node);
        }
        return roots;
    }
}