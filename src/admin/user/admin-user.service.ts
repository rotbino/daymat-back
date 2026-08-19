// src/admin/user/admin-user.service.ts
import {BadRequestException, Injectable, NotFoundException} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {ArmRole} from "../../common/enums/prisma-enums";


@Injectable()
export class AdminUserService {
    constructor(private prisma: PrismaService) {}

    // ============================================================
    // لیست کاربران با فیلترهای پیشرفته
    // ============================================================
    async getUsers(query: {
        page?: number;
        limit?: number;
        search?: string;
        status?: string;
        role?: string;
        armSlug?: string;
        isPhoneVerified?: string;
        membershipTier?: string;
        startDate?: string;
        endDate?: string;
        sortBy?: string;
        sortOrder?: 'asc' | 'desc';
    }) {
        const {
            page = 1,
            limit = 20,
            search,
            status,
            role,
            armSlug,
            isPhoneVerified,
            membershipTier,
            startDate,
            endDate,
            sortBy = 'createdAt',
            sortOrder = 'desc',
        } = query;

        const skip = (Number(page) - 1) * Number(limit);
        const where: any = {};

        // جستجوی متن
        if (search) {
            where.OR = [
                { fullName: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search, mode: 'insensitive' } },
            ];
        }

        // فیلتر وضعیت
        if (status && status !== 'all') {
            where.status = status;
        }

        // فیلتر نقش
        if (role && role !== 'all') {
            where.role = role;
        }

        // فیلتر تایید موبایل
        if (isPhoneVerified === 'true') where.isPhoneVerified = true;
        if (isPhoneVerified === 'false') where.isPhoneVerified = false;

        // فیلتر عضویت
        if (membershipTier && membershipTier !== 'all') {
            where.membershipTier = membershipTier;
        }

        // فیلتر بازه زمانی عضویت
        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate) where.createdAt.gte = new Date(startDate);
            if (endDate) where.createdAt.lte = new Date(endDate + 'T23:59:59.999Z');
        }

        // فیلتر بر اساس بازار
        let armFilter: any = {};
        if (armSlug && armSlug !== 'all') {
            const arm = await this.prisma.arm.findUnique({
                where: { slug: armSlug },
                select: { id: true },
            });
            if (arm) {
                armFilter = { armMemberships: { some: { armId: arm.id } } };
            }
        }

        // سورت
        const orderByMap: Record<string, any> = {
            fullName: { fullName: sortOrder },
            phone: { phone: sortOrder },
            role: { role: sortOrder },
            status: { status: sortOrder },
            createdAt: { createdAt: sortOrder },
            lastLoginAt: { lastLoginAt: sortOrder || 'desc' },
            membershipTier: { membershipTier: sortOrder },
        };

        const [items, total] = await Promise.all([
            this.prisma.user.findMany({
                where: { ...where, ...armFilter },
                skip,
                take: Number(limit),
                select: {
                    id: true,
                    phone: true,
                    fullName: true,
                    avatarUrl: true,
                    status: true,
                    role: true,
                    locale: true,
                    isPhoneVerified: true,
                    membershipTier: true,
                    lastLoginAt: true,
                    createdAt: true,
                    _count: {
                        select: {
                            businesses: true,
                            armMemberships: true,
                            ads: true,
                            credits: true,
                        },
                    },
                },
                orderBy: orderByMap[sortBy] || { createdAt: 'desc' },
            }),
            this.prisma.user.count({ where: { ...where, ...armFilter } }),
        ]);

        // محاسبه آمار
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

        const [todayNew, weekNew, monthNew, totalActive, totalVerified] = await Promise.all([
            this.prisma.user.count({ where: { ...where, createdAt: { gte: today } } }),
            this.prisma.user.count({ where: { ...where, createdAt: { gte: weekAgo } } }),
            this.prisma.user.count({ where: { ...where, createdAt: { gte: monthAgo } } }),
            this.prisma.user.count({ where: { ...where, status: 'active' } }),
            this.prisma.user.count({ where: { ...where, isPhoneVerified: true } }),
        ]);

        return {
            items,
            pagination: {
                page: Number(page),
                limit: Number(limit),
                total,
                totalPages: Math.ceil(total / Number(limit)),
            },
            stats: {
                todayNew,
                weekNew,
                monthNew,
                totalActive,
                totalVerified,
                total,
            },
        };
    }

    // ============================================================
    // جزئیات کامل یک کاربر
    // ============================================================
    async getUserDetail(userId: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                phone: true,
                fullName: true,
                avatarUrl: true,
                status: true,
                role: true,
                locale: true,
                timezone: true,
                isPhoneVerified: true,
                phoneVerifiedAt: true,
                membershipTier: true,
                lastLoginAt: true,
                createdAt: true,
                updatedAt: true,
                businesses: {
                    select: {
                        id: true,
                        name: true,
                        type: true,
                        verificationTier: true,
                        trustScore: true,
                        city: true,
                        province: true,
                        status: true,
                        createdAt: true,
                        _count: { select: { ads: true } },
                    },
                    orderBy: { createdAt: 'desc' },
                },
                armMemberships: {
                    select: {
                        id: true,
                        role: true,
                        status: true,
                        joinedAt: true,
                        arm: {
                            select: {
                                id: true,
                                slug: true,
                                name: true,
                                colorPrimary: true,
                            },
                        },
                    },
                    orderBy: { joinedAt: 'desc' },
                },
                ads: {
                    select: {
                        id: true,
                        title: true,
                        unitPrice: true,
                        status: true,
                        createdAt: true,
                        arm: { select: { id: true, name: true, slug: true } },
                        category: { select: { id: true, title: true } },
                    },
                    orderBy: { createdAt: 'desc' },
                    take: 50,
                },
                credits: {
                    select: {
                        id: true,
                        amount: true,
                        creditCount: true,
                        creditType: true,
                        status: true,
                        transactionType: true,
                        description: true,
                        createdAt: true,
                        metadata: true,
                        arm: { select: { id: true, name: true, slug: true } },
                    },
                    orderBy: { createdAt: 'desc' },
                    take: 100,
                },
                creditRequests: {
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
                    orderBy: { createdAt: 'desc' },
                    take: 50,
                },
            },
        });

        if (!user) {
            throw new NotFoundException({
                errorCode: 'USER_NOT_FOUND',
                message: 'کاربر یافت نشد',
            });
        }

        // ترکیب تراکنش‌ها
        const allTransactions = [
            ...user.credits.map(c => ({
                id: c.id,
                type: 'credit' as const,
                amount: c.amount,
                creditCount: c.creditCount,
                status: c.status === 'success' ? 'موفق' : c.status === 'pending' ? 'در انتظار' : 'ناموفق',
                statusRaw: c.status,
                transactionType: c.transactionType,
                description: c.description || 'تراکنش',
                date: c.createdAt,
                arm: c.arm,
                metadata: c.metadata,
            })),
            ...user.creditRequests.map(cr => ({
                id: cr.id,
                type: 'creditRequest' as const,
                amount: cr.amount,
                creditCount: (cr.metadata as any)?.creditCount || 0,
                status: cr.status === 'approved' ? 'تأیید شده' : cr.status === 'rejected' ? 'رد شده' : 'در انتظار',
                statusRaw: cr.status,
                transactionType: 'manual_purchase',
                description: cr.receiptNote || 'خرید فیشی',
                date: cr.createdAt,
                arm: cr.arm,
                metadata: cr.metadata,
            })),
        ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        return {
            ...user,
            allTransactions,
            credits: undefined,
            creditRequests: undefined,
        };
    }

    // ============================================================
    // تغییر وضعیت کاربر
    // ============================================================
    async updateUserStatus(userId: string, status: string) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException({ errorCode: 'USER_NOT_FOUND', message: 'کاربر یافت نشد' });

        return this.prisma.user.update({
            where: { id: userId },
            data: { status },
            select: { id: true, status: true, fullName: true, phone: true },
        });
    }

    // ============================================================
    // دریافت لیست بازارها برای فیلتر
    // ============================================================
    async getArmsForFilter() {
        return this.prisma.arm.findMany({
            where: { status: 'active' },
            select: { id: true, slug: true, name: true },
            orderBy: { name: 'asc' },
        });
    }

    // تغییر نقش کاربر در یک بازو
    async updateArmMembershipRole(userId: string, armSlug: string, role: string) {
        // اعتبارسنجی نقش
        const validRoles = ['arm_owner', 'arm_seller', 'arm_buyer', 'arm_member'];
        if (!validRoles.includes(role)) {
            throw new BadRequestException({
                errorCode: 'INVALID_ROLE',
                message: 'نقش نامعتبر است',
            });
        }

        const arm = await this.prisma.arm.findUnique({
            where: { slug: armSlug },
            select: { id: true },
        });
        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازار مورد نظر یافت نشد',
            });
        }

        const membership = await this.prisma.armMembership.findFirst({
            where: { userId, armId: arm.id },
        });
        if (!membership) {
            throw new NotFoundException({
                errorCode: 'MEMBERSHIP_NOT_FOUND',
                message: 'این کاربر عضو این بازار نیست',
            });
        }

        return this.prisma.armMembership.update({
            where: { id: membership.id },
            data: { role: role as ArmRole }, // ✅
            select: { id: true, role: true, arm: { select: { slug: true, name: true } } },
        });
    }
}