// src/catalog/catalog.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CatalogService {
    constructor(private prisma: PrismaService) {}

    // ═══════════════════════════════════════════════════════
    // ✅ ثبت بازدید
    // ═══════════════════════════════════════════════════════
    async trackView(businessId: string, userId?: string, ipAddress?: string) {
        const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        // چک کن آیا در ۲۴ ساعت اخیر از این کاربر یا IP ویو ثبت شده
        const existing = await this.prisma.catalogInteraction.findFirst({
            where: {
                businessId,
                type: 'view',
                ...(userId
                    ? { userId }
                    : { ipAddress: ipAddress || 'unknown' }),
                createdAt: { gte: dayAgo },
            },
        });

        if (existing) return existing;

        return this.prisma.catalogInteraction.create({
            data: {
                businessId,
                userId: userId || null,
                type: 'view',
                ipAddress: ipAddress || null,
            },
        });
    }

    // ═══════════════════════════════════════════════════════
    // ✅ ذخیره کاتالوگ
    // ═══════════════════════════════════════════════════════
    async save(businessId: string, userId: string) {
        // بررسی وجود کسب‌وکار
        const business = await this.prisma.business.findUnique({
            where: { id: businessId },
            select: { id: true },
        });
        if (!business) {
            throw new NotFoundException({
                errorCode: 'BUSINESS_NOT_FOUND',
                message: 'کسب‌وکار یافت نشد',
            });
        }

        // چک کن قبلاً ذخیره نشده
        const existing = await this.prisma.catalogInteraction.findFirst({
            where: { businessId, userId, type: 'save' },
        });

        if (existing) return existing;

        return this.prisma.catalogInteraction.create({
            data: { businessId, userId, type: 'save' },
        });
    }

    // ═══════════════════════════════════════════════════════
    // ✅ حذف از ذخیره
    // ═══════════════════════════════════════════════════════
    async unsave(businessId: string, userId: string) {
        return this.prisma.catalogInteraction.deleteMany({
            where: { businessId, userId, type: 'save' },
        });
    }

    // ═══════════════════════════════════════════════════════
    // ✅ بررسی وضعیت ذخیره
    // ═══════════════════════════════════════════════════════
    async isSaved(businessId: string, userId: string) {
        const saved = await this.prisma.catalogInteraction.findFirst({
            where: { businessId, userId, type: 'save' },
        });
        return { isSaved: !!saved };
    }

    // ═══════════════════════════════════════════════════════
    // ✅ آمار کاتالوگ
    // ═══════════════════════════════════════════════════════
    async getStats(businessId: string) {
        const [views, saves, shares] = await Promise.all([
            this.prisma.catalogInteraction.count({
                where: { businessId, type: 'view' },
            }),
            this.prisma.catalogInteraction.count({
                where: { businessId, type: 'save' },
            }),
            this.prisma.catalogInteraction.count({
                where: { businessId, type: 'share' },
            }),
        ]);

        // چه کسانی ذخیره کرده‌اند
        const savedBy = await this.prisma.catalogInteraction.findMany({
            where: {
                businessId,
                type: 'save',
                userId: { not: null },
            },
            include: {
                user: {
                    select: {
                        id: true,
                        fullName: true,
                        phone: true,
                        avatarUrl: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
            take: 20,
        });

        // چه کسانی بازدید کرده‌اند (اخیر)
        const viewedBy = await this.prisma.catalogInteraction.findMany({
            where: {
                businessId,
                type: 'view',
                userId: { not: null },
            },
            include: {
                user: {
                    select: {
                        id: true,
                        fullName: true,
                        avatarUrl: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
            take: 10,
            distinct: ['userId'],
        });

        return {
            views,
            saves,
            shares,
            savedBy: savedBy.map(s => ({
                user: s.user,
                savedAt: s.createdAt,
            })),
            viewedBy: viewedBy.map(v => ({
                user: v.user,
                viewedAt: v.createdAt,
            })),
        };
    }

    // ═══════════════════════════════════════════════════════
    // ✅ لیست کاتالوگ‌های ذخیره شده کاربر
    // ═══════════════════════════════════════════════════════
    async getSavedList(userId: string) {
        const saved = await this.prisma.catalogInteraction.findMany({
            where: { userId, type: 'save' },
            include: {
                business: {
                    select: {
                        id: true,
                        name: true,
                        slug: true,
                        logoUrl: true, // ✅ این ممکن است null باشد
                        city: true,
                        province: true,
                        type: true,
                        shortDescription: true,
                        verificationTier: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        // ✅ برای هر business لوگو را جداگانه بگیر
        const result = await Promise.all(
            saved.map(async (s) => {
                const logoFile = await this.prisma.file.findFirst({
                    where: {
                        relatedModel: 'Business',
                        relatedId: s.business.id,
                        fieldKey: 'logo',
                    },
                    select: { path: true, thumbnailPath: true },
                });

                return {
                    ...s.business,
                    logoUrl: logoFile?.path || s.business.logoUrl || null,
                    savedAt: s.createdAt,
                };
            })
        );

        return result;
    }

    // ═══════════════════════════════════════════════════════
    // ✅ لیست آگهی‌های کاتالوگ (عمومی)
    // ═══════════════════════════════════════════════════════
    async getCatalogAds(
        businessId: string,
        page: number = 1,
        limit: number = 10,
        search?: string,
    ) {
        const skip = (page - 1) * limit;

        const where: any = {
            businessId,
            status: { not: 'deleted' },
        };

        if (search) {
            where.OR = [
                { title: { contains: search, mode: 'insensitive' } },
                { productType: { contains: search, mode: 'insensitive' } },
            ];
        }

        const [ads, total] = await Promise.all([
            this.prisma.ad.findMany({
                where,
                include: {
                    unit: { select: { id: true, title: true, shortCode: true } },
                    arm: { select: { id: true, slug: true, name: true } },
                    files: {
                        select: { id: true, path: true, thumbnailPath: true, fieldKey: true },
                    },
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            this.prisma.ad.count({ where }),
        ]);

        return {
            ads,
            total,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    // ═══════════════════════════════════════════════════════
    // ✅ ثبت اشتراک‌گذاری
    // ═══════════════════════════════════════════════════════
    async trackShare(businessId: string, userId?: string) {
        return this.prisma.catalogInteraction.create({
            data: {
                businessId,
                userId: userId || null,
                type: 'share',
            },
        });
    }
}