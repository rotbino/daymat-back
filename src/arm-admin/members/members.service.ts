import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {SystemRole,ArmRole} from "../../common/enums/prisma-enums";


@Injectable()
export class MembersService {
    constructor(private prisma: PrismaService) {}

    // ============================================================
    // دریافت لیست اعضا با پیجینگ، فیلتر، جستجو و سورت
    // ============================================================
    // src/arm-admin/members/members.service.ts

// ============================================================
// دریافت لیست اعضا با پیجینگ، فیلتر، جستجو و سورت
// ============================================================
    async getMembers(
        slug: string,
        page: number = 1,
        limit: number = 20,
        search?: string,
        role?: ArmRole,
        status?: string,
        sortBy?: string,
        sortOrder: 'asc' | 'desc' = 'desc',
    ) {
        const arm = await this.prisma.arm.findUnique({
            where: { slug },
            select: { id: true },
        });

        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازار یافت نشد',
            });
        }

        const where: any = {
            armId: arm.id,
        };

        if (role) {
            where.role = role;
        }
        if (status && status !== 'all') {
            where.status = status;
        }

        if (search) {
            where.OR = [
                { user: { fullName: { contains: search, mode: 'insensitive' } } },
                { user: { phone: { contains: search, mode: 'insensitive' } } },
                { business: { name: { contains: search, mode: 'insensitive' } } },
            ];
        }

        const skip = (page - 1) * limit;

        // 🆕 وقتی فیلتر وضعیت فعال نیست و مرتب‌سازی خاصی درخواست نشده،
        // ابتدا همهٔ اعضای pending و سپس بقیه را برمی‌گردانیم.
        const useDefaultPrioritySort = !sortBy && (!status || status === 'all');

        if (useDefaultPrioritySort) {
            // دریافت همهٔ اعضای منطبق (بدون پیجینگ) – برای حجم‌های متوسط مناسب است
            const allMembers = await this.prisma.armMembership.findMany({
                where,
                include: {
                    user: {
                        select: {
                            id: true,
                            fullName: true,
                            phone: true,
                            isPhoneVerified: true,
                            avatarUrl: true,
                            role: true,
                        },
                    },
                    business: {
                        select: {
                            id: true,
                            name: true,
                            type: true,
                            verificationTier: true,
                            city: true,
                            province: true,
                            trustScore: true,
                        },
                    },
                },
            });

            // تفکیک بر اساس status
            const pendingMembers = allMembers.filter(m => m.status === 'pending');
            const otherMembers = allMembers.filter(m => m.status !== 'pending');

            // مرتب‌سازی هر گروه بر اساس joinedAt (نزولی)
            const sortByJoinedAtDesc = (a: any, b: any) =>
                new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime();

            pendingMembers.sort(sortByJoinedAtDesc);
            otherMembers.sort(sortByJoinedAtDesc);

            // ترکیب: ابتدا pending سپس دیگر اعضا
            const sortedMembers = [...pendingMembers, ...otherMembers];
            const total = sortedMembers.length;
            const items = sortedMembers.slice(skip, skip + limit);

            // فرمت‌دهی نهایی
            const formattedItems = items.map(item => ({
                ...item,
                roleDisplay: this.getRoleDisplay(item.role as ArmRole), // ← تبدیل نوع
                user: {
                    id: item.user.id,
                    fullName: item.user.fullName,
                    phone: item.user.phone,
                    isPhoneVerified: item.user.isPhoneVerified,
                    avatarUrl: item.user.avatarUrl,
                    systemRoleDisplay: this.getSystemRoleDisplay(item.user.role as SystemRole), // ← تبدیل نوع
                },
            }));

            return {
                items: formattedItems,
                pagination: {
                    page: Number(page),
                    limit: Number(limit),
                    total,
                    totalPages: Math.ceil(total / Number(limit)),
                },
            };
        }

        // در غیر این صورت، همان منطق قبلی با orderBy اجرا می‌شود
        let orderBy: any = {};
        switch (sortBy) {
            case 'name': orderBy = { user: { fullName: sortOrder } }; break;
            case 'phone': orderBy = { user: { phone: sortOrder } }; break;
            case 'role': orderBy = { role: sortOrder }; break;
            case 'status': orderBy = { status: sortOrder }; break;
            case 'joinedAt':
            default: orderBy = { joinedAt: sortOrder }; break;
        }

        try {
            const [items, total] = await Promise.all([
                this.prisma.armMembership.findMany({
                    where,
                    skip,
                    take: Number(limit),
                    include: {
                        user: {
                            select: {
                                id: true,
                                fullName: true,
                                phone: true,
                                isPhoneVerified: true,
                                avatarUrl: true,
                                role: true,
                            },
                        },
                        business: {
                            select: {
                                id: true,
                                name: true,
                                type: true,
                                verificationTier: true,
                                city: true,
                                province: true,
                                trustScore: true,
                            },
                        },
                    },
                    orderBy,
                }),
                this.prisma.armMembership.count({ where }),
            ]);

            const validItems = items.filter(item => item.user !== null);
            const formattedItems = validItems.map(item => ({
                ...item,
                roleDisplay: this.getRoleDisplay(item.role as ArmRole), // ← تبدیل نوع
                user: {
                    id: item.user.id,
                    fullName: item.user.fullName,
                    phone: item.user.phone,
                    isPhoneVerified: item.user.isPhoneVerified,
                    avatarUrl: item.user.avatarUrl,
                    systemRoleDisplay: this.getSystemRoleDisplay(item.user.role as SystemRole), // ← تبدیل نوع
                },
            }));

            return {
                items: formattedItems,
                pagination: {
                    page: Number(page),
                    limit: Number(limit),
                    total,
                    totalPages: Math.ceil(total / Number(limit)),
                },
            };
        } catch (error) {
            console.error('Error fetching members:', error);
            return {
                items: [],
                pagination: {
                    page: Number(page),
                    limit: Number(limit),
                    total: 0,
                    totalPages: 0,
                },
            };
        }
    }
    // ============================================================
    // دریافت یک عضو با جزئیات کامل
    // ============================================================
    async getMember(slug: string, userId: string) {
        const arm = await this.prisma.arm.findUnique({
            where: { slug },
            select: { id: true },
        });

        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازار یافت نشد',
            });
        }

        // ۱. اطلاعات عضو (با درج فعالیت‌ها و سایر اطلاعات مربوط به کسب‌وکار)
        const member = await this.prisma.armMembership.findFirst({
            where: {
                armId: arm.id,
                userId,
            },
            include: {
                user: {
                    select: {
                        id: true,
                        fullName: true,
                        phone: true,
                        isPhoneVerified: true,
                        avatarUrl: true,
                        role: true,
                    },
                },
                business: {
                    include: {
                        ads: {
                            where: { status: 'active' },
                            select: { id: true, title: true, unitPrice: true, createdAt: true },
                            take: 10,
                            orderBy: { createdAt: 'desc' },
                        },
                        // ✅ فعالیت‌های کسب‌وکار
                        activities: {
                            include: {
                                activity: {
                                    select: { id: true, title: true },
                                },
                            },
                        },
                    },
                },
            },
        });

        if (!member) {
            throw new NotFoundException({
                errorCode: 'MEMBER_NOT_FOUND',
                message: 'عضو یافت نشد',
            });
        }

        // ✅ تبدیل فعالیت‌ها به آرایه‌ای از { id, title }
        if (member.business) {
            (member.business as any).activities = member.business.activities.map(
                (ba: any) => ba.activity
            );
        }

        // ۲. دریافت همه تراکنش‌های کاربر در این بازار
        let credits: any[] = [];
        let creditRequests: any[] = [];

        try {
            credits = await this.prisma.credit.findMany({
                where: {
                    armId: arm.id,
                    userId: userId,
                },
                select: {
                    id: true,
                    amount: true,
                    creditCount: true,
                    status: true,
                    transactionType: true,
                    description: true,
                    createdAt: true,
                    metadata: true,
                },
                orderBy: { createdAt: 'desc' },
                take: 50,
            });

            creditRequests = await this.prisma.creditRequest.findMany({
                where: {
                    armId: arm.id,
                    userId: userId,
                },
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
                },
                orderBy: { createdAt: 'desc' },
                take: 50,
            });
        } catch (error) {
            console.error('❌ Error fetching transactions:', error);
        }

        // ۳. ترکیب و فرمت‌دهی
        const allTransactions = [
            ...credits.map(c => ({
                id: c.id,
                amount: c.amount,
                creditCount: c.creditCount || 0,
                status: c.status || 'success',
                statusLabel: c.status === 'success' ? 'موفق' : c.status === 'pending' ? 'در انتظار' : 'ناموفق',
                transactionType: c.transactionType,
                description: c.description || 'تراکنش',
                createdAt: c.createdAt,
                metadata: c.metadata,
                isCreditRequest: false,
            })),
            ...creditRequests.map(cr => ({
                id: cr.id,
                amount: cr.amount,
                creditCount: cr.metadata?.creditCount || 0,
                status: cr.status,
                statusLabel: cr.status === 'approved' ? 'تأیید شده' : cr.status === 'rejected' ? 'رد شده' : 'در انتظار',
                transactionType: 'manual_purchase',
                description: cr.receiptNote || 'خرید فیشی',
                createdAt: cr.createdAt,
                metadata: cr.metadata,
                isCreditRequest: true,
            })),
        ];

        allTransactions.sort((a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );

        return {
            ...member,
            roleDisplay: this.getRoleDisplay(member.role as ArmRole), // ← تبدیل نوع
            systemRoleDisplay: this.getSystemRoleDisplay(member.user.role as SystemRole), // ← تبدیل نوع
            allTransactions,
            _debug: {
                creditsCount: credits.length,
                creditRequestsCount: creditRequests.length,
                totalTransactions: allTransactions.length,
            },
        };
    }

    // ============================================================
    // تغییر نقش عضو
    // ============================================================
    async updateMemberRole(slug: string, userId: string, newRole: ArmRole) {
        const arm = await this.prisma.arm.findUnique({
            where: { slug },
            select: { id: true },
        });

        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازار یافت نشد',
            });
        }

        return this.prisma.armMembership.update({
            where: {
                armId_userId: {
                    armId: arm.id,
                    userId,
                },
            },
            data: { role: newRole },
        });
    }

    // ============================================================
    // تغییر وضعیت عضو
    // ============================================================
    async updateMemberStatus(slug: string, userId: string, status: string) {
        const arm = await this.prisma.arm.findUnique({
            where: { slug },
            select: { id: true },
        });

        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازار یافت نشد',
            });
        }

        return this.prisma.armMembership.update({
            where: {
                armId_userId: {
                    armId: arm.id,
                    userId,
                },
            },
            data: { status },
        });
    }

    // ============================================================
    // متدهای کمکی برای نمایش نقش‌ها
    // ============================================================

    private getRoleDisplay(role: ArmRole): string {
        const roleMap: Record<ArmRole, string> = {
            [ArmRole.arm_owner]: 'مالک بازار',
            [ArmRole.arm_seller]: 'فروشنده',
            [ArmRole.arm_buyer]: 'خریدار',
            [ArmRole.arm_member]: 'عضو',
        };
        return roleMap[role] || role;
    }

    private getSystemRoleDisplay(role: SystemRole): string {
        const roleMap: Record<SystemRole, string> = {
            [SystemRole.system_admin]: 'مدیر سیستم',
            [SystemRole.system_user]: 'کاربر عادی',
        };
        return roleMap[role] || role;
    }

    private getStatusDisplay(status: string): string {
        const statusMap: Record<string, string> = {
            active: 'فعال',
            paused: 'متوقف',
            banned: 'مسدود',
        };
        return statusMap[status] || status;
    }

    // ============================================================
// تأیید عضویت کاربر
// ============================================================
    async approveMember(slug: string, userId: string, adminUserId: string) {
        const arm = await this.prisma.arm.findUnique({
            where: { slug },
            select: { id: true },
        });

        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازار یافت نشد',
            });
        }

        const membership = await this.prisma.armMembership.findFirst({
            where: { armId: arm.id, userId, status: 'pending' },
        });

        if (!membership) {
            throw new BadRequestException({
                errorCode: 'NOT_PENDING',
                message: 'عضویت در انتظار یافت نشد',
            });
        }

        return this.prisma.armMembership.update({
            where: { id: membership.id },
            data: {
                status: 'active',
                rejectionReason: null,
                reviewedByUserId: adminUserId,
                reviewedAt: new Date(),
                updatedAt: new Date(),
            },
        });
    }

// ============================================================
// رد عضویت کاربر
// ============================================================
    async rejectMember(slug: string, userId: string, reason: string, adminUserId: string) {
        if (!reason || !reason.trim()) {
            throw new BadRequestException({
                errorCode: 'REASON_REQUIRED',
                message: 'دلیل رد الزامی است',
            });
        }

        const arm = await this.prisma.arm.findUnique({
            where: { slug },
            select: { id: true },
        });

        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازار یافت نشد',
            });
        }

        const membership = await this.prisma.armMembership.findFirst({
            where: { armId: arm.id, userId, status: 'pending' },
        });

        if (!membership) {
            throw new BadRequestException({
                errorCode: 'NOT_PENDING',
                message: 'عضویت در انتظار یافت نشد',
            });
        }

        return this.prisma.armMembership.update({
            where: { id: membership.id },
            data: {
                status: 'rejected',
                rejectionReason: reason.trim(),
                reviewedByUserId: adminUserId,
                reviewedAt: new Date(),
                updatedAt: new Date(),
            },
        });
    }

    // ============================================================
// حذف کامل عضویت (خروج از بازار)
// ============================================================
    async removeMember(slug: string, userId: string, adminUserId: string) {
        const arm = await this.prisma.arm.findUnique({
            where: { slug },
            select: { id: true },
        });

        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازار یافت نشد',
            });
        }

        const membership = await this.prisma.armMembership.findFirst({
            where: { armId: arm.id, userId },
        });

        if (!membership) {
            throw new NotFoundException({
                errorCode: 'MEMBER_NOT_FOUND',
                message: 'عضو یافت نشد',
            });
        }

        return this.prisma.armMembership.update({
            where: { id: membership.id },
            data: {
                status: 'removed',              // وضعیت جدید
                reviewedByUserId: adminUserId,
                reviewedAt: new Date(),
                updatedAt: new Date(),
            },
        });
    }
}