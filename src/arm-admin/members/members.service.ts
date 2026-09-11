// src/arm-admin/members/members.service.ts
import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemRole, ArmRole } from '../../common/enums/prisma-enums';
import { CatalogPublishService } from '../../common/services/catalog-publish.service';
import { CacheHelper } from '../../common/services/cache.helper';

@Injectable()
export class MembersService {
    constructor(
        private prisma: PrismaService,
        private catalogPublish: CatalogPublishService,
        private cache: CacheHelper,
    ) {}

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
                // ✅ مونگو: بدون mode:'insensitive' — پایدارتر
                { user: { is: { fullName: { contains: search } } } },
                { user: { is: { phone: { contains: search } } } },
                { catalog: { is: { name: { contains: search } } } },
            ];
        }

        const skip = (page - 1) * limit;

        // 🆕 وقتی فیلتر وضعیت فعال نیست و مرتب‌سازی خاصی درخواست نشده،
        // ابتدا همهٔ اعضای pending و سپس بقیه را برمی‌گردانیم.
        const useDefaultPrioritySort = !sortBy && (!status || status === 'all');

        // ✅ include مشترک — رلیشن‌ها با include (نه select) تا آبجکت برگردند
        const MEMBER_INCLUDE = {
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
            catalog: {
                select: {
                    id: true,
                    name: true,
                    type: true,
                    city: true,
                    province: true,
                    // ✅ تیک اعتماد از مسیر نهاد
                    business: { select: { verificationTier: true } },
                },
            },
        };

        if (useDefaultPrioritySort) {
            const allMembers = await this.prisma.armMembership.findMany({
                where,
                include: MEMBER_INCLUDE,
            });

            const pendingMembers = allMembers.filter((m) => m.status === 'pending');
            const otherMembers = allMembers.filter((m) => m.status !== 'pending');

            const sortByJoinedAtDesc = (a: any, b: any) =>
                new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime();

            pendingMembers.sort(sortByJoinedAtDesc);
            otherMembers.sort(sortByJoinedAtDesc);

            const sortedMembers = [...pendingMembers, ...otherMembers];
            const total = sortedMembers.length;
            const items = sortedMembers.slice(skip, skip + limit);

            const formattedItems = items.map((item: any) => ({
                ...item,
                // ✅ شکل قدیمی catalog برای فرانت (verificationTier سطح اول)
                catalog: item.catalog ? {
                    ...item.catalog,
                    verificationTier: (item.catalog as any)?.business?.verificationTier ?? null,
                } : null,
                roleDisplay: this.getRoleDisplay(item.role as ArmRole),
                user: {
                    id: item.user.id,
                    fullName: item.user.fullName,
                    phone: item.user.phone,
                    isPhoneVerified: item.user.isPhoneVerified,
                    avatarUrl: item.user.avatarUrl,
                    systemRoleDisplay: this.getSystemRoleDisplay(item.user.role as SystemRole),
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
                    include: MEMBER_INCLUDE,
                    orderBy,
                }),
                this.prisma.armMembership.count({ where }),
            ]);

            const validItems = items.filter((item: any) => item.user !== null);
            const formattedItems = validItems.map((item: any) => ({
                ...item,
                catalog: item.catalog ? {
                    ...item.catalog,
                    verificationTier: (item.catalog as any)?.business?.verificationTier ?? null,
                } : null,
                roleDisplay: this.getRoleDisplay(item.role as ArmRole),
                user: {
                    id: item.user.id,
                    fullName: item.user.fullName,
                    phone: item.user.phone,
                    isPhoneVerified: item.user.isPhoneVerified,
                    avatarUrl: item.user.avatarUrl,
                    systemRoleDisplay: this.getSystemRoleDisplay(item.user.role as SystemRole),
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

        // ۱. اطلاعات عضو — کاتالوگ با include کامل؛ فعالیت‌ها از مسیر نهاد
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
                catalog: {
                    include: {
                        ads: {
                            where: { status: 'active' },
                            select: { id: true, title: true, unitPrice: true, createdAt: true },
                            take: 10,
                            orderBy: { createdAt: 'desc' },
                        },
                        // ✅ فعالیت‌ها از مسیر نهادِ کاتالوگ
                        business: {
                            include: {
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
                },
            },
        });

        if (!member) {
            throw new NotFoundException({
                errorCode: 'MEMBER_NOT_FOUND',
                message: 'عضو یافت نشد',
            });
        }

        // ✅ فعالیت‌ها را به شکل قدیمی روی کاتالوگ map کن
        if (member.catalog) {
            (member.catalog as any).activities =
                ((member.catalog as any).business as any)?.activities?.map((ba: any) => ba.activity) ?? [];
        }

        // ۲. تراکنش‌های کاربر در این بازار
        let credits: any[] = [];
        let creditRequests: any[] = [];

        try {
            credits = await this.prisma.credit.findMany({
                where: {
                    armId: arm.id,
                    userId,
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
                    userId,
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
            ...credits.map((c) => ({
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
            ...creditRequests.map((cr) => ({
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
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );

        return {
            ...member,
            roleDisplay: this.getRoleDisplay(member.role as ArmRole),
            systemRoleDisplay: this.getSystemRoleDisplay(member.user.role as SystemRole),
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

        // ✅ چون یک کاربر ممکن است چند membership در یک بازار داشته باشد
        // (با business های مختلف)، اولین active را انتخاب می‌کنیم
        const membership = await this.prisma.armMembership.findFirst({
            where: { armId: arm.id, userId, status: 'active' },
        });
        if (!membership) {
            throw new NotFoundException({
                errorCode: 'MEMBER_NOT_FOUND',
                message: 'عضو یافت نشد',
            });
        }

        return this.prisma.armMembership.update({
            where: { id: membership.id },
            data: { role: newRole },
        });
    }

    // ============================================================
    // تغییر وضعیت عضو
    // ============================================================
    async updateMemberStatus(slug: string, userId: string, status: string) {
        const arm = await this.prisma.arm.findUnique({
            where: { slug },
            select: { id: true, categoryTree: true },
        });

        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازار یافت نشد',
            });
        }

        // ✅ چون یک کاربر ممکن است چند membership در یک بازار داشته باشد
        const membership = await this.prisma.armMembership.findFirst({
            where: { armId: arm.id, userId },
            orderBy: { joinedAt: 'desc' },
        });
        if (!membership) {
            throw new NotFoundException({
                errorCode: 'MEMBER_NOT_FOUND',
                message: 'عضو یافت نشد',
            });
        }

        // ✅ اثر بر تابلوی بازار:
        //    غیرفعال (paused/banned/removed) → برداشتن مهر آگهی‌ها
        //    فعال + کاتالوگِ منتشرشده → مهر مجدد
        if (membership.catalogId) {
            if (status !== 'active') {
                await this.catalogPublish.unstampCatalogAds(membership.catalogId, arm.id);
            } else if (membership.publishState === 'published') {
                await this.catalogPublish.stampCatalogAds(arm, membership.catalogId);
            }
        }

        // ✅ status سیستمی فقط برای banned/removed استفاده می‌شه
        //    pause/resume فقط businessStatus رو تغییر می‌ده
        const updateData: any = {};
        if (status === 'banned' || status === 'removed') {
            updateData.status = status;
            updateData.businessStatus = 'paused';
        } else if (status === 'active') {
            updateData.status = 'active';
            updateData.businessStatus = 'active';
        } else {
            // paused → فقط businessStatus
            updateData.businessStatus = 'paused';
        }

        return this.prisma.armMembership.update({
            where: { id: membership.id },
            data: updateData,
        });
    }

    // ============================================================
    // متدهای کمکی برای نمایش نقش‌ها
    // ============================================================

    private getRoleDisplay(role: ArmRole): string {
        const roleMap: Record<ArmRole, string> = {
            [ArmRole.arm_owner]: 'مالک بازار',
            [ArmRole.arm_admin]: 'ادمین بازار',
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
    // تأیید پیوستن کاربر
    // ============================================================
    async approveMember(slug: string, userId: string, adminUserId: string) {
        const arm = await this.prisma.arm.findUnique({
            where: { slug },
            select: { id: true, categoryTree: true },
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
                message: 'پیوستن به در انتظار یافت نشد',
            });
        }

        const updated = await this.prisma.armMembership.update({
            where: { id: membership.id },
            data: {
                status: 'active',
                rejectionReason: null,
                reviewedByUserId: adminUserId,
                reviewedAt: new Date(),
                updatedAt: new Date(),
            },
        });

        // ✅ اگر کاتالوگِ منتشرشده دارد → کالاهایش روی تابلو بیاید
        if (membership.catalogId && membership.publishState === 'published') {
            await this.catalogPublish.stampCatalogAds(arm, membership.catalogId);
        }

        return updated;
    }

    // ============================================================
    // رد پیوستن کاربر
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
                message: 'پیوستن به در انتظار یافت نشد',
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
    // حذف کامل عضو (خروج از بازار)
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

        // ✅ کالاهایش از تابلوی این بازار برداشته شود
        if (membership.catalogId) {
            await this.catalogPublish.unstampCatalogAds(membership.catalogId, arm.id);
        }

        return this.prisma.armMembership.update({
            where: { id: membership.id },
            data: {
                status: 'removed',
                publishState: null,
                reviewedByUserId: adminUserId,
                reviewedAt: new Date(),
                updatedAt: new Date(),
            },
        });
    }

    // ============================================================
    // ادمین‌های بازار — منصوبِ مالک؛ غیر از مالک است و وظایف واگذارشده را انجام می‌دهد
    //   • لیست ادمین‌ها: مالک یا ادمین
    //   • انتصاب/عزل: فقط مالک بازار (یا مدیر سیستم)
    // ============================================================
    private async getArmOrThrow(slug: string) {
        const arm = await this.prisma.arm.findUnique({
            where: { slug },
            select: { id: true, name: true },
        });
        if (!arm) {
            throw new NotFoundException({ errorCode: 'ARM_NOT_FOUND', message: 'بازار یافت نشد' });
        }
        return arm;
    }

    async getAdmins(slug: string) {
        const arm = await this.getArmOrThrow(slug);

        const admins = await this.prisma.armMembership.findMany({
            where: { armId: arm.id, role: 'arm_admin', status: { in: ['active', 'paused'] } },
            orderBy: { joinedAt: 'desc' },
            select: {
                id: true,
                userId: true,
                status: true,
                joinedAt: true,
                businessId: true,
                catalogId: true,
                user: { select: { id: true, fullName: true, phone: true, avatarUrl: true } },
                business: { select: { id: true, name: true } },
                catalog: { select: { id: true, name: true } },
            },
        });

        return { items: admins, total: admins.length };
    }

    /** انتصاب ادمین با شماره موبایل — اگر عضو نبود، عضویت شخصیِ ادمین ساخته می‌شود */
    async addAdminByPhone(slug: string, phone: string, ownerUserId: string) {
        const arm = await this.getArmOrThrow(slug);

        const normalized = phone.replace(/\s|-/g, '');
        const user = await this.prisma.user.findFirst({
            where: { phone: { in: [normalized, normalized.replace(/^0/, '+98'), normalized.replace(/^\+98/, '0')] } },
            select: { id: true, fullName: true, phone: true },
        });
        if (!user) {
            throw new NotFoundException({
                errorCode: 'USER_NOT_FOUND',
                message: 'کاربری با این شماره موبایل یافت نشد — ابتدا باید در دیمت ثبت‌نام کند',
            });
        }

        const existing = await this.prisma.armMembership.findUnique({
            where: { armId_userId: { armId: arm.id, userId: user.id } },
        });

        if (existing?.role === 'arm_owner') {
            throw new BadRequestException({ errorCode: 'IS_ARM_OWNER', message: 'این کاربر مالک بازار است' });
        }

        const data = existing
            ? this.prisma.armMembership.update({
                  where: { id: existing.id },
                  data: { role: 'arm_admin', status: 'active', source: 'owner_add', updatedAt: new Date() },
              })
            : this.prisma.armMembership.create({
                  data: {
                      armId: arm.id,
                      userId: user.id,
                      role: 'arm_admin',
                      status: 'active',
                      businessId: null,
                      source: 'owner_add',
                  },
              });

        const [membership] = await Promise.all([data, this.cacheBustProfile(user.id)]);

        return {
            membership,
            user,
            message: `${user.fullName || 'کاربر'} به‌عنوان ادمین بازار ${arm.name} منصوب شد`,
        };
    }

    /** عزل ادمین — نقش به عضو عادی برمی‌گردد (رابطهٔ کسب‌وکار/کاتالوگ حفظ می‌شود) */
    async removeAdmin(slug: string, userId: string, ownerUserId: string) {
        const arm = await this.getArmOrThrow(slug);

        const membership = await this.prisma.armMembership.findFirst({
            where: { armId: arm.id, userId, role: 'arm_admin' },
        });
        if (!membership) {
            throw new NotFoundException({ errorCode: 'ADMIN_NOT_FOUND', message: 'این کاربر ادمین بازار نیست' });
        }

        const [updated] = await Promise.all([
            this.prisma.armMembership.update({
                where: { id: membership.id },
                data: { role: 'arm_member', updatedAt: new Date() },
            }),
            this.cacheBustProfile(userId),
        ]);

        return { membership: updated, message: 'ادمین بازار عزل شد' };
    }

    private async cacheBustProfile(userId: string) {
        try {
            await this.cache.bust(`profile:${userId}`);
        } catch {
            // bust بهترین‌تلاشی است — شکستش عضویت را نمی‌شکند
        }
    }
}