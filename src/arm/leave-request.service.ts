// src/arm/leave-request.service.ts
import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogPublishService } from '../common/services/catalog-publish.service';
import { CacheHelper } from '../common/services/cache.helper';

export interface CreateLeaveRequestDto {
    roleType: 'buyer' | 'seller';
    catalogId?: string;
    businessId?: string;
    reason?: string;
}

/**
 * درخواست لغو عضویت — خروجِ عضو فقط با تصمیمِ مالکِ بازار:
 *
 *   عضو (خریدار از مدال عضویت بازار، فروشنده از بخش «انتشار در بازارها»ی پنل کاتالوگ)
 *     → درخواست لغو ثبت می‌کند (با دلیلِ اختیاری)
 *     → درخواست در پنل مالک (درخواست‌های لغو عضویت) می‌آید
 *     → مالک تایید می‌کند: عضویت لغو می‌شود (leftAt + leftVia=member_request + رویداد
 *       + selfRemovedCatalog برای فروشنده — تا اشتباهی دوباره اددش نکنند)
 *       یا با دلیل رد می‌کند (عضو می‌ماند و دلیل در اعلانش می‌رود).
 *
 *   عضو می‌تواند درخواستِ در انتظارش را پس بگیرد (withdrawn).
 *   همهٔ تاریخ‌ها دقیق ثبت می‌شوند — برای پروندهٔ عضویت/لغو عضویت و شکایت‌ها.
 */
@Injectable()
export class LeaveRequestService {
    constructor(
        private prisma: PrismaService,
        private catalogPublish: CatalogPublishService,
        private cache: CacheHelper,
    ) {}

    // ============================================================
    // ثبت درخواست لغو عضویت (خودِ عضو)
    // ============================================================
    async createRequest(userId: string, slug: string, dto: CreateLeaveRequestDto) {
        const arm = await this.prisma.arm.findUnique({ where: { slug } });
        if (!arm) {
            throw new NotFoundException({ errorCode: 'ARM_NOT_FOUND', message: 'بازار یافت نشد' });
        }

        const roleType = dto.roleType;
        if (roleType !== 'buyer' && roleType !== 'seller') {
            throw new BadRequestException({
                errorCode: 'INVALID_ROLE',
                message: 'نقش درخواست لغو باید خریدار یا فروشنده باشد',
            });
        }

        const membership = await this.prisma.armMembership.findUnique({
            where: { armId_userId: { armId: arm.id, userId } },
        });
        if (!membership || membership.status !== 'active') {
            throw new BadRequestException({
                errorCode: 'NOT_MEMBER',
                message: 'شما عضو فعال این بازار نیستید',
            });
        }
        if (membership.role === 'arm_owner' || membership.role === 'arm_admin') {
            throw new BadRequestException({
                errorCode: 'ADMIN_CANNOT_LEAVE',
                message: 'مالک/ادمین بازار نمی‌تواند درخواست لغو عضویت بدهد',
            });
        }

        // درخواستِ لغوِ در انتظارِ تکراری نداریم — یک عضو در یک بازار فقط یک درخواست باز می‌تواند داشته باشد
        const pending = await this.prisma.armLeaveRequest.findFirst({
            where: { armId: arm.id, userId, status: 'pending' },
            select: { id: true },
        });
        if (pending) {
            throw new BadRequestException({
                errorCode: 'LEAVE_REQUEST_ALREADY_PENDING',
                message: 'درخواست لغو عضویت شما قبلاً ثبت شده و در انتظار بررسی مالک بازار است',
            });
        }

        let catalogId: string | null = null;
        let businessId: string | null = null;

        if (roleType === 'seller') {
            // ✅ فروشنده: لغوِ لِینِ فروشندگیِ همان کاتالوگی که در بازار منتشر است
            if (!membership.catalogId) {
                throw new BadRequestException({
                    errorCode: 'NOT_SELLER',
                    message: 'شما به‌عنوان فروشنده در این بازار عضو نیستید',
                });
            }
            if (dto.catalogId && dto.catalogId !== membership.catalogId) {
                throw new BadRequestException({
                    errorCode: 'CATALOG_MISMATCH',
                    message: 'کاتالوگ ارسالی با کاتالوگ منتشرشده در این بازار یکی نیست',
                });
            }
            catalogId = membership.catalogId;
            businessId = membership.businessId || null;
        } else {
            // ✅ خریدار: لغوِ لِینِ خریداریِ کسب‌وکاری که با آن عضو شده
            if (!membership.businessId) {
                throw new BadRequestException({
                    errorCode: 'NOT_BUYER',
                    message: 'شما به‌عنوان خریدار در این بازار عضو نیستید',
                });
            }
            if (dto.businessId && dto.businessId !== membership.businessId) {
                throw new BadRequestException({
                    errorCode: 'BUSINESS_MISMATCH',
                    message: 'کسب‌وکار ارسالی با کسب‌وکار عضوِ این بازار یکی نیست',
                });
            }
            businessId = membership.businessId;
        }

        const reason = dto.reason?.trim() || null;

        const request = await this.prisma.armLeaveRequest.create({
            data: {
                armId: arm.id,
                userId,
                roleType,
                catalogId,
                businessId,
                status: 'pending',
                memberReason: reason,
            },
            include: {
                arm: { select: { name: true, slug: true } },
                business: { select: { name: true } },
                catalog: { select: { name: true } },
            },
        });

        // ✅ تاریخچه — درخواستِ به‌تنهایی لغو نمی‌کند؛ تاییدِ مالک لغو را نهایی می‌کند
        try {
            await this.prisma.armMembershipEvent.create({
                data: {
                    armId: arm.id,
                    userId,
                    eventType: 'leave_requested',
                    actorUserId: userId,
                    note: reason
                        ? `درخواست لغو ${roleType === 'seller' ? 'فروشندگی' : 'خریداری'} — دلیل: ${reason}`
                        : `درخواست لغو ${roleType === 'seller' ? 'فروشندگی' : 'خریداری'}`,
                },
            });
        } catch (err) {
            console.error('leave-request: event log failed:', err);
        }

        return request;
    }

    // ============================================================
    // پس‌گرفتن درخواست لغوِ در انتظار (خودِ عضو)
    // ============================================================
    async withdrawRequest(userId: string, slug: string) {
        const arm = await this.prisma.arm.findUnique({
            where: { slug },
            select: { id: true },
        });
        if (!arm) {
            throw new NotFoundException({ errorCode: 'ARM_NOT_FOUND', message: 'بازار یافت نشد' });
        }

        const request = await this.prisma.armLeaveRequest.findFirst({
            where: { armId: arm.id, userId, status: 'pending' },
        });
        if (!request) {
            throw new NotFoundException({
                errorCode: 'NO_PENDING_LEAVE_REQUEST',
                message: 'درخواست لغوِ در انتظاری ندارید',
            });
        }

        const updated = await this.prisma.armLeaveRequest.update({
            where: { id: request.id },
            data: { status: 'withdrawn', updatedAt: new Date() },
        });

        try {
            await this.prisma.armMembershipEvent.create({
                data: {
                    armId: arm.id,
                    userId,
                    eventType: 'leave_request_withdrawn',
                    actorUserId: userId,
                    note: 'پس‌گرفتن درخواست لغو عضویت توسط خود عضو',
                },
            });
        } catch (err) { console.error('leave-request: event log failed:', err); }

        return updated;
    }

    // ============================================================
    // وضعیت آخرین درخواست لغوی من در این بازار
    // ============================================================
    async getMyRequest(userId: string, slug: string) {
        const arm = await this.prisma.arm.findUnique({
            where: { slug },
            select: { id: true, name: true, slug: true },
        });
        if (!arm) {
            throw new NotFoundException({ errorCode: 'ARM_NOT_FOUND', message: 'بازار یافت نشد' });
        }

        const request = await this.prisma.armLeaveRequest.findFirst({
            where: { armId: arm.id, userId },
            orderBy: { createdAt: 'desc' },
            include: {
                business: { select: { name: true } },
                catalog: { select: { name: true } },
            },
        });

        return { arm, request };
    }

    // ============================================================
    // ✅ پاکسازی درخواست‌های یتیم:
    //   ۱) درخواست‌دهنده حذف شده
    //   ۲) درخواست‌دهنده دیگر عضوِ فعالِ این بازار نیست (عضویتش قبلاً برداشته شده)
    // ریشهٔ باگ «اعلان لغو عضویت بی‌مبنا»: درخواستِ pending می‌ماند ولی پنل
    // چیزی نشان نمی‌داد — countِ اعلان و لیستِ پنل باید یکی بمانند.
    // ============================================================
    async cleanupOrphanedRequests(armId?: string) {
        try {
            const reqs = await this.prisma.armLeaveRequest.findMany({
                where: { ...(armId ? { armId } : {}), status: 'pending' },
                select: { id: true, userId: true, armId: true },
            });
            if (reqs.length === 0) return 0;
            const userIds = [...new Set(reqs.map((r) => r.userId))];
            const [existing, memberships] = await Promise.all([
                this.prisma.user.findMany({
                    where: { id: { in: userIds } },
                    select: { id: true },
                }),
                this.prisma.armMembership.findMany({
                    where: { userId: { in: userIds }, status: 'active' },
                    select: { userId: true, armId: true },
                }),
            ]);
            const existingSet = new Set(existing.map((u) => u.id));
            const memberKey = new Set(memberships.map((m) => `${m.userId}:${m.armId}`));
            const orphanIds = reqs
                .filter((r) => !existingSet.has(r.userId) || !memberKey.has(`${r.userId}:${r.armId}`))
                .map((r) => r.id);
            if (orphanIds.length > 0) {
                await this.prisma.armLeaveRequest.deleteMany({ where: { id: { in: orphanIds } } });
                console.log(`🧹 ${orphanIds.length} orphaned leave request(s) removed — requester deleted or no longer a member`);
            }
            return orphanIds.length;
        } catch (e: any) {
            console.warn('⚠️ cleanupOrphanedRequests failed (non-blocking):', e?.message);
            return 0;
        }
    }

    // ============================================================
    // لیست درخواست‌های لغو عضویت — پنل مالک/ادمین بازار
    // ============================================================
    async listRequests(slug: string, status?: string, page = 1, limit = 20) {
        const arm = await this.prisma.arm.findUnique({
            where: { slug },
            select: { id: true },
        });
        if (!arm) {
            throw new NotFoundException({ errorCode: 'ARM_NOT_FOUND', message: 'بازار یافت نشد' });
        }

        // ✅ یتیم‌ها اول پاک شوند تا include user با کاربرِ حذف‌شده 500 ندهد
        await this.cleanupOrphanedRequests(arm.id);

        const where: any = { armId: arm.id };
        if (status && ['pending', 'approved', 'rejected', 'withdrawn'].includes(status)) {
            where.status = status;
        }

        const [items, total, pendingCount] = await Promise.all([
            this.prisma.armLeaveRequest.findMany({
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
            this.prisma.armLeaveRequest.count({ where }),
            this.prisma.armLeaveRequest.count({ where: { armId: arm.id, status: 'pending' } }),
        ]);

        // تاریخ عضویتِ هر درخواست‌دهنده — برای تصمیمِ آگاهانهٔ مالک
        const memberSince = new Map<string, Date>();
        const memberships = await this.prisma.armMembership.findMany({
            where: { armId: arm.id, userId: { in: items.map((i) => i.userId) } },
            select: { userId: true, joinedAt: true, roleType: true, catalogId: true, businessId: true },
        });
        for (const m of memberships) memberSince.set(m.userId, m.joinedAt);

        return {
            items: items.map((i) => ({ ...i, memberJoinedAt: memberSince.get(i.userId) ?? null })),
            pagination: { total, page: Math.max(1, page), limit, totalPages: Math.ceil(total / limit) || 1 },
            pendingCount,
        };
    }

    // ============================================================
    // تصمیم مالک/ادمین بازار — تاییدِ لغو یا ردِ درخواستِ لغو
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

        const request = await this.prisma.armLeaveRequest.findFirst({
            where: { id: requestId, armId: arm.id },
        });
        if (!request) {
            throw new NotFoundException({ errorCode: 'REQUEST_NOT_FOUND', message: 'درخواست لغو عضویت یافت نشد' });
        }
        if (request.status !== 'pending') {
            throw new BadRequestException({
                errorCode: 'NOT_PENDING',
                message: 'این درخواست قبلاً بررسی شده است',
            });
        }

        // ─── ردِ درخواستِ لغو — عضو می‌ماند ───
        if (action === 'reject') {
            if (!reason || !reason.trim()) {
                throw new BadRequestException({
                    errorCode: 'REASON_REQUIRED',
                    message: 'دلیل رد درخواست لغو الزامی است — در اعلان عضو می‌رود',
                });
            }
            const updated = await this.prisma.armLeaveRequest.update({
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
                        armId: arm.id, userId: request.userId, eventType: 'leave_request_rejected',
                        actorUserId: adminUserId, note: `درخواست لغو عضویت رد شد — عضویت برقرار است. دلیل: ${reason.trim()}`,
                    },
                });
            } catch (err) { console.error('leave-request: event log failed:', err); }
            return { request: updated, membership: null };
        }

        // ─── تاییدِ لغو — اجرای خروج بنا بر نقشِ درخواست ───
        const membership = await this.prisma.armMembership.findUnique({
            where: { armId_userId: { armId: arm.id, userId: request.userId } },
        });

        let updatedMembership;
        if (!membership || membership.status !== 'active') {
            // عضویت از قبل خاتمه یافته (مثلاً حذف مستقیم مالک) — درخواست را نهایی می‌کنیم
            updatedMembership = membership ?? null;
        } else if (request.roleType === 'seller' && membership.catalogId) {
            // ✅ لغوِ لِینِ فروشندگی — آگهی‌ها از تابلوی بازار برداشته می‌شوند
            await this.catalogPublish.unstampCatalogAds(membership.catalogId, arm.id);
            const keepsBuyerLane = !!membership.businessId;
            updatedMembership = await this.prisma.armMembership.update({
                where: { id: membership.id },
                data: {
                    catalogId: null,
                    publishState: null,
                    roleType: keepsBuyerLane ? 'buyer' : null,
                    status: keepsBuyerLane ? 'active' : 'removed',
                    selfRemovedCatalog: true,   // ✅ خودش خواستار خروج بود — گارد اددِ مجددِ اشتباهی
                    leftAt: new Date(),         // ✅ تاریخ دقیق لغو عضویت
                    leftVia: 'member_request',  // ✅ به‌خاطر درخواستِ خودِ عضو، با تایید مالک
                    updatedAt: new Date(),
                },
            });
        } else if (request.roleType === 'buyer' && membership.businessId) {
            // ✅ لغوِ لِینِ خریداری — اگر فروشنده هم هست، فروشندگی‌اش می‌ماند
            const keepsSellerLane = !!membership.catalogId;
            updatedMembership = await this.prisma.armMembership.update({
                where: { id: membership.id },
                data: {
                    businessId: null,
                    roleType: keepsSellerLane ? 'seller' : null,
                    status: keepsSellerLane ? 'active' : 'removed',
                    publishState: keepsSellerLane ? membership.publishState : null,
                    leftAt: new Date(),
                    leftVia: 'member_request',
                    updatedAt: new Date(),
                },
            });
        } else {
            // نقشِ درخواست با وضعیت فعلیِ عضویت نمی‌خواند (مثلاً نقش قبلاً برداشته شده)
            updatedMembership = membership;
        }

        const updated = await this.prisma.armLeaveRequest.update({
            where: { id: request.id },
            data: {
                status: 'approved',
                reviewedByUserId: adminUserId,
                reviewedAt: new Date(),
            },
        });

        try {
            await this.prisma.armMembershipEvent.create({
                data: {
                    armId: arm.id, userId: request.userId, eventType: 'leave_request_approved',
                    actorUserId: adminUserId,
                    note: request.roleType === 'seller'
                        ? 'تایید درخواست لغو فروشندگی — کاتالوگ از بازار خارج شد'
                        : 'تایید درخواست لغو خریداری — نقش خریدار برداشته شد',
                },
            });
        } catch (err) { console.error('leave-request: event log failed:', err); }

        // ⚠️ شمارش عضویت پروفایل ممکن است عوض شود → کش باطل
        await this.cache.bust(`profile:${request.userId}`);

        return { request: updated, membership: updatedMembership };
    }
}
