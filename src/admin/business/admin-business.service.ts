// src/admin/business/admin-business.service.ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminBusinessService {
    constructor(private prisma: PrismaService) {}

    // ============================================================
    // لیست کسب‌وکارها با فیلتر و آمار
    // ============================================================
    async getBusinesses(query: {
        page?: number;
        limit?: number;
        search?: string;
        status?: string;
        type?: string;
        verificationTier?: string;
        verificationStatus?: string;
        provinceCode?: string;
        cityCode?: string;
        industryId?: string;
        activityId?: string;
        armSlug?: string;
        sortBy?: string;
        sortOrder?: 'asc' | 'desc';
    }) {
        const {
            page = 1,
            limit = 20,
            search,
            status,
            type,
            verificationTier,
            verificationStatus,
            provinceCode,
            cityCode,
            industryId,
            activityId,
            armSlug,
            sortBy = 'createdAt',
            sortOrder = 'desc',
        } = query;

        const skip = (Number(page) - 1) * Number(limit);
        const where: any = {};

        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { shortDescription: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search, mode: 'insensitive' } },
            ];
        }
        if (status && status !== 'all') where.status = status;
        if (type && type !== 'all') where.type = type;
        if (verificationTier && verificationTier !== 'all') where.verificationTier = verificationTier;
        if (verificationStatus && verificationStatus !== 'all') {
            if (verificationStatus === 'none') {
                // کسب‌وکارهایی که هرگز درخواست نداده‌اند (status = none)
                where.verificationStatus = 'none';
                where.verificationTier = 'none';
            } else if (verificationStatus === 'pending') {
                where.verificationStatus = 'pending';
            } else if (verificationStatus === 'approved') {
                where.verificationStatus = 'approved';
            } else if (verificationStatus === 'rejected') {
                where.verificationStatus = 'rejected';
            }
        }
        if (provinceCode) where.provinceCode = provinceCode;
        if (cityCode) where.cityCode = cityCode;
        if (industryId) where.industryId = industryId;
        if (activityId) {
            where.activities = { some: { activityId } };
        }

        // فیلتر بر اساس بازار
        if (armSlug && armSlug !== 'all') {
            const arm = await this.prisma.arm.findUnique({
                where: { slug: armSlug },
                select: { id: true },
            });
            if (arm) {
                where.armMemberships = { some: { armId: arm.id } };
            }
        }

        const orderByMap: Record<string, any> = {
            name: { name: sortOrder },
            type: { type: sortOrder },
            createdAt: { createdAt: sortOrder },
            updatedAt: { updatedAt: sortOrder },
            verificationTier: { verificationTier: sortOrder },
            trustScore: { trustScore: sortOrder },
        };

        const [items, total] = await Promise.all([
            this.prisma.business.findMany({
                where,
                skip,
                take: Number(limit),
                select: {
                    id: true,
                    name: true,
                    shortDescription: true,
                    type: true,
                    city: true,
                    province: true,
                    phone: true,
                    verificationTier: true,
                    verificationStatus: true,
                    trustScore: true,
                    status: true,
                    createdAt: true,
                    updatedAt: true,
                    _count: { select: { ads: true, armMemberships: true } },
                },
                orderBy: orderByMap[sortBy] || { createdAt: 'desc' },
            }),
            this.prisma.business.count({ where }),
        ]);

        // آمار
        const [totalBusinesses, pendingVerification, activeBusinesses, byTier] = await Promise.all([
            this.prisma.business.count(),
            this.prisma.business.count({ where: { verificationStatus: 'pending' } }),
            this.prisma.business.count({ where: { status: 'active' } }),
            this.prisma.business.groupBy({
                by: ['verificationTier'],
                _count: { id: true },
                where: { verificationStatus: 'approved' },
            }),
        ]);

        const tierStats = { blue: 0, silver: 0, gold: 0 };
        byTier.forEach((t: any) => {
            if (t.verificationTier in tierStats) tierStats[t.verificationTier] = t._count.id;
        });

        return {
            items,
            pagination: {
                page: Number(page),
                limit: Number(limit),
                total,
                totalPages: Math.ceil(total / Number(limit)),
            },
            stats: {
                totalBusinesses,
                pendingVerification,
                activeBusinesses,
                tierStats,
            },
        };
    }

    // ============================================================
    // جزئیات کسب‌وکار (شامل مدارک تیک اعتماد)
    // ============================================================
    // src/admin/business/admin-business.service.ts – getBusinessDetail به‌روز شده
    async getBusinessDetail(businessId: string) {
        const business = await this.prisma.business.findUnique({
            where: { id: businessId },
            include: {
                owner: { select: { id: true, phone: true, fullName: true, avatarUrl: true } },
                activities: { include: { activity: true } },
                armMemberships: {
                    include: { arm: { select: { id: true, slug: true, name: true, colorPrimary: true } } },
                },
                verifications: {
                    orderBy: { submittedAt: 'desc' },
                    select: {
                        id: true,
                        tier: true,
                        status: true,
                        documents: true,
                        notes: true,
                        submittedAt: true,
                        reviewedAt: true,
                        reviewedByUserId: true,
                        expiresAt: true,
                    },
                },
                files: true,
                ads: {
                    orderBy: { createdAt: 'desc' },
                    take: 20,
                    select: {
                        id: true,
                        title: true,
                        productType: true,
                        unitPrice: true,
                        status: true,
                        createdAt: true,
                        category: { select: { id: true, title: true } },
                        arm: { select: { id: true, slug: true, name: true } },
                    },
                },
                credits: {
                    orderBy: { createdAt: 'desc' },
                    take: 50,
                    select: {
                        id: true,
                        amount: true,
                        creditCount: true,
                        creditType: true,
                        status: true,
                        transactionType: true,
                        description: true,
                        createdAt: true,
                        arm: { select: { id: true, name: true, slug: true } },
                    },
                },
                creditRequests: {
                    orderBy: { createdAt: 'desc' },
                    take: 50,
                    select: {
                        id: true,
                        amount: true,
                        status: true,
                        receiptImage: true,
                        receiptNote: true,
                        createdAt: true,
                        verifiedAt: true,
                        rejectReason: true,
                        metadata: true,
                        arm: { select: { id: true, name: true, slug: true } },
                    },
                },
            },
        });

        if (!business) throw new NotFoundException({ errorCode: 'BUSINESS_NOT_FOUND', message: 'کسب‌وکار یافت نشد' });

        const latestVerification = business.verifications[0] || null;

        const fileUrlMap: Record<string, string> = {};
        business.files.forEach(f => {
            fileUrlMap[f.id] = `/file/${f.id}`;
        });

        return {
            ...business,
            latestVerification,
            fileUrlMap,
            activities: business.activities.map(a => a.activity),
        };
    }

    // ============================================================
    // تأیید یا رد درخواست تیک اعتماد
    // ============================================================
    async verifyBusiness(
        businessId: string,
        adminUserId: string,
        body: {
            action: 'approve' | 'reject';
            tier?: string;
            reason?: string;
            verificationId?: string;
        },
    ) {
        const business = await this.prisma.business.findUnique({ where: { id: businessId } });
        if (!business) throw new NotFoundException({ errorCode: 'BUSINESS_NOT_FOUND', message: 'کسب‌وکار یافت نشد' });

        if (body.action === 'approve') {
            if (!body.tier || !['blue', 'silver', 'gold'].includes(body.tier)) {
                throw new BadRequestException({ errorCode: 'INVALID_TIER', message: 'سطح تیک نامعتبر است' });
            }

            // به‌روزرسانی کسب‌وکار
            await this.prisma.business.update({
                where: { id: businessId },
                data: {
                    verificationTier: body.tier,
                    verificationStatus: 'approved',
                    updatedAt: new Date(),
                },
            });

            // یافتن رکورد Verification مربوطه (با اولویت verificationId ارسالی)
            const verificationRecord = body.verificationId
                ? await this.prisma.verification.findUnique({ where: { id: body.verificationId } })
                : await this.prisma.verification.findFirst({
                    where: { businessId, status: 'pending' },
                    orderBy: { submittedAt: 'desc' },
                });

            if (verificationRecord) {
                // به‌روزرسانی وضعیت Verification
                await this.prisma.verification.update({
                    where: { id: verificationRecord.id },
                    data: {
                        status: 'approved',
                        tier: body.tier,
                        reviewedByUserId: adminUserId,
                        reviewedAt: new Date(),
                    },
                });

                // استخراج و ذخیره کد ملی در صورت وجود
                const docs = verificationRecord.documents as any;
                const nationalId = docs?.nationalId;
                if (nationalId) {
                    await this.prisma.user.update({
                        where: { id: business.ownerUserId },
                        data: { nationalId },
                    });
                }
            }

            return { message: 'تیک اعتماد با موفقیت تأیید شد', tier: body.tier };
        } else if (body.action === 'reject') {
            if (!body.reason) {
                throw new BadRequestException({ errorCode: 'REASON_REQUIRED', message: 'دلیل رد الزامی است' });
            }

            // تغییر وضعیت کسب‌وکار به rejected
            await this.prisma.business.update({
                where: { id: businessId },
                data: {
                    verificationStatus: 'rejected',
                    updatedAt: new Date(),
                },
            });

            const verificationRecord = body.verificationId
                ? await this.prisma.verification.findUnique({ where: { id: body.verificationId } })
                : await this.prisma.verification.findFirst({
                    where: { businessId, status: 'pending' },
                    orderBy: { submittedAt: 'desc' },
                });

            if (verificationRecord) {
                await this.prisma.verification.update({
                    where: { id: verificationRecord.id },
                    data: {
                        status: 'rejected',
                        notes: body.reason,
                        reviewedByUserId: adminUserId,
                        reviewedAt: new Date(),
                    },
                });
            }

            return { message: 'درخواست تیک رد شد', reason: body.reason };
        } else {
            throw new BadRequestException({ errorCode: 'INVALID_ACTION', message: 'عملیات نامعتبر' });
        }
    }
}