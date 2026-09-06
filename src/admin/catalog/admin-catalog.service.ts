// src/admin/catalog/admin-catalog.service.ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * سازگاری مسیرهای قدیمی پنل ادمین (/admin/cataloges).
 *
 * بعد از تفکیک نهاد/ویترین:
 *   - مدیریتِ «کسب‌وکارها» (تیک اعتماد، مدارک، صنف، فعالیت‌ها) روی مدل Business است
 *   - کاتالوگ = ویترینِ یک نهاد (slug، درخت دسته، واحدها، کالاها)
 *
 * این سرویس مستقیم روی Business کار می‌کند و فقط نامِ متدها/مسیرهای قدیمی را
 * حفظ کرده تا فرانت ادمین بدون تغییر کار کند.
 */
@Injectable()
export class AdminCatalogService {
    constructor(private prisma: PrismaService) {}

    // ============================================================
    // لیست کسب‌وکارها (نهادها) با فیلتر و آمار
    // ============================================================
    async getCataloges(query: {
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
                { name: { contains: search } },
                { shortDescription: { contains: search } },
                { phone: { contains: search } },
                { industryName: { contains: search } },
            ];
        }
        if (status && status !== 'all') where.status = status;
        if (type && type !== 'all') where.type = type;
        if (verificationTier && verificationTier !== 'all') where.verificationTier = verificationTier;
        if (verificationStatus && verificationStatus !== 'all') {
            if (verificationStatus === 'none') {
                where.verificationStatus = 'none';
                where.verificationTier = 'none';
            } else {
                where.verificationStatus = verificationStatus;
            }
        }
        if (provinceCode) where.provinceCode = provinceCode;
        if (cityCode) where.cityCode = cityCode;
        if (industryId) where.industryId = industryId;

        // ✅ فعالیت‌ها روی نهاد هستند (BusinessActivity)
        if (activityId) {
            where.activities = { some: { activityId } };
        }

        // ✅ فیلتر بازار — از مسیر کاتالوگ‌های نهاد و عضویت آن‌ها
        if (armSlug && armSlug !== 'all') {
            const arm = await this.prisma.arm.findUnique({
                where: { slug: armSlug },
                select: { id: true },
            });
            if (arm) {
                where.catalogs = {
                    some: { armMemberships: { some: { armId: arm.id } } },
                };
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
                    industryName: true,
                    city: true,
                    province: true,
                    phone: true,
                    verificationTier: true,
                    verificationStatus: true,
                    trustScore: true,
                    status: true,
                    createdAt: true,
                    updatedAt: true,
                    _count: { select: { catalogs: true } },
                },
                orderBy: orderByMap[sortBy] || { createdAt: 'desc' },
            }),
            this.prisma.business.count({ where }),
        ]);

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
    // جزئیات — نهاد + کاتالوگ‌های متصل + مدارک تیک + آمار تجمیعی
    // (ads/files/armMemberships روی Business نیستند — از مسیر کاتالوگ‌ها)
    // ============================================================
    async getCatalogDetail(catalogId: string) {
        const business = await this.prisma.business.findUnique({
            where: { id: catalogId },
            include: {
                owner: { select: { id: true, phone: true, fullName: true, avatarUrl: true } },
                activities: { include: { activity: true } },
                catalogs: {
                    select: {
                        id: true,
                        name: true,
                        slug: true,
                        salesType: true,
                        status: true,
                        city: true,
                        logoUrl: true,
                        _count: { select: { ads: { where: { status: { not: 'deleted' } } } } },
                    },
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
            },
        });

        if (!business) throw new NotFoundException({ errorCode: 'BUSINESS_NOT_FOUND', message: 'کسب‌وکار یافت نشد' });

        const catalogIds = business.catalogs.map((c) => c.id);

        // ─── آگهی‌ها — تجمیعی از کاتالوگ‌های نهاد ───
        const ads = catalogIds.length
            ? await this.prisma.ad.findMany({
                where: { catalogId: { in: catalogIds } },
                orderBy: { createdAt: 'desc' },
                take: 20,
                select: {
                    id: true,
                    title: true,
                    productType: true,
                    unitPrice: true,
                    status: true,
                    createdAt: true,
                    categoryId: true,
                    arm: { select: { id: true, slug: true, name: true } },
                    catalog: { select: { id: true, name: true } },
                },
            })
            : [];

        // ─── عضویت‌های بازار — از مسیر کاتالوگ‌ها ───
        const armMemberships = catalogIds.length
            ? await this.prisma.armMembership.findMany({
                where: { catalogId: { in: catalogIds } },
                include: {
                    arm: { select: { id: true, slug: true, name: true, colorPrimary: true } },
                    catalog: { select: { id: true, name: true } },
                },
            })
            : [];

        // ─── اعتبارها — از مسیر کاتالوگ‌ها ───
        const credits = catalogIds.length
            ? await this.prisma.credit.findMany({
                where: { catalogId: { in: catalogIds } },
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
            })
            : [];

        const creditRequests = catalogIds.length
            ? await this.prisma.creditRequest.findMany({
                where: { catalogId: { in: catalogIds } },
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
            })
            : [];

        // ─── فایل‌های نهاد — کوئری دستی ───
        const files = await this.prisma.file.findMany({
            where: { relatedModel: 'Business', relatedId: catalogId },
        });

        const latestVerification = business.verifications[0] || null;

        const fileUrlMap: Record<string, string> = {};
        files.forEach((f) => { fileUrlMap[f.id] = `/file/${f.id}`; });

        return {
            ...business,
            owner: business.owner,
            catalogs: business.catalogs,
            armMemberships,
            ads,
            credits,
            creditRequests,
            latestVerification,
            fileUrlMap,
            activities: business.activities.map((a) => a.activity),
        };
    }

    // ============================================================
    // تأیید یا رد درخواست تیک اعتماد — روی نهاد
    // ============================================================
    async verifyCatalog(
        catalogId: string,
        adminUserId: string,
        body: {
            action: 'approve' | 'reject';
            tier?: string;
            reason?: string;
            verificationId?: string;
        },
    ) {
        const business = await this.prisma.business.findUnique({
            where: { id: catalogId },
        });
        if (!business) throw new NotFoundException({ errorCode: 'BUSINESS_NOT_FOUND', message: 'کسب‌وکار یافت نشد' });

        if (body.action === 'approve') {
            if (!body.tier || !['blue', 'silver', 'gold'].includes(body.tier)) {
                throw new BadRequestException({ errorCode: 'INVALID_TIER', message: 'سطح تیک نامعتبر است' });
            }

            await this.prisma.business.update({
                where: { id: catalogId },
                data: {
                    verificationTier: body.tier,
                    verificationStatus: 'approved',
                    updatedAt: new Date(),
                },
            });

            const verificationRecord = body.verificationId
                ? await this.prisma.verification.findUnique({ where: { id: body.verificationId } })
                : await this.prisma.verification.findFirst({
                    where: { businessId: catalogId, status: 'pending' },
                    orderBy: { submittedAt: 'desc' },
                });

            if (verificationRecord) {
                await this.prisma.verification.update({
                    where: { id: verificationRecord.id },
                    data: {
                        status: 'approved',
                        tier: body.tier,
                        reviewedByUserId: adminUserId,
                        reviewedAt: new Date(),
                    },
                });

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

            await this.prisma.business.update({
                where: { id: catalogId },
                data: {
                    verificationStatus: 'rejected',
                    updatedAt: new Date(),
                },
            });

            const verificationRecord = body.verificationId
                ? await this.prisma.verification.findUnique({ where: { id: body.verificationId } })
                : await this.prisma.verification.findFirst({
                    where: { businessId: catalogId, status: 'pending' },
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