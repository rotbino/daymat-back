// src/business/business.service.ts
import {
    Injectable,
    NotFoundException,
    ForbiddenException,
    ConflictException,
    BadRequestException
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {CreateBusinessDto, RequestVerificationDto, UpdateBusinessDto} from './business.dto';
import {BusinessRole} from "../common/enums/prisma-enums";

@Injectable()
export class BusinessService {
    constructor(private prisma: PrismaService) {}

    // ============================================================
    // ثبت کسب‌وکار جدید
    // ============================================================
    // src/business/business.service.ts

    // src/business/business.service.ts

    async create(userId: string, dto: CreateBusinessDto) {
        // ۱. بررسی تکراری بودن نام
        const existing = await this.prisma.business.findFirst({
            where: {
                ownerUserId: userId,
                name: dto.name,
                status: 'active',
            },
        });

        if (existing) {
            throw new ConflictException({
                errorCode: 'DUPLICATE_BUSINESS_NAME',
                message: 'شما قبلاً یک کسب‌وکار با این نام ثبت کرده‌اید',
            });
        }

        // ۲. ایجاد کسب‌وکار
        const business = await this.prisma.business.create({
            data: {
                ownerUserId: userId,
                name: dto.name,
                shortDescription: dto.shortDescription || null,
                description: dto.description || '',
                type: dto.type,
                countryCode: dto.countryCode || '98',
                province: dto.province || '',
                city: dto.city || '',
                provinceCode: dto.provinceCode || null,
                cityCode: dto.cityCode || null,
                phone: dto.phone || '',
                logoUrl: dto.logoUrl || '',
                address: dto.address || '',
                website: dto.website || '',
                industryId: dto.industryId || null,
                verificationTier: 'none',
                verificationStatus: 'none',
                status: 'active',
            },
        });

        // ۳. ثبت فعالیت‌ها
        if (dto.activityIds?.length) {
            await this.prisma.businessActivity.createMany({
                data: dto.activityIds.map(activityId => ({
                    businessId: business.id,
                    activityId,
                })),
            });
        }

        // ۴. ثبت تیم‌ممبر
        await this.prisma.teamMember.create({
            data: {
                businessId: business.id,
                userId: userId,
                role: BusinessRole.business_owner,
                status: 'active',
                permissions: {
                    canManageBusiness: true,
                    canManageAds: true,
                    canManageTeam: true,
                },
            },
        });

        // ✅ ۵. به‌روزرسانی عضویت کاربر در بازار
        if (dto.armSlug) {
            const arm = await this.prisma.arm.findUnique({
                where: { slug: dto.armSlug },
                select: { id: true },
            });

            if (arm) {
                await this.prisma.armMembership.updateMany({
                    where: {
                        armId: arm.id,
                        userId: userId,
                        status: 'active',
                    },
                    data: {
                        businessId: business.id,
                    },
                });
            }
        }

        return business;
    }

/// ============================================================
    // ویرایش کسب‌وکار
    // ============================================================
    // src/business/business.service.ts - متد update رو اینطوری تغییر بده:

    // src/business/business.service.ts - متد update

    async update(id: string, userId: string, dto: UpdateBusinessDto) {
        await this.findOne(id, userId);

        // ⬇ لوگو - فقط fileId رو ذخیره کن
        if (dto.logoFileId) {
            await this.prisma.business.update({
                where: { id },
                data: { logoUrl: dto.logoFileId },
            });
        }

        // به‌روزرسانی اطلاعات اصلی
        const business = await this.prisma.business.update({
            where: { id },
            data: {
                name: dto.name,
                shortDescription: dto.shortDescription,
                type: dto.type,
                city: dto.city,
                province: dto.province,
                provinceCode: dto.provinceCode,
                cityCode: dto.cityCode,
                phone: dto.phone,
                description: dto.description,
                address: dto.address,
                website: dto.website,
                industryId: dto.industryId,
                updatedAt: new Date(),
            },
        });

        // ⬇ به‌روزرسانی position توی TeamMember
        if (dto.position !== undefined) {
            await this.prisma.teamMember.updateMany({
                where: { businessId: id, userId: userId },
                data: { position: dto.position || null },
            });
        }

        // ⬇ به‌روزرسانی فعالیت‌ها
        if (dto.activityIds !== undefined) {
            await this.prisma.$transaction([
                this.prisma.businessActivity.deleteMany({ where: { businessId: id } }),
                ...(dto.activityIds.length > 0
                    ? [this.prisma.businessActivity.createMany({
                        data: dto.activityIds.map(activityId => ({
                            businessId: id,
                            activityId,
                        })),
                    })]
                    : []),
            ]);
        }

        return business;
    }
    // ============================================================
    // لیست کسب‌وکارهای کاربر
    // ============================================================
    // src/business/business.service.ts

    // src/business/business.service.ts

    async findAllByUser(userId: string) {
        const businesses = await this.prisma.business.findMany({
            where: {
                ownerUserId: userId,
                status: { not: 'closed' },
            },
            include: {
                armMemberships: {
                    where: { status: { not: 'deleted' } },
                    include: {
                        arm: {
                            select: {
                                id: true,
                                slug: true,
                                name: true,
                                icon: true,
                                colorPrimary: true,
                            },
                        },
                    },
                },
                ads: {
                    select: {
                        id: true,
                        title: true,
                        unitPrice: true,
                        createdAt: true,
                        armId: true,
                    },
                    orderBy: { createdAt: 'desc' },
                    take: 5,
                },
                _count: {
                    select: {
                        ads: { where: { status: 'active' } },
                        armMemberships: { where: { status: 'active' } },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        // ✅ برای هر کسب‌وکار، لوگو را پیدا کن
        const result = [];
        for (const business of businesses) {
            const logoFile = await this.prisma.file.findFirst({
                where: {
                    relatedModel: 'Business',
                    relatedId: business.id,
                    fieldKey: 'logo',
                },
                select: {
                    id: true,
                    path: true,
                    thumbnailPath: true,
                    fieldKey: true,
                },
            });

            result.push({
                ...business,
                logoFile: logoFile || null,
                logoUrl: logoFile?.path || business.logoUrl || null,
                activeAdsCount: business._count.ads,
                activeMembershipsCount: business._count.armMemberships,
            });
        }

        return result;
    }

    // ============================================================
    // دریافت کسب‌وکار فعال (اولین کسب‌وکار کاربر)
    // ============================================================


    async getActiveBusiness(userId: string) {
        const business = await this.prisma.business.findFirst({
            where: {
                ownerUserId: userId,
                status: 'active',
            },
            include: {
                armMemberships: {
                    where: { status: 'active' },
                    include: {
                        arm: {
                            select: {
                                id: true,
                                slug: true,
                                name: true,
                                icon: true,
                                colorPrimary: true,
                            },
                        },
                    },
                },
                ads: {
                    where: { status: { not: 'deleted' } },
                    orderBy: { createdAt: 'desc' },
                    take: 20,
                    include: {
                        category: {
                            select: { id: true, title: true, path: true },
                        },
                        customCategory: {
                            select: { id: true, localTitle: true, path: true },
                        },
                        unit: {
                            select: { id: true, title: true, shortCode: true },
                        },
                        arm: {
                            select: { id: true, slug: true, name: true },
                        },
                        files: {
                            select: {
                                id: true,
                                fieldKey: true,
                                thumbnailPath: true,
                                path: true,
                            },
                        },
                    },
                },
                activities: {
                    include: {
                        activity: {
                            select: { id: true, title: true, slug: true, path: true, level: true },
                        },
                    },
                },
                teamMembers: {
                    where: { userId: userId },
                    select: { position: true },
                    take: 1,
                },
                verifications: {
                    orderBy: { submittedAt: 'desc' },
                    select: {
                        id: true,
                        tier: true,
                        status: true,
                        notes: true,
                        submittedAt: true,
                        reviewedAt: true,
                    },
                    take: 1,
                },
                _count: {
                    select: {
                        ads: { where: { status: 'active' } },
                        armMemberships: { where: { status: 'active' } },
                    },
                },
            },
        });

        if (!business) {
            return null;
        }

        // ✅ پیدا کردن لوگو از جدول File
        const logoFile = await this.prisma.file.findFirst({
            where: {
                relatedModel: 'Business',
                relatedId: business.id,
                fieldKey: 'logo',
            },
            select: {
                id: true,
                path: true,
                thumbnailPath: true,
                fieldKey: true,
            },
        });

        return {
            ...business,
            activeAdsCount: business._count.ads,
            activeMembershipsCount: business._count.armMemberships,
            position: business.teamMembers[0]?.position || null,
            activities: business.activities.map(a => a.activity),
            latestVerification: business.verifications[0] || null,
            // ✅ اضافه کردن logoFile و logoUrl کامل
            logoFile: logoFile || null,
            logoUrl: logoFile?.path || business.logoUrl || null,
        };
    }

    // ============================================================
    // دریافت جزئیات یک کسب‌وکار (با بررسی دسترسی)
    // ============================================================
    // src/business/business.service.ts

    // src/business/business.service.ts - متد findOne

    // src/business/business.service.ts

    async findOne(id: string, userId: string) {
        const business = await this.prisma.business.findUnique({
            where: { id },
            include: {
                armMemberships: {
                    where: { status: { not: 'deleted' } },
                    include: {
                        arm: {
                            select: {
                                id: true,
                                slug: true,
                                name: true,
                                icon: true,
                                colorPrimary: true,
                            },
                        },
                    },
                },
                ads: {
                    where: { status: { not: 'deleted' } },
                    orderBy: { createdAt: 'desc' },
                    take: 30,
                    include: {
                        arm: {
                            select: { id: true, slug: true, name: true },
                        },
                        files: {
                            select: {
                                id: true,
                                fieldKey: true,
                                thumbnailPath: true,
                                path: true,
                            },
                        },
                    },
                },
                credits: {
                    orderBy: { createdAt: 'desc' },
                    take: 10,
                },
                activities: {
                    include: {
                        activity: {
                            select: { id: true, title: true, slug: true, path: true, level: true },
                        },
                    },
                },
                teamMembers: {
                    where: { userId: userId },
                    select: { position: true, role: true },
                    take: 1,
                },
                verifications: {
                    orderBy: { submittedAt: 'desc' },
                    select: {
                        id: true,
                        tier: true,
                        status: true,
                        notes: true,
                        submittedAt: true,
                        reviewedAt: true,
                    },
                    take: 1,
                },
                _count: {
                    select: {
                        ads: true,
                        armMemberships: { where: { status: 'active' } },
                    },
                },
            },
        });

        if (!business) {
            throw new NotFoundException({
                errorCode: 'BUSINESS_NOT_FOUND',
                message: 'کسب‌وکار یافت نشد',
            });
        }

        if (business.ownerUserId !== userId) {
            throw new ForbiddenException({
                errorCode: 'FORBIDDEN',
                message: 'شما به این کسب‌وکار دسترسی ندارید',
            });
        }

        // ✅ پیدا کردن لوگو از جدول File
        const logoFile = await this.prisma.file.findFirst({
            where: {
                relatedModel: 'Business',
                relatedId: business.id,
                fieldKey: 'logo',
            },
            select: {
                id: true,
                path: true,
                thumbnailPath: true,
                fieldKey: true,
            },
        });

        const formattedBusiness = {
            ...business,
            position: business.teamMembers?.[0]?.position || null,
            activities: business.activities.map((item: any) => ({
                id: item.activityId,
                title: item.activity.title,
                slug: item.activity.slug,
                path: item.activity.path,
                level: item.activity.level,
            })),
            activeAdsCount: business._count.ads,
            activeMembershipsCount: business._count.armMemberships,
            latestVerification: business.verifications[0] || null,
            // ✅ اضافه کردن logoFile و logoUrl کامل
            logoFile: logoFile || null,
            logoUrl: logoFile?.path || business.logoUrl || null,
        };

        return formattedBusiness;
    }



    // ============================================================
    // حذف کسب‌وکار (soft delete)
    // ============================================================
    async remove(id: string, userId: string) {
        await this.findOne(id, userId);

        // بررسی اینکه کسب‌وکار آگهی فعال ندارد
        const activeAds = await this.prisma.ad.count({
            where: {
                businessId: id,
                status: 'active',
            },
        });

        if (activeAds > 0) {
            throw new ConflictException({
                errorCode: 'BUSINESS_HAS_ACTIVE_ADS',
                message: 'این کسب‌وکار آگهی فعال دارد، ابتدا آنها را حذف کنید',
            });
        }

        return this.prisma.business.update({
            where: { id },
            data: {
                status: 'closed',
                updatedAt: new Date(),
            },
        });
    }

    // ============================================================
    // بررسی وجود کسب‌وکار (برای گاردها)
    // ============================================================
    async exists(id: string): Promise<boolean> {
        const count = await this.prisma.business.count({
            where: {
                id,
                status: 'active',
            },
        });
        return count > 0;
    }

    // ============================================================
    // بررسی مالکیت کسب‌وکار (برای گاردها)
    // ============================================================
    async isOwner(businessId: string, userId: string): Promise<boolean> {
        const business = await this.prisma.business.findUnique({
            where: { id: businessId },
            select: { ownerUserId: true },
        });
        return business?.ownerUserId === userId;
    }



    async requestVerification(businessId: string, userId: string, dto: RequestVerificationDto) {
        // بررسی وجود و مالکیت
        const business = await this.findOne(businessId, userId);

        // اگر nationalCardFileId ارسال نشده، باید کاربر از قبل nationalId تأییدشده داشته باشد
        if (!dto.nationalCardFileId) {
            const user = await this.prisma.user.findUnique({ where: { id: userId } });
            if (!user?.nationalId) {
                throw new BadRequestException({
                    errorCode: 'NATIONAL_CARD_REQUIRED',
                    message: 'تصویر کارت ملی الزامی است (مگر اینکه کد ملی شما قبلاً تأیید شده باشد)',
                });
            }
            // اطمینان از تطابق کد ملی ارسالی با کد ملی ذخیره‌شده (اختیاری)
            if (dto.nationalId !== user.nationalId) {
                throw new BadRequestException({
                    errorCode: 'NATIONAL_ID_MISMATCH',
                    message: 'کد ملی با مقدار تأییدشده مطابقت ندارد',
                });
            }
        }

        // ایجاد رکورد Verification (بدون تغییر)
        const verification = await this.prisma.verification.create({
            data: {
                businessId: business.id,
                tier: dto.level,
                status: 'pending',
                documents: {
                    nationalId: dto.nationalId,
                    nationalCardFileId: dto.nationalCardFileId || null,   // ذخیره null در صورت عدم وجود
                    licenseFileIds: dto.licenseFileIds,
                    awardFileIds: dto.awardFileIds,
                },
                submittedAt: new Date(),
            },
        });

        // به‌روزرسانی وضعیت کسب‌وکار به pending
        await this.prisma.business.update({
            where: { id: businessId },
            data: { verificationStatus: 'pending' },
        });

        return business; // یا verification
    }
}