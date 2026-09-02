// src/business/business.service.ts
import {
    Injectable,
    NotFoundException,
    ForbiddenException,
    ConflictException,
    BadRequestException
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBusinessDto, RequestVerificationDto, UpdateBusinessDto } from './business.dto';
import { BusinessRole } from "../common/enums/prisma-enums";

@Injectable()
export class BusinessService {
    constructor(private prisma: PrismaService) {}

    // ============================================================
    // ثبت کسب‌وکار جدید
    // ============================================================
    async create(userId: string, dto: CreateBusinessDto) {
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

        if (dto.activityIds?.length) {
            await this.prisma.businessActivity.createMany({
                data: dto.activityIds.map(activityId => ({
                    businessId: business.id,
                    activityId,
                })),
            });
        }

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

    // ============================================================
    // ویرایش کسب‌وکار
    // ============================================================
    async update(id: string, userId: string, dto: UpdateBusinessDto) {
        await this.findOne(id, userId);

        if (dto.logoFileId) {
            await this.prisma.business.update({
                where: { id },
                data: { logoUrl: dto.logoFileId },
            });
        }
        // ✅ اگر slug تغییر کرده، بررسی یکتا بودن
        if (dto.slug) {
            const existingSlug = await this.prisma.business.findFirst({
                where: {
                    slug: dto.slug,
                    id: { not: id },
                },
            });
            if (existingSlug) {
                throw new ConflictException({
                    errorCode: 'DUPLICATE_SLUG',
                    message: 'این اسلاگ قبلاً استفاده شده است',
                });
            }
        }

        const business = await this.prisma.business.update({
            where: { id },
            data: {
                name: dto.name,
                shortDescription: dto.shortDescription,
                type: dto.type,
                city: dto.city,
                slug:dto.slug,
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

        if (dto.position !== undefined) {
            await this.prisma.teamMember.updateMany({
                where: { businessId: id, userId: userId },
                data: { position: dto.position || null },
            });
        }

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

    // src/business/business.service.ts

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
                        ads: { where: { status: { not: 'deleted' } } },
                        armMemberships: { where: { status: 'active' } },
                    },
                },
            },
        });

        if (!business) {
            return null;
        }

        // ✅ شمارش جداگانه
        const [activeAdsCount, expiredAdsCount] = await Promise.all([
            this.prisma.ad.count({
                where: {
                    businessId: business.id,
                    status: 'active',
                    expiresAt: { gt: new Date() },
                },
            }),
            this.prisma.ad.count({
                where: {
                    businessId: business.id,
                    status: { not: 'deleted' },
                    OR: [
                        { status: 'expired' },
                        { status: 'inactive' },
                        { status: 'active', expiresAt: { lt: new Date() } },
                    ],
                },
            }),
        ]);

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
            totalAdsCount: business._count.ads,
            activeAdsCount: activeAdsCount,
            expiredAdsCount: expiredAdsCount,
            activeMembershipsCount: business._count.armMemberships,
            position: business.teamMembers[0]?.position || null,
            activities: business.activities.map(a => a.activity),
            latestVerification: business.verifications[0] || null,
            logoFile: logoFile || null,
            logoUrl: logoFile?.path || business.logoUrl || null,
        };
    }

// ============================================================
// دریافت جزئیات یک کسب‌وکار (با بررسی دسترسی)
// ============================================================
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
                        ads: { where: { status: { not: 'deleted' } } },
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

        // ✅ شمارش جداگانه
        const [activeAdsCount, expiredAdsCount] = await Promise.all([
            this.prisma.ad.count({
                where: {
                    businessId: id,
                    status: 'active',
                    expiresAt: { gt: new Date() },
                },
            }),
            this.prisma.ad.count({
                where: {
                    businessId: id,
                    status: { not: 'deleted' },
                    OR: [
                        { status: 'expired' },
                        { status: 'inactive' },
                        { status: 'active', expiresAt: { lt: new Date() } },
                    ],
                },
            }),
        ]);

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
            totalAdsCount: business._count.ads,
            activeAdsCount: activeAdsCount,
            expiredAdsCount: expiredAdsCount,
            activeMembershipsCount: business._count.armMemberships,
            latestVerification: business.verifications[0] || null,
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

    // ============================================================
    // درخواست تیک اعتماد
    // ============================================================
    async requestVerification(businessId: string, userId: string, dto: RequestVerificationDto) {
        const business = await this.findOne(businessId, userId);

        if (!dto.nationalCardFileId) {
            const user = await this.prisma.user.findUnique({ where: { id: userId } });
            if (!user?.nationalId) {
                throw new BadRequestException({
                    errorCode: 'NATIONAL_CARD_REQUIRED',
                    message: 'تصویر کارت ملی الزامی است (مگر اینکه کد ملی شما قبلاً تأیید شده باشد)',
                });
            }
            if (dto.nationalId !== user.nationalId) {
                throw new BadRequestException({
                    errorCode: 'NATIONAL_ID_MISMATCH',
                    message: 'کد ملی با مقدار تأییدشده مطابقت ندارد',
                });
            }
        }

        const verification = await this.prisma.verification.create({
            data: {
                businessId: business.id,
                tier: dto.level,
                status: 'pending',
                documents: {
                    nationalId: dto.nationalId,
                    nationalCardFileId: dto.nationalCardFileId || null,
                    licenseFileIds: dto.licenseFileIds,
                    awardFileIds: dto.awardFileIds,
                },
                submittedAt: new Date(),
            },
        });

        await this.prisma.business.update({
            where: { id: businessId },
            data: { verificationStatus: 'pending' },
        });

        return business;
    }

    // src/business/business.service.ts

    // src/business/business.service.ts

    // src/business/business.service.ts

    // src/business/business.service.ts

    async findBySlug(slug: string) {
        const business = await this.prisma.business.findFirst({
            where: { slug },
            include: {
                owner: {
                    select: {
                        id: true,
                        fullName: true,
                        phone: true,
                        avatarUrl: true,
                        files: {
                            where: { fieldKey: 'avatar' },
                            select: { id: true, path: true, thumbnailPath: true },
                            take: 1,
                        },
                    },
                },
                files: {
                    where: { fieldKey: 'logo' },
                    select: { id: true, path: true, thumbnailPath: true, fieldKey: true },
                    take: 1,
                },
                activities: {
                    include: {
                        activity: {
                            select: { id: true, title: true, slug: true },
                        },
                    },
                },
                // ✅ درست: armMemberships
                armMemberships: {
                    where: { status: 'active' },
                    select: {
                        arm: {
                            select: { slug: true, name: true },
                        },
                    },
                    take: 1,
                },
                _count: {
                    select: {
                        ads: { where: { status: { not: 'deleted' } } },
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

        const logoFile = business.files?.[0];
        const ownerAvatarFile = business.owner?.files?.[0];

        return {
            ...business,
            logoUrl: logoFile?.path || business.logoUrl || null,
            logoFile: logoFile || null,
            // ✅ استفاده از armMemberships
            armSlug: business.armMemberships?.[0]?.arm?.slug || null,
            owner: business.owner ? {
                ...business.owner,
                avatarUrl: ownerAvatarFile?.thumbnailPath || ownerAvatarFile?.path || business.owner.avatarUrl || null,
                avatarFile: ownerAvatarFile || null,
            } : null,
        };
    }
}