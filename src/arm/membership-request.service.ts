// src/arm/membership-request.service.ts
import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogPublishService } from '../common/services/catalog-publish.service';
import { CacheHelper } from '../common/services/cache.helper';
import { checkMarketTypeMismatch } from '../common/utils/arm.utils';

export interface CreateMembershipRequestDto {
    roleType: 'buyer' | 'seller';
    businessId?: string;
    catalogId?: string;
    termsAccepted?: boolean;
}

/**
 * درخواست عضویت در بازار خصوصی — چرخهٔ کامل:
 *   کاربر: شرایط را می‌خواند → تیک می‌زند → خریدار/فروشنده را انتخاب می‌کند →
 *          کسب‌وکار (خریدار) یا کاتالوگ (فروشنده) را مشخص می‌کند → درخواست pending ثبت می‌شود
 *   مالک/ادمین بازار: در پنل «درخواست‌های عضویت» می‌بیند → تایید (ساخت عضویت فعال)
 *          یا رد با دلیل (کاربر در اعلان‌ها دلیل را می‌بیند)
 */
@Injectable()
export class MembershipRequestService {
    constructor(
        private prisma: PrismaService,
        private catalogPublish: CatalogPublishService,
        private cache: CacheHelper,
    ) {}

    // ============================================================
    // ثبت درخواست عضویت (کاربر لاگین‌کرده)
    // ============================================================
    async createRequest(userId: string, slug: string, dto: CreateMembershipRequestDto) {
        const arm = await this.prisma.arm.findUnique({ where: { slug } });
        if (!arm) {
            throw new NotFoundException({ errorCode: 'ARM_NOT_FOUND', message: 'بازار یافت نشد' });
        }
        if (!arm.isPrivate && dto.roleType !== 'seller') {
            // ✅ بازار عمومی: خریدار نیازی به درخواست ندارد (قیمت‌ها آزاد است؛ عضویت آنی از مسیر join)
            //    ولی فروشنده همیشه باید درخواست بدهد — تایید مدیر + افزودن کاتالوگ توسط مدیر
            throw new BadRequestException({
                errorCode: 'MARKET_NOT_PRIVATE',
                message: 'در بازار عمومی برای دیدن قیمت عضویت لازم نیست',
            });
        }
        if (arm.isPrivate && dto.termsAccepted !== true) {
            throw new BadRequestException({
                errorCode: 'TERMS_REQUIRED',
                message: 'برای ثبت درخواست باید شرایط عضویت را بپذیرید',
            });
        }
        const roleType = dto.roleType;
        if (roleType !== 'buyer' && roleType !== 'seller') {
            throw new BadRequestException({
                errorCode: 'INVALID_ROLE',
                message: 'نقش عضویت باید خریدار یا فروشنده باشد',
            });
        }

        // درخواست در انتظار تکراری نداریم
        const pending = await this.prisma.armMembershipRequest.findFirst({
            where: { armId: arm.id, userId, status: 'pending' },
            select: { id: true },
        });
        if (pending) {
            throw new BadRequestException({
                errorCode: 'REQUEST_ALREADY_PENDING',
                message: 'درخواست عضویت شما قبلاً ثبت شده و در انتظار بررسی است',
            });
        }

        const membership = await this.prisma.armMembership.findUnique({
            where: { armId_userId: { armId: arm.id, userId } },
        });

        let businessId: string | null = null;
        let catalogId: string | null = null;

        if (roleType === 'buyer') {
            // ✅ خریدار: باید کسب‌وکار مشخص کند (اگر نداشت فرانت لینک ثبت می‌دهد)
            if (!dto.businessId) {
                throw new BadRequestException({
                    errorCode: 'BUSINESS_REQUIRED',
                    message: 'برای عضویت به‌عنوان خریدار باید یکی از کسب‌وکارهایتان را انتخاب کنید',
                });
            }
            const biz = await this.prisma.business.findFirst({
                where: { id: dto.businessId, ownerUserId: userId, status: 'active' },
                select: { id: true },
            });
            if (!biz) {
                throw new BadRequestException({
                    errorCode: 'BUSINESS_NOT_FOUND',
                    message: 'کسب‌وکار انتخاب‌شده یافت نشد یا متعلق به شما نیست',
                });
            }
            businessId = biz.id;

            // قبلاً به‌عنوان خریدارِ فعال (با کسب‌وکار) عضو است؟
            // ⚠️ عضویت شخصیِ بدون businessId (مثل مالک بازار) شمرده نمی‌شود — او باید بتواند
            //    کسب‌وکارش را به‌عنوان خریدار/فروشنده اضافه کند
            if (
                membership?.status === 'active' &&
                membership.businessStatus === 'active' &&
                membership.businessId &&
                (membership.roleType === 'buyer' || membership.roleType === 'seller-buyer')
            ) {
                throw new BadRequestException({
                    errorCode: 'ALREADY_MEMBER',
                    message: 'شما قبلاً به‌عنوان خریدار در این بازار عضو شده‌اید',
                });
            }
        } else {
            // ✅ فروشنده: باید کاتالوگ مشخص کند (قیمت‌های همان کاتالوگ وارد بازار می‌شود)
            if (!dto.catalogId) {
                throw new BadRequestException({
                    errorCode: 'CATALOG_REQUIRED',
                    message: 'برای عضویت به‌عنوان فروشنده باید کاتالوگتان را انتخاب کنید',
                });
            }
            const catalog = await this.prisma.catalog.findUnique({
                where: { id: dto.catalogId },
                select: {
                    id: true, status: true, salesType: true,
                    business: { select: { id: true, ownerUserId: true } },
                },
            });
            if (!catalog || (catalog.business as any).ownerUserId !== userId) {
                throw new BadRequestException({
                    errorCode: 'CATALOG_NOT_FOUND',
                    message: 'کاتالوگ انتخاب‌شده یافت نشد یا متعلق به شما نیست',
                });
            }
            if (catalog.status !== 'active') {
                throw new BadRequestException({
                    errorCode: 'CATALOG_NOT_ACTIVE',
                    message: 'کاتالوگ انتخاب‌شده فعال نیست',
                });
            }
            // ✅ گارد تناسب نوع کاتالوگ با نوع بازار (عمده/خرده/خدمات)
            const typeMismatch = checkMarketTypeMismatch(arm, catalog.salesType);
            if (typeMismatch) {
                throw new BadRequestException({ errorCode: 'MARKET_TYPE_MISMATCH', message: typeMismatch });
            }
            catalogId = catalog.id;
            businessId = (catalog.business as any).id;

            // همین کاتالوگ قبلاً منتشر شده؟
            if (
                membership?.status === 'active' &&
                membership.publishState === 'published' &&
                membership.catalogId === catalogId
            ) {
                throw new BadRequestException({
                    errorCode: 'ALREADY_MEMBER',
                    message: 'این کاتالوگ قبلاً در این بازار منتشر شده است',
                });
            }
        }

        const request = await this.prisma.armMembershipRequest.create({
            data: {
                armId: arm.id,
                userId,
                roleType,
                businessId,
                catalogId,
                status: 'pending',
            },
            include: {
                arm: { select: { name: true, slug: true } },
                business: { select: { name: true } },
                catalog: { select: { name: true } },
            },
        });

        // ✅ تاریخچه — ثبت درخواست (درخواستِ به‌تنهایی عضو نمی‌کند؛ تاییدِ مدیر سازندهٔ عضویت است)
        try {
            await this.prisma.armMembershipEvent.create({
                data: {
                    armId: arm.id,
                    userId,
                    eventType: 'request_submitted',
                    actorUserId: userId,
                    note: `درخواست ${roleType === 'seller' ? 'فروشندگی' : 'خریداری'}`,
                },
            });
        } catch (err) {
            console.error('membership-request: event log failed:', err);
        }

        return request;
    }

    // ============================================================
    // وضعیت آخرین درخواست من در این بازار + خلاصهٔ عضویت
    // ============================================================
    async getMyRequest(userId: string, slug: string) {
        const arm = await this.prisma.arm.findUnique({
            where: { slug },
            select: { id: true, name: true, slug: true, isPrivate: true, membershipTerms: true },
        });
        if (!arm) {
            throw new NotFoundException({ errorCode: 'ARM_NOT_FOUND', message: 'بازار یافت نشد' });
        }

        const [request, membership] = await Promise.all([
            this.prisma.armMembershipRequest.findFirst({
                where: { armId: arm.id, userId },
                orderBy: { createdAt: 'desc' },
                include: {
                    business: { select: { name: true } },
                    catalog: { select: { name: true } },
                },
            }),
            this.prisma.armMembership.findUnique({
                where: { armId_userId: { armId: arm.id, userId } },
                select: {
                    status: true, businessStatus: true, roleType: true, role: true,
                    publishState: true, businessId: true, catalogId: true,
                    joinedAt: true, leftAt: true, selfRemovedCatalog: true,
                },
            }),
        ]);

        return { arm, request, membership };
    }

    // ============================================================
    // لیست درخواست‌های عضویت — پنل مالک/ادمین بازار
    // ============================================================
    async listRequests(slug: string, status?: string, page = 1, limit = 20) {
        const arm = await this.prisma.arm.findUnique({
            where: { slug },
            select: { id: true },
        });
        if (!arm) {
            throw new NotFoundException({ errorCode: 'ARM_NOT_FOUND', message: 'بازار یافت نشد' });
        }

        const where: any = { armId: arm.id };
        if (status && ['pending', 'approved', 'rejected'].includes(status)) {
            where.status = status;
        }

        const [items, total, pendingCount] = await Promise.all([
            this.prisma.armMembershipRequest.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: (Math.max(1, page) - 1) * limit,
                take: limit,
                include: {
                    user: { select: { id: true, fullName: true, phone: true, avatarUrl: true } },
                    business: {
                        select: {
                            id: true, name: true, type: true, city: true, province: true,
                            cityCode: true, provinceCode: true, status: true, logoUrl: true,
                        },
                    },
                    catalog: {
                        select: { id: true, name: true, slug: true, logoUrl: true, status: true, industryName: true },
                    },
                },
            }),
            this.prisma.armMembershipRequest.count({ where }),
            this.prisma.armMembershipRequest.count({ where: { armId: arm.id, status: 'pending' } }),
        ]);

        return { items, pagination: { total, page: Math.max(1, page), limit, totalPages: Math.ceil(total / limit) || 1 }, pendingCount };
    }

    // ============================================================
    // تصمیم مالک/ادمین — تایید یا رد
    // ============================================================
    async decideRequest(
        slug: string,
        requestId: string,
        action: 'approve' | 'reject',
        adminUserId: string,
        reason?: string,
    ) {
        const arm = await this.prisma.arm.findUnique({ where: { slug } });
        if (!arm) {
            throw new NotFoundException({ errorCode: 'ARM_NOT_FOUND', message: 'بازار یافت نشد' });
        }

        const request = await this.prisma.armMembershipRequest.findFirst({
            where: { id: requestId, armId: arm.id },
            include: {
                catalog: { select: { id: true, salesType: true } },
            },
        });
        if (!request) {
            throw new NotFoundException({ errorCode: 'REQUEST_NOT_FOUND', message: 'درخواست عضویت یافت نشد' });
        }
        if (request.status !== 'pending') {
            throw new BadRequestException({
                errorCode: 'NOT_PENDING',
                message: 'این درخواست قبلاً بررسی شده است',
            });
        }

        // ─── رد ───
        if (action === 'reject') {
            if (!reason || !reason.trim()) {
                throw new BadRequestException({ errorCode: 'REASON_REQUIRED', message: 'دلیل رد الزامی است' });
            }
            const updated = await this.prisma.armMembershipRequest.update({
                where: { id: request.id },
                data: {
                    status: 'rejected',
                    rejectReason: reason.trim(),
                    reviewedByUserId: adminUserId,
                    reviewedAt: new Date(),
                },
            });
            try {
                await this.prisma.armMembershipEvent.create({
                    data: {
                        armId: arm.id, userId: request.userId, eventType: 'request_rejected',
                        actorUserId: adminUserId, note: reason.trim(),
                    },
                });
            } catch (err) { console.error('membership-request: event log failed:', err); }
            return { request: updated, membership: null };
        }

        // ─── تایید ───
        const roleType = request.roleType as 'buyer' | 'seller';
        let catalogId: string | null = null;
        let businessId: string | null = request.businessId || null;

        if (roleType === 'seller') {
            catalogId = request.catalogId;
            // businessId از کاتالوگ تضمین می‌شود (در ثبت درخواست هم resolve شده)
            if (request.catalog?.salesType !== undefined) {
                const catalog = await this.prisma.catalog.findUnique({
                    where: { id: catalogId! },
                    select: { businessId: true },
                });
                businessId = catalog?.businessId || businessId;
            }
        }

        const existing = await this.prisma.armMembership.findUnique({
            where: { armId_userId: { armId: arm.id, userId: request.userId } },
        });

        // ✅ ادغام نقش — اگر عضویت با نقش دیگر موجود بود، دو-نقشی می‌شود
        const mergedRoleType =
            existing?.roleType && existing.roleType !== roleType
                ? 'seller-buyer'
                : roleType;

        let membership;
        const wasActiveMember = existing?.status === 'active';
        if (existing) {
            membership = await this.prisma.armMembership.update({
                where: { id: existing.id },
                data: {
                    status: 'active',
                    businessStatus: 'active',
                    roleType: mergedRoleType,
                    rejectionReason: null,
                    joinedAt: new Date(),       // ✅ تاریخ دقیق عضویت (مجدداً) ثبت می‌شود
                    leftAt: null,               // ✅ بازگشت → خروج قبلی بی‌اعتبار
                    selfRemovedCatalog: false,  // ✅ بازگشتِ فروشنده → ردِ خروج اختیاری پاک می‌شود
                    businessId: businessId || existing.businessId,
                    ...(catalogId ? { catalogId, publishState: 'published' } : {}),
                    source: 'membership_request',
                    reviewedByUserId: adminUserId,
                    reviewedAt: new Date(),
                    updatedAt: new Date(),
                },
            });
        } else {
            membership = await this.prisma.armMembership.create({
                data: {
                    armId: arm.id,
                    userId: request.userId,
                    role: 'arm_member' as any,
                    permissionLevel: 1,
                    status: 'active',
                    businessStatus: 'active',
                    roleType,
                    businessId,
                    ...(catalogId ? { catalogId, publishState: 'published' } : {}),
                    source: 'membership_request',
                    reviewedByUserId: adminUserId,
                    reviewedAt: new Date(),
                },
            });
        }

        // ✅ تاریخچه — تاییدِ درخواست = سازندهٔ عضویت
        try {
            await this.prisma.armMembershipEvent.create({
                data: {
                    armId: arm.id, userId: request.userId, eventType: 'request_approved',
                    actorUserId: adminUserId,
                    note: roleType === 'seller' ? 'تایید درخواست فروشندگی' : 'تایید درخواست خریداری',
                },
            });
            await this.prisma.armMembershipEvent.create({
                data: {
                    armId: arm.id, userId: request.userId,
                    eventType: wasActiveMember ? 'joined' : 'joined',
                    actorUserId: adminUserId,
                    note: wasActiveMember ? 'فعال‌سازی مجدد عضویت' : 'عضویت فعال شد',
                },
            });
        } catch (err) { console.error('membership-request: event log failed:', err); }

        // ✅ عضویت فروشنده فعال شد → کالاهای کاتالوگ منتشر و مهر بازار می‌خورند
        if (catalogId) {
            await this.prisma.ad.updateMany({
                where: { catalogId, status: 'active', publishToMarket: false },
                data: { publishToMarket: true },
            });
            try {
                await this.catalogPublish.stampCatalogAds(arm, catalogId, undefined, request.userId);
            } catch (err) {
                console.error(`membership-request: stampCatalogAds failed for arm ${arm.id}:`, err);
            }
        }

        const updated = await this.prisma.armMembershipRequest.update({
            where: { id: request.id },
            data: {
                status: 'approved',
                reviewedByUserId: adminUserId,
                reviewedAt: new Date(),
            },
        });

        // ⚠️ تعداد عضویت‌ها در پروفایل هست → کش پروفایل باطل
        await this.cache.bust(`profile:${request.userId}`);

        return { request: updated, membership };
    }
}
