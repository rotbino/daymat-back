// src/admin/ad/arm-admin-ad.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreditService } from '../../credit/credit.service';

@Injectable()
export class ArmAdminAdService {
    constructor(
        private prisma: PrismaService,
        private creditService: CreditService,
    ) {}
    async getAds(armId: string, query: {
        page?: number;
        limit?: number;
        search?: string;
        categoryId?: string;
        status?: string;
        city?: string;
        sortBy?: string;
        sortOrder?: 'asc' | 'desc';
    }) {
        const { page = 1, limit = 20, search, categoryId, status, city, sortBy = 'createdAt', sortOrder = 'desc' } = query;

        const skip = (Number(page) - 1) * Number(limit);
        const take = Number(limit);

        // ۱. ساخت شرط‌های فیلتر
        const where: any = { armId, status: { not: 'deleted' } };
        if (status && status !== 'all') where.status = status;
        if (search) {
            where.OR = [
                { title: { contains: search } },
                { description: { contains: search } },
                { productType: { contains: search } },
            ];
        }
        if (city) where.city = { contains: city };

        // فیلتر دسته‌بندی
        if (categoryId) {
            const category = await this.prisma.productCategory.findUnique({
                where: { id: categoryId, isActive: true },
                select: { path: true },
            });
            if (category) {
                const childCategories = await this.prisma.productCategory.findMany({
                    where: { path: { startsWith: category.path }, isActive: true },
                    select: { id: true },
                });
                const categoryIds = childCategories.map((c) => c.id);
                where.categoryId = { in: categoryIds };
            } else {
                where.categoryId = { in: [] };
            }
        }

        // ۲. واکشی تمام آگهی‌های منطبق (بدون مرتب‌سازی)
        const allAds = await this.prisma.ad.findMany({
            where,
            select: {
                id: true,
                title: true,
                productType: true,
                unitPrice: true,
                minQuantity: true,
                city: true,
                province: true,
                status: true,
                isAnonymous: true,
                isBumped: true,
                viewCount: true,
                callCount: true,
                createdAt: true,
                expiresAt: true,
                rejectionReason: true,
                unit: { select: { id: true, title: true, shortCode: true } },
                catalog: {
                    select: {
                        id: true,
                        name: true,
                        // ✅ تیک اعتماد از نهاد
                        business: { select: { verificationTier: true } },
                    },
                },
                arm: { select: { id: true, slug: true, name: true } },
                createdBy: { select: { id: true, fullName: true, phone: true } },
            },
        });

        // ۳. مرتب‌سازی در جاوااسکریپت (اولویت با pending)
        const STATUS_PRIORITY: Record<string, number> = {
            pending: 0,
            active: 1,
            inactive: 2,
            expired: 3,
            rejected: 4,
        };

        allAds.sort((a, b) => {
            const priorityA = STATUS_PRIORITY[a.status] ?? 5;
            const priorityB = STATUS_PRIORITY[b.status] ?? 5;
            if (priorityA !== priorityB) return priorityA - priorityB;
            if (sortBy === 'createdAt') {
                return sortOrder === 'desc'
                    ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                    : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
            }
            if (sortBy === 'unitPrice') {
                return sortOrder === 'desc' ? b.unitPrice - a.unitPrice : a.unitPrice - b.unitPrice;
            }
            if (sortBy === 'viewCount') {
                return sortOrder === 'desc' ? b.viewCount - a.viewCount : a.viewCount - b.viewCount;
            }
            if (sortBy === 'callCount') {
                return sortOrder === 'desc' ? b.callCount - a.callCount : a.callCount - b.callCount;
            }
            if (sortBy === 'expiresAt') {
                return sortOrder === 'desc'
                    ? new Date(b.expiresAt).getTime() - new Date(a.expiresAt).getTime()
                    : new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime();
            }
            return 0;
        });

        // ✅ شکل قدیمی verificationTier برای فرانت حفظ می‌شود
        const normalized = allAds.map((ad: any) => ({
            ...ad,
            verificationTier: ad.catalog?.business?.verificationTier ?? null,
        }));

        // ۴. پیجینیشن
        const items = normalized.slice(skip, skip + take);
        const total = normalized.length;

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

    // ✅ دریافت جزئیات آگهی — مالک از مسیر نهاد
    async getAdDetail(id: string) {
        return this.prisma.ad.findUnique({
            where: { id },
            include: {
                unit: true,
                catalog: {
                    include: {
                        business: { include: { owner: true } },
                    },
                },
                arm: { select: { id: true, slug: true, name: true } },
                createdBy: { select: { id: true, fullName: true, phone: true } },
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

    // ✅ تایید آگهی — مالکیت از مسیر نهاد
    async approveAd(adId: string) {
        const ad = await this.prisma.ad.findUnique({
            where: { id: adId },
            include: {
                arm: { select: { config: true } },
                catalog: {
                    select: {
                        id: true,
                        ownerUserId: true,
                    },
                },
            },
        });

        if (!ad) throw new NotFoundException({ errorCode: 'AD_NOT_FOUND', message: 'آگهی یافت نشد' });
        if (ad.status === 'active') throw new BadRequestException({ errorCode: 'ALREADY_ACTIVE', message: 'آگهی قبلاً فعال شده است' });

        const config = (ad.arm?.config as any) || {};
        // ✅ هزینه‌ها روی مالکِ کاتالوگ (کاربرِ سازندهٔ آن) charge می‌شود
        const ownerUserId = (ad.catalog as any).ownerUserId;
        const updateData: any = {
            status: 'active',
            updatedAt: new Date(),
        };

        // مدیریت تاریخ نردبان
        if (ad.isBumped) {
            const now = new Date();
            if (!ad.bumpExpiresAt || ad.bumpExpiresAt <= now) {
                const bumpDurationHours = ad.bumpDurationHours ?? 24;
                const validityHours = ad.validityHours;
                if (bumpDurationHours > validityHours) {
                    throw new BadRequestException({
                        errorCode: 'BUMP_DURATION_EXCEEDS_VALIDITY',
                        message: `مدت نردبان (${bumpDurationHours}) نمی‌تواند از اعتبار (${validityHours}) بیشتر باشد.`,
                    });
                }
                const baseCost = config.economy?.bumpCost ?? 10;
                const bumpCostTotal = (bumpDurationHours / 24) * baseCost;
                const balance = await this.creditService.getUserBalance(ownerUserId);
                if (balance.balance < bumpCostTotal) {
                    throw new BadRequestException({
                        errorCode: 'INSUFFICIENT_CREDIT',
                        message: `برای فعال‌سازی نردبان به ${bumpCostTotal} اعتبار نیاز دارید.`,
                    });
                }
                await this.prisma.credit.create({
                    data: {
                        userId: ownerUserId,
                        catalogId: ad.catalogId,
                        armId: ad.armId,
                        amount: 0,
                        currency: 'IRR',
                        creditCount: -bumpCostTotal,
                        creditType: 'purchased',
                        status: 'success',
                        transactionType: 'spend',
                        description: `نردبان آگهی "${ad.title}" در زمان تایید`,
                        metadata: { ad_id: adId, cost: bumpCostTotal },
                    },
                });
                updateData.bumpExpiresAt = new Date(now.getTime() + bumpDurationHours * 60 * 60 * 1000);
                updateData.lastBumpCreditsSpent = bumpCostTotal;
                updateData.bumpDurationHours = bumpDurationHours;
            }
        }

        return this.prisma.ad.update({
            where: { id: adId },
            data: updateData,
            include: {
                unit: { select: { id: true, title: true, shortCode: true } },
            },
        });
    }

    // ✅ رد آگهی
    async rejectAd(adId: string, adminUserId: string, reason: string) {
        const ad = await this.prisma.ad.findUnique({
            where: { id: adId },
            select: { armId: true, status: true },
        });
        if (!ad) throw new NotFoundException({ errorCode: 'AD_NOT_FOUND', message: 'آگهی یافت نشد' });
        if (ad.status !== 'pending') {
            throw new BadRequestException({ errorCode: 'AD_NOT_PENDING', message: 'فقط آگهی‌های در انتظار تایید قابل رد هستند' });
        }
        if (!reason || reason.trim().length === 0) {
            throw new BadRequestException({ errorCode: 'REJECTION_REASON_REQUIRED', message: 'دلیل رد آگهی الزامی است' });
        }
        return this.prisma.ad.update({
            where: { id: adId },
            data: {
                status: 'rejected',
                rejectionReason: reason.trim(),
                updatedAt: new Date(),
            },
        });
    }
}