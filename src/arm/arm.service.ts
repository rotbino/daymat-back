// src/arm/arm.service.ts
import {
    Injectable,
    NotFoundException,
    ConflictException,
    BadRequestException,
    ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateArmDto, } from './dto/create-arm.dto';
import { LocationService } from '../location/location.service';
import { SystemRole } from "src/common/enums/prisma-enums";
import { CatalogPublishService } from "../common/services/catalog-publish.service";
import { checkMarketTypeMismatch, ARM_CATALOG_TYPES } from '../common/utils/arm.utils';
import { CacheHelper } from '../common/services/cache.helper';

@Injectable()
export class ArmService {
    constructor(
        private prisma: PrismaService,
        private locationService: LocationService,
        private catalogPublish: CatalogPublishService,
        private cache: CacheHelper,
    ) {}

    // ============================================================
    // 1. ایجاد بازاری جدید
    // ============================================================
    async create(userId: string, dto: CreateArmDto) {
        if (dto.customDomain) {
            const existingDomain = await this.prisma.arm.findFirst({
                where: { customDomain: dto.customDomain },
            });
            if (existingDomain) {
                throw new ConflictException({
                    errorCode: 'DUPLICATE_CUSTOM_DOMAIN',
                    message: 'این دامنه قبلاً استفاده شده است',
                });
            }
        }

        const existing = await this.prisma.arm.findUnique({
            where: { slug: dto.slug },
        });
        if (existing) {
            throw new ConflictException({
                errorCode: 'DUPLICATE_SLUG',
                message: 'این slug قبلاً استفاده شده است',
            });
        }

        if (dto.config.locationSelections && dto.config.locationSelections.length > 0) {
            const locations = await this.prisma.location.findMany({
                where: {
                    id: { in: dto.config.locationSelections.map((l) => l.locationId) },
                    isActive: true,
                },
            });
            if (locations.length !== dto.config.locationSelections.length) {
                throw new BadRequestException({
                    errorCode: 'SOME_LOCATIONS_NOT_FOUND',
                    message: 'برخی از موقعیت‌های انتخاب‌شده وجود ندارند یا غیرفعال هستند.',
                });
            }
        }

        const locationTree = await this.buildLocationTreeFromConfig(dto.config);

        const arm = await this.prisma.$transaction(async (prisma) => {
            const newArm = await prisma.arm.create({
                data: {
                    slug: dto.slug,
                    name: dto.name,
                    slogan: dto.slogan,
                    description: dto.description || '',
                    icon: dto.icon || 'storefront',
                    colorPrimary: dto.colorPrimary || '#610000',
                    colorSecondary: dto.colorSecondary || null,
                    logoUrl: dto.logoUrl || null,
                    bannerUrl: dto.bannerUrl || null,
                    mission: dto.mission || null,
                    status: dto.status || 'draft',
                    visibility: dto.visibility || 'public',
                    ownerUserId: userId,
                    geoScopeType: dto.geoScopeType,
                    defaultUnitId: dto.defaultUnitId || null,
                    featuresEnabled: dto.featuresEnabled || [],
                    // ✅ انواع کاتالوگ پذیرفته‌شده — فقط مقادیر معتبر، بدون تکرار
                    acceptedCatalogTypes: Array.isArray(dto.acceptedCatalogTypes)
                        ? [...new Set(dto.acceptedCatalogTypes.filter((t: string) => (ARM_CATALOG_TYPES as readonly string[]).includes(t)))]
                        : [],
                    // ✅ بازار خصوصی + شرایط عضویت (متن آزاد نمایش‌داده‌شده در مدال درخواست عضویت)
                    isPrivate: dto.isPrivate === true,
                    membershipTerms: (dto as any).membershipTerms?.trim() || null,
                    rankingAlgorithm: dto.rankingAlgorithm || 'simple',
                    metadata: dto.metadata || null,
                    categoryTree: [],
                    config: {
                        ...dto.config,
                        _cachedLocationTree: locationTree,
                    } as any,
                },
            });

            await prisma.armMembership.create({
                data: {
                    armId: newArm.id,
                    userId: userId,
                    role: 'arm_owner',
                    status: 'active',
                    source: 'auto_create',
                },
            });

            return newArm;
        });

        return this.findBySlug(arm.slug);
    }

    // ============================================================
    // 2. دریافت بازار با slug — بدون وابستگی به رلیشن‌های حساس
    // ============================================================
    // ============================================================
    // 2. دریافت بازار با slug — بدون رلیشن‌های حساس؛ مهمان هم ۲۰۰ می‌گیرد
    // ============================================================
    async findBySlug(slug: string, userId?: string) {
        const arm = await this.prisma.arm.findUnique({
            where: { slug },
            include: {
                _count: {
                    select: {
                        memberships: { where: { status: 'active' } },
                        ads: { where: { status: 'active' } },
                    },
                },
            },
        });

        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازاری مورد نظر یافت نشد',
            });
        }

        const config = arm.config as any || {};
        const general = config.general || {};

        let logoFile = null;
        if (general.logoFileId) {
            logoFile = await this.prisma.file.findFirst({
                where: {
                    id: general.logoFileId,
                    relatedModel: 'Arm',
                    relatedId: arm.id,
                    fieldKey: 'logo',
                },
                select: { id: true, path: true, thumbnailPath: true, fieldKey: true },
            });
        }
        if (!logoFile) {
            logoFile = await this.prisma.file.findFirst({
                where: {
                    relatedModel: 'Arm',
                    relatedId: arm.id,
                    fieldKey: 'logo',
                },
                select: { id: true, path: true, thumbnailPath: true, fieldKey: true },
            });
        }

        const bannerFile = await this.prisma.file.findFirst({
            where: {
                relatedModel: 'Arm',
                relatedId: arm.id,
                fieldKey: 'banner',
            },
            select: { id: true, path: true, thumbnailPath: true, fieldKey: true },
        });

        const categoryTree = arm.categoryTree || [];

        const allowedCategoryScopeTree = arm.allowedCategoryScopeTree ||
            config.allowedCategoryScopeTree || [];

        if (!arm.allowedCategoryScopeTree && config.allowedCategoryScopeTree) {
            await this.prisma.arm.update({
                where: { id: arm.id },
                data: {
                    allowedCategoryScopeTree: config.allowedCategoryScopeTree,
                },
            }).catch(() => {});
        }

        let locationTree = config._cachedLocationTree;
        if (!locationTree) {
            locationTree = await this.buildLocationTreeFromConfig(config);
            await this.prisma.arm.update({
                where: { id: arm.id },
                data: {
                    config: {
                        ...config,
                        _cachedLocationTree: locationTree,
                    } as any,
                },
            });
        }

        // ✅ مالکیت — کوئری مستقل، بدون رلیشن تودرتو (مهمان هم امن)
        let isArmOwner = false;
        let isArmAdmin = false;
        let isSystemAdmin = false;

        if (userId) {
            const [membership, user] = await Promise.all([
                this.prisma.armMembership.findFirst({
                    where: {
                        armId: arm.id,
                        userId: userId,
                        role: { in: ['arm_owner', 'arm_admin'] },
                        status: 'active',
                    },
                    select: { role: true },
                }),
                this.prisma.user.findUnique({
                    where: { id: userId },
                    select: { role: true },
                }),
            ]);

            isArmOwner = membership?.role === 'arm_owner';
            isArmAdmin = membership?.role === 'arm_admin';
            isSystemAdmin = user?.role === SystemRole.system_admin;
        }

        const {
            allowedCategoryScopeTree: _removedFromConfig,
            categorySelections: _removedCategorySelections,
            _cachedCategoryTree: _removedCachedTree,
            _treeUpdatedAt: _removedTreeUpdatedAt,
            ...cleanConfig
        } = config;

        const configWithFiles = {
            ...cleanConfig,
            general: {
                ...general,
                logoFile: logoFile || null,
                logoFileId: logoFile?.id || general.logoFileId || null,
                logoUrl: logoFile?.path || general.logoUrl || null,
                bannerFile: bannerFile || null,
                bannerUrl: bannerFile?.path || general.bannerUrl || null,
            },
        };

        // ✅ لوگو/بنر همیشه در فیلد ریشه‌ای هم بیاید — تنظیمات بازار فقط config.general را
        // می‌نویسد (ستون Arm.logoUrl را نمی‌نویسد) و مصرف‌کننده‌ها (ناو، سوییچر، پیکر)
        // فیلد ریشه‌ای را می‌خوانند؛ بدون این ادغام لوگو در هدر بازار دیده نمی‌شد
        const mergedLogoUrl = logoFile?.path || general.logoUrl || arm.logoUrl || null;
        const mergedBannerUrl = bannerFile?.path || general.bannerUrl || arm.bannerUrl || null;

        return {
            ...arm,
            logoUrl: mergedLogoUrl,
            bannerUrl: mergedBannerUrl,
            config: configWithFiles,
            categoryTree,
            allowedCategoryScopeTree,
            locationTree,
            isArmOwner,
            isArmAdmin,
            isArmManager: isArmOwner || isArmAdmin,
            isSystemAdmin,
        };
    }

    // ============================================================
    // 3. دریافت بازار با id
    // ============================================================
    async findById(id: string) {
        const arm = await this.prisma.arm.findUnique({
            where: { id },
            include: {
                _count: {
                    select: {
                        memberships: { where: { status: 'active' } },
                        ads: { where: { status: 'active' } },
                    },
                },
            },
        });

        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازاری مورد نظر یافت نشد',
            });
        }

        const config = arm.config as any || {};
        const general = config.general || {};

        let logoFile = null;
        if (general.logoFileId) {
            logoFile = await this.prisma.file.findFirst({
                where: {
                    id: general.logoFileId,
                    relatedModel: 'Arm',
                    relatedId: arm.id,
                    fieldKey: 'logo',
                },
                select: { id: true, path: true, thumbnailPath: true, fieldKey: true },
            });
        }
        if (!logoFile) {
            logoFile = await this.prisma.file.findFirst({
                where: {
                    relatedModel: 'Arm',
                    relatedId: arm.id,
                    fieldKey: 'logo',
                },
                select: { id: true, path: true, thumbnailPath: true, fieldKey: true },
            });
        }

        const bannerFile = await this.prisma.file.findFirst({
            where: {
                relatedModel: 'Arm',
                relatedId: arm.id,
                fieldKey: 'banner',
            },
            select: { id: true, path: true, thumbnailPath: true, fieldKey: true },
        });

        const categoryTree = arm.categoryTree || [];

        const allowedCategoryScopeTree = arm.allowedCategoryScopeTree ||
            config.allowedCategoryScopeTree || [];

        if (!arm.allowedCategoryScopeTree && config.allowedCategoryScopeTree) {
            await this.prisma.arm.update({
                where: { id: arm.id },
                data: {
                    allowedCategoryScopeTree: config.allowedCategoryScopeTree,
                },
            }).catch(() => {});
        }

        let locationTree = config._cachedLocationTree;
        if (!locationTree) {
            locationTree = await this.buildLocationTreeFromConfig(config);
            await this.prisma.arm.update({
                where: { id: arm.id },
                data: {
                    config: {
                        ...config,
                        _cachedLocationTree: locationTree,
                    } as any,
                },
            });
        }

        const {
            allowedCategoryScopeTree: _removedFromConfig,
            categorySelections: _removedCategorySelections,
            _cachedCategoryTree: _removedCachedTree,
            _treeUpdatedAt: _removedTreeUpdatedAt,
            ...cleanConfig
        } = config;

        const configWithFiles = {
            ...cleanConfig,
            general: {
                ...general,
                logoFile: logoFile || null,
                logoFileId: logoFile?.id || general.logoFileId || null,
                logoUrl: logoFile?.path || general.logoUrl || null,
                bannerFile: bannerFile || null,
                bannerUrl: bannerFile?.path || general.bannerUrl || null,
            },
        };

        return {
            ...arm,
            config: configWithFiles,
            categoryTree,
            allowedCategoryScopeTree,
            locationTree,
        };
    }

    // ============================================================
    // 4. لیست بازارهای کاربر — عضویت‌ها + ذخیره‌ها (فالو)
    //    شکل هر ردیف: عضویت (isMember) یا ذخیرهٔ خالی (status:'saved')
    //    ردیف‌های removed/banned از سوییچر حذف می‌شوند (در پروفایل برای بازگشت هستند)
    // ============================================================
    async getUserArms(userId: string) {
        const [memberships, savedMarks, pendingLeaves] = await Promise.all([
            this.prisma.armMembership.findMany({
                where: { userId },
                select: {
                    role: true,
                    status: true,
                    businessId: true,
                    publishState: true,
                    rejectionReason: true,
                    joinedAt: true,
                    leftAt: true,
                    leftVia: true,
                    selfRemovedCatalog: true,
                    roleType: true,
                    catalogId: true,
                    catalog: {
                        select: { id: true, name: true, type: true },
                    },
                    arm: {
                        select: {
                            id: true,
                            slug: true,
                            name: true,
                            slogan: true,
                            colorPrimary: true,
                            config: true,
                            categoryTree: true,
                            acceptedCatalogTypes: true,
                        },
                    },
                },
                orderBy: { joinedAt: 'desc' },
            }),
            this.prisma.armSavedMark.findMany({
                where: { userId },
                orderBy: { savedAt: 'desc' },
            }),
            // ✅ درخواست‌های لغوی در انتظار — بج «در انتظار تایید مالک» در پنل کاتالوگ/کسب‌وکار
            this.prisma.armLeaveRequest.findMany({
                where: { userId, status: 'pending' },
                select: { armId: true, roleType: true, createdAt: true },
            }),
        ]);
        const pendingLeaveMap = new Map(pendingLeaves.map((p) => [p.armId, p]));

        // بازارهای ذخیره‌شده‌ای که عضویتِ ردیفیِ آن‌ها را نداریم (عضوها از مسیر عضویت می‌آیند)
        const membershipArmIds = new Set(memberships.map((m) => m.arm.id));
        const savedOnlyArmIds = savedMarks
            .filter((s) => !membershipArmIds.has(s.armId))
            .map((s) => s.armId);

        const savedArms = savedOnlyArmIds.length > 0
            ? await this.prisma.arm.findMany({
                  where: { id: { in: savedOnlyArmIds } },
                  select: {
                      id: true, slug: true, name: true, slogan: true, colorPrimary: true,
                      config: true, categoryTree: true, acceptedCatalogTypes: true,
                  },
              })
            : [];
        const savedArmMap = new Map(savedArms.map((a) => [a.id, a]));

        const allArmIds = [
            ...memberships.map((m) => m.arm.id),
            ...savedArms.map((a) => a.id),
        ];
        if (allArmIds.length === 0) return [];

        const logoFiles = await this.prisma.file.findMany({
            where: {
                relatedModel: 'Arm',
                relatedId: { in: allArmIds },
                fieldKey: 'logo',
            },
            select: { relatedId: true, path: true, thumbnailPath: true },
        });

        const logoMap = new Map();
        for (const logo of logoFiles) {
            logoMap.set(logo.relatedId, logo);
        }

        const result = [];
        for (const m of memberships) {
            const config = m.arm.config as any || {};
            const general = config.general || {};
            const logoFile = logoMap.get(m.arm.id);
            const logoUrl = logoFile?.path || general.logoUrl || null;
            // ✅ عضو واقعی = لِین فعال (کسب‌وکار/کاتالوگ) یا نقش مدیریتی
            const isMember = m.status === 'active' &&
                !!(m.catalogId || m.role === 'arm_owner' || m.role === 'arm_admin' || m.businessId);

            result.push({
                id: m.arm.id,
                slug: m.arm.slug,
                name: m.arm.name,
                slogan: m.arm.slogan,
                colorPrimary: m.arm.colorPrimary,
                logoUrl: logoUrl,
                role: m.role,
                status: m.status,
                isMember,
                saved: true, // عضوها همیشه در سوییچرند
                catalogId: m.catalogId,
                publishState: m.catalogId ? m.publishState : null,
                rejectionReason: m.rejectionReason,
                joinedAt: m.joinedAt,
                leftAt: m.leftAt ?? null,
                leftVia: m.leftVia ?? null,
                selfRemovedCatalog: m.selfRemovedCatalog ?? false,
                // ✅ درخواست لغویِ در انتظارِ تاییدِ مالک — بج در پنل کاتالوگ/کسب‌وکار
                pendingLeaveRequest: pendingLeaveMap.get(m.arm.id) ?? null,
                roleType: m.roleType,
                acceptedCatalogTypes: m.arm.acceptedCatalogTypes || [],
                catalog: m.catalog
                    ? { id: m.catalog.id, name: m.catalog.name, type: m.catalog.type }
                    : null,
                categoryTree: m.arm.categoryTree || [],
            });
        }

        // ✅ بازارهای فقط-ذخیره‌شده — بدون عضویت؛ فقط برای سوییچر
        for (const s of savedMarks) {
            const arm = savedArmMap.get(s.armId);
            if (!arm) continue;
            const config = arm.config as any || {};
            const general = config.general || {};
            const logoFile = logoMap.get(arm.id);
            const logoUrl = logoFile?.path || general.logoUrl || null;

            result.push({
                id: arm.id,
                slug: arm.slug,
                name: arm.name,
                slogan: arm.slogan,
                colorPrimary: arm.colorPrimary,
                logoUrl,
                role: 'arm_member',
                status: 'saved', // نشانگر فقط-ذخیره برای فرانت
                isMember: false,
                saved: true,
                savedAt: s.savedAt,
                catalogId: null,
                publishState: null,
                rejectionReason: null,
                joinedAt: null,
                leftAt: null,
                selfRemovedCatalog: false,
                roleType: null,
                acceptedCatalogTypes: arm.acceptedCatalogTypes || [],
                catalog: null,
                categoryTree: arm.categoryTree || [],
            });
        }

        return result;
    }

    // ============================================================
    // 5. پیوستن به بازار — فقط خریدارِ بازارِ عمومی (فعالِ آنی)
    // ============================================================
    // مدل نهایی عضویت:
    //   - عضویتِ خریدار (با کسب‌وکار) در بازار عمومی → فعالِ آنی؛ در خصوصی اصلاً از این مسیر نمی‌آید
    //   - بازار خصوصی → فقط از مسیر درخواست عضویت (ArmMembershipRequest) — تاییدِ مدیر سازندهٔ عضویت است
    //   - فروشنده شدن (هر دو نوع بازار) → همیشه درخواست + تایید مدیر + افزودن کاتالوگ توسط مدیر
    //   - دنبال‌کردن بازار (بدون کسب‌وکار) → دکمهٔ ذخیرهٔ هدر (ArmSavedMark) — عضویت نیست
    // ============================================================
    async join(userId: string, slug: string, roleType?: 'seller' | 'buyer', catalogId?: string, businessId?: string) {
        const arm = await this.prisma.arm.findUnique({ where: { slug } });
        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازار مورد نظر یافت نشد',
            });
        }

        // ✅ بازار خصوصی: عضویت فقط با درخواست و تایید مدیر — اینجا مستقیم عضو نمی‌شویم
        if (arm.isPrivate === true) {
            throw new BadRequestException({
                errorCode: 'USE_MEMBERSHIP_REQUEST',
                message: 'این بازار خصوصی است — برای عضویت درخواست بده تا مدیر بازار بررسی کند',
            });
        }

        // ✅ فروشنده شدن همیشه نیاز به تایید و افزودن کاتالوگ توسط مدیر دارد (بازار عمومی و خصوصی)
        if (catalogId) {
            throw new BadRequestException({
                errorCode: 'USE_SELLER_REQUEST',
                message: 'فروشنده شدن نیاز به تایید مدیر بازار دارد — درخواست فروشندگی بده',
            });
        }

        let resolvedBusinessId = businessId || null;

        // ✅ membership این کاربر در این بازار رو پیدا کن (با armId + userId)
        const existing = await this.prisma.armMembership.findUnique({
            where: { armId_userId: { armId: arm.id, userId } },
        });

        // ✅ بدون کسب‌وکار عضویت معنا ندارد — برای دنبال‌کردن بازار دکمهٔ ذخیره هست
        if (!resolvedBusinessId) {
            const firstBiz = await this.prisma.business.findFirst({
                where: { ownerUserId: userId, status: 'active' },
                select: { id: true },
            });
            if (!firstBiz) {
                throw new BadRequestException({
                    errorCode: 'BUSINESS_REQUIRED',
                    message: 'برای عضویت باید کسب‌وکارت را ثبت کنی — برای دنبال‌کردن بازار از دکمهٔ ذخیره در هدر استفاده کن',
                });
            }
            resolvedBusinessId = firstBiz.id;
        }

        if (existing) {
            if (existing.status === 'active' && existing.businessId) {
                throw new ConflictException({
                    errorCode: 'ALREADY_MEMBER',
                    message: 'شما قبلاً به این بازار پیوسته‌اید',
                });
            }

            const isRejoin = existing.status === 'removed' || existing.status === 'banned';
            // ✅ آپدیت کن — role رو دست نمی‌زنیم؛ فروشندهٔ فعال که خریدار می‌شود → دو-نقشی
            const updated = await this.prisma.armMembership.update({
                where: { id: existing.id },
                data: {
                    status: 'active',
                    rejectionReason: null,
                    leftAt: null,
                    joinedAt: new Date(),
                    roleType: existing.roleType === 'seller' ? 'seller-buyer' : (roleType || existing.roleType || 'buyer'),
                    businessId: resolvedBusinessId || existing.businessId,
                    source: 'manual',
                },
            });

            await this.logMembershipEvent(arm.id, userId, isRejoin ? 'joined' : 'joined', userId,
                isRejoin ? 'عضویت مجدد خریدار در بازار عمومی' : 'پیوستن خریدار به بازار عمومی');

            // ⚠️ تعداد عضویت‌ها در پروفایل هست → کش پروفایل باطل
            await this.cache.bust(`profile:${userId}`);
            return updated;
        }

        const created = await this.prisma.armMembership.create({
            data: {
                armId: arm.id,
                userId: userId,
                businessId: resolvedBusinessId,
                status: 'active',
                role: 'arm_member',
                roleType: roleType || 'buyer',
                source: 'manual',
            },
        });

        await this.logMembershipEvent(arm.id, userId, 'joined', userId, 'پیوستن خریدار به بازار عمومی');

        // ⚠️ عضویت جدید → شمارش پروفایل عوض می‌شود → کش باطل
        await this.cache.bust(`profile:${userId}`);
        return created;
    }

    // ============================================================
    // 6.6) ذخیره/فالو بازار — برای غیرعضوها؛ آنی و بدون شرط
    // ============================================================
    async saveMark(userId: string, slug: string) {
        const arm = await this.prisma.arm.findUnique({ where: { slug }, select: { id: true, slug: true } });
        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازار مورد نظر یافت نشد',
            });
        }

        // ✅ اعضا (businessId/catalogId/مالک/ادمین) دکمهٔ ذخیره ندارند — بازارشان همیشه در سوییچر است
        const membership = await this.prisma.armMembership.findUnique({
            where: { armId_userId: { armId: arm.id, userId } },
        });
        if (
            membership?.status === 'active' &&
            (membership.businessId || membership.catalogId ||
             membership.role === 'arm_owner' || membership.role === 'arm_admin')
        ) {
            throw new ConflictException({
                errorCode: 'MEMBER_NO_SAVE',
                message: 'شما عضو این بازار هستید — بازارِ عضو همیشه در سوییچر شماست و ذخیره ندارد',
            });
        }

        const existing = await this.prisma.armSavedMark.findUnique({
            where: { armId_userId: { armId: arm.id, userId } },
        });
        if (existing) return existing; // idempotent

        const mark = await this.prisma.armSavedMark.create({
            data: { armId: arm.id, userId },
        });
        await this.logMembershipEvent(arm.id, userId, 'saved', userId, 'ذخیرهٔ بازار');
        await this.cache.bust(`profile:${userId}`);
        return mark;
    }

    async unsaveMark(userId: string, slug: string) {
        const arm = await this.prisma.arm.findUnique({ where: { slug }, select: { id: true } });
        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازار مورد نظر یافت نشد',
            });
        }

        const mark = await this.prisma.armSavedMark.findUnique({
            where: { armId_userId: { armId: arm.id, userId } },
        });
        if (!mark) return { ok: true }; // idempotent

        await this.prisma.armSavedMark.delete({ where: { id: mark.id } });
        await this.logMembershipEvent(arm.id, userId, 'unsaved', userId, 'حذف از ذخیره‌ها');
        await this.cache.bust(`profile:${userId}`);
        return { ok: true };
    }

    // ============================================================
    // 6.۷) وضعیت کامل من در بازار — عضویت + تاریخ‌ها + ذخیره + تاریخچهٔ رویدادها
    // ============================================================
    async getMyMembership(userId: string, slug: string) {
        const arm = await this.prisma.arm.findUnique({
            where: { slug },
            select: { id: true, name: true, slug: true, isPrivate: true, membershipTerms: true, status: true },
        });
        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازار مورد نظر یافت نشد',
            });
        }

        const [membership, savedMark, events] = await Promise.all([
            this.prisma.armMembership.findUnique({
                where: { armId_userId: { armId: arm.id, userId } },
                select: {
                    id: true, status: true, businessStatus: true, role: true, roleType: true,
                    businessId: true, catalogId: true, publishState: true,
                    joinedAt: true, leftAt: true, leftVia: true, selfRemovedCatalog: true,
                    rejectionReason: true, reviewedAt: true,
                },
            }),
            this.prisma.armSavedMark.findUnique({
                where: { armId_userId: { armId: arm.id, userId } },
            }),
            this.prisma.armMembershipEvent.findMany({
                where: { armId: arm.id, userId },
                orderBy: { createdAt: 'desc' },
                take: 30,
            }),
        ]);

        // ✅ آخرین درخواست لغوی من — برای بج «در انتظار تایید مالک» و پس‌گرفتن درخواست
        const leaveRequest = await this.prisma.armLeaveRequest.findFirst({
            where: { armId: arm.id, userId },
            orderBy: { createdAt: 'desc' },
            select: { id: true, status: true, roleType: true, memberReason: true, rejectReason: true, createdAt: true, reviewedAt: true },
        });

        return {
            arm,
            membership,
            saved: !!savedMark,
            savedAt: savedMark?.savedAt ?? null,
            leaveRequest,
            events,
        };
    }

    /** ثبت رویداد تاریخچهٔ عضویت — هرگز جریان اصلی را نمی‌شکند */
    private async logMembershipEvent(armId: string, userId: string, eventType: string, actorUserId?: string, note?: string) {
        try {
            await this.prisma.armMembershipEvent.create({
                data: {
                    armId,
                    userId,
                    eventType,
                    actorUserId: actorUserId || null,
                    note: note || null,
                },
            });
        } catch (err) {
            console.error(`logMembershipEvent(${eventType}) failed:`, err);
        }
    }

    // ============================================================
    // 7. دریافت آمار بازار
    // ============================================================
    async getStats(slug: string) {
        const arm = await this.prisma.arm.findUnique({
            where: { slug },
            include: {
                _count: {
                    select: {
                        memberships: { where: { status: 'active' } },
                        ads: { where: { status: 'active' } },
                    },
                },
            },
        });

        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازاری مورد نظر یافت نشد',
            });
        }

        return {
            members: arm._count.memberships,
            activeAds: arm._count.ads,
        };
    }

    // ============================================================
    // 8. به‌روزرسانی بازار
    // ============================================================
    async updateArm(armId: string, userId: string, dto: Partial<CreateArmDto>) {
        if (dto.customDomain) {
            const existingDomain = await this.prisma.arm.findFirst({
                where: { customDomain: dto.customDomain },
            });
            if (existingDomain) {
                throw new ConflictException({
                    errorCode: 'DUPLICATE_CUSTOM_DOMAIN',
                    message: 'این دامنه قبلاً استفاده شده است',
                });
            }
        }

        const arm = await this.prisma.arm.findUnique({
            where: { id: armId },
            include: {
                memberships: {
                    where: { userId, role: 'arm_owner', status: 'active' },
                },
            },
        });

        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازار یافت نشد',
            });
        }

        const isAdmin = arm.memberships.length > 0;
        const isSystemAdmin = await this.isSystemAdmin(userId);

        if (!isAdmin && !isSystemAdmin) {
            throw new ForbiddenException({
                errorCode: 'FORBIDDEN',
                message: 'شما اجازه ویرایش این بازار را ندارید',
            });
        }

        const updateData: any = {};

        if (dto.name) updateData.name = dto.name;
        if (dto.slogan) updateData.slogan = dto.slogan;
        if (dto.description !== undefined) updateData.description = dto.description;
        if (dto.icon !== undefined) updateData.icon = dto.icon;
        if (dto.colorPrimary !== undefined) updateData.colorPrimary = dto.colorPrimary;
        if (dto.colorSecondary !== undefined) updateData.colorSecondary = dto.colorSecondary;
        if (dto.logoUrl !== undefined) updateData.logoUrl = dto.logoUrl;
        if (dto.bannerUrl !== undefined) updateData.bannerUrl = dto.bannerUrl;
        if (dto.mission !== undefined) updateData.mission = dto.mission;
        if (dto.status) updateData.status = dto.status;
        if (dto.visibility) updateData.visibility = dto.visibility;
        if (dto.geoScopeType) updateData.geoScopeType = dto.geoScopeType;
        if (dto.defaultUnitId !== undefined) updateData.defaultUnitId = dto.defaultUnitId;
        if (dto.featuresEnabled) updateData.featuresEnabled = dto.featuresEnabled;
        if (dto.acceptedCatalogTypes !== undefined) {
            updateData.acceptedCatalogTypes = Array.isArray(dto.acceptedCatalogTypes)
                ? [...new Set(dto.acceptedCatalogTypes.filter((t: string) => (ARM_CATALOG_TYPES as readonly string[]).includes(t)))]
                : [];
        }
        if (dto.rankingAlgorithm) updateData.rankingAlgorithm = dto.rankingAlgorithm;
        if (dto.metadata !== undefined) updateData.metadata = dto.metadata;

        if ((dto as any).categoryTree !== undefined) {
            updateData.categoryTree = (dto as any).categoryTree;
        }

        if (dto.config) {
            const locationIds = dto.config.locationSelections?.map((l) => l.locationId) || [];
            if (locationIds.length > 0) {
                const locations = await this.prisma.location.findMany({
                    where: { id: { in: locationIds }, isActive: true },
                });
                if (locations.length !== locationIds.length) {
                    throw new BadRequestException({
                        errorCode: 'SOME_LOCATIONS_NOT_FOUND',
                        message: 'برخی از موقعیت‌های انتخاب‌شده وجود ندارند یا غیرفعال هستند.',
                    });
                }
            }

            let updatedConfig = { ...dto.config };

            delete updatedConfig.categorySelections;
            delete updatedConfig._cachedCategoryTree;
            delete updatedConfig._treeUpdatedAt;

            const oldConfig = arm.config as any || {};
            const oldLocationSelections = oldConfig.locationSelections || [];
            const newLocationSelections = updatedConfig.locationSelections || [];
            const locationChanged = JSON.stringify(oldLocationSelections) !== JSON.stringify(newLocationSelections);

            if (locationChanged && updatedConfig.locationSelections) {
                const locationTree = await this.buildLocationTreeFromConfig(updatedConfig);
                updatedConfig._cachedLocationTree = locationTree;
            }

            updateData.config = updatedConfig;
        }

        return this.prisma.arm.update({
            where: { id: armId },
            data: updateData,
        });
    }

    // ============================================================
    // 9. حذف نرم بازار
    // ============================================================
    async deleteArm(armId: string, userId: string) {
        const arm = await this.prisma.arm.findUnique({
            where: { id: armId },
            include: {
                memberships: {
                    where: { userId, role: 'arm_owner', status: 'active' },
                },
            },
        });

        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازار یافت نشد',
            });
        }

        const isAdmin = arm.memberships.length > 0;
        const isSystemAdmin = await this.isSystemAdmin(userId);

        if (!isAdmin && !isSystemAdmin) {
            throw new ForbiddenException({
                errorCode: 'FORBIDDEN',
                message: 'شما اجازه حذف این بازار را ندارید',
            });
        }

        return this.prisma.arm.update({
            where: { id: armId },
            data: { status: 'archived', updatedAt: new Date() },
        });
    }

    // ============================================================
    // 10. دریافت درخت دسته‌بندی بازار
    // ============================================================
    async getArmCategoryTree(slug: string, nodeId?: string) {
        const arm = await this.prisma.arm.findUnique({
            where: { slug },
            select: { categoryTree: true },
        });

        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازاری مورد نظر یافت نشد',
            });
        }

        let tree = (arm.categoryTree as any[]) || [];

        if (nodeId) {
            const findNode = (nodes: any[]): any => {
                for (const node of nodes) {
                    if (node.id === nodeId) return node;
                    if (node.children) {
                        const found = findNode(node.children);
                        if (found) return found;
                    }
                }
                return null;
            };
            const foundNode = findNode(tree);
            tree = foundNode ? [foundNode] : [];
        }

        return tree;
    }

    // ============================================================
    // 11. دریافت درخت موقعیت‌های بازار
    // ============================================================
    async getArmLocationTree(slug: string) {
        const arm = await this.prisma.arm.findUnique({
            where: { slug },
            select: { config: true },
        });

        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازاری مورد نظر یافت نشد',
            });
        }

        const config = arm.config as any || {};
        let tree = config._cachedLocationTree;

        if (!tree) {
            tree = await this.buildLocationTreeFromConfig(config);
            await this.prisma.arm.update({
                where: { slug },
                data: {
                    config: {
                        ...config,
                        _cachedLocationTree: tree,
                    } as any,
                },
            });
        }

        return tree;
    }

    // ============================================================
    // 12. بررسی عضویت
    // ============================================================
    async isMember(userId: string, armId: string) {
        const membership = await this.prisma.armMembership.findFirst({
            where: { armId, userId, status: 'active' },
        });
        return !!membership;
    }

    // ============================================================
    // 13. بررسی مدیر سیستم
    // ============================================================
    private async isSystemAdmin(userId: string): Promise<boolean> {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { role: true },
        });
        return user?.role === SystemRole.system_admin;
    }

    // ============================================================
    // 14. ساخت درخت موقعیت‌ها از config
    // ============================================================
    private async buildLocationTreeFromConfig(config: any): Promise<any[]> {
        if (!config?.locationSelections || config.locationSelections.length === 0) {
            return [];
        }

        const selections = config.locationSelections;
        const locationIds = selections.map((s: any) => s.locationId);
        const validLocationIds = locationIds.filter((id: string) => /^[0-9a-fA-F]{24}$/.test(id));

        if (validLocationIds.length === 0) return [];

        const locations = await this.prisma.location.findMany({
            where: { id: { in: validLocationIds }, isActive: true },
            include: {
                parent: {
                    select: { id: true, title: true, type: true, provinceCode: true },
                },
            },
        });

        const provinceMap = new Map();

        for (const city of locations) {
            const province = city.parent;
            if (!province) continue;

            if (!provinceMap.has(province.id)) {
                provinceMap.set(province.id, {
                    id: province.id,
                    title: province.title,
                    type: province.type,
                    provinceCode: province.provinceCode,
                    isActive: true,
                    children: [],
                    isSelected: false,
                });
            }

            const selection = selections.find((s) => s.locationId === city.id);
            provinceMap.get(province.id).children.push({
                id: city.id,
                title: city.title,
                type: city.type,
                cityCode: city.cityCode,
                isActive: true,
                isSelected: true,
                customLabel: selection?.customLabel || null,
                children: [],
            });
        }

        return Array.from(provinceMap.values());
    }

    // ============================================================
    // 15. حذف کامل بازار (فقط توسعه)
    // ============================================================
    async hardDelete(armId: string, userId: string) {
        if (process.env.NODE_ENV === 'production') {
            throw new ForbiddenException({
                errorCode: 'FORBIDDEN',
                message: 'این عملیات در محیط تولید غیرفعال است',
            });
        }

        const arm = await this.prisma.arm.findUnique({
            where: { id: armId },
            include: {
                memberships: {
                    where: { userId, role: 'arm_owner', status: 'active' },
                },
            },
        });

        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازار یافت نشد',
            });
        }

        const isAdmin = arm.memberships.length > 0;
        const isSystemAdmin = await this.isSystemAdmin(userId);

        if (!isAdmin && !isSystemAdmin) {
            throw new ForbiddenException({
                errorCode: 'FORBIDDEN',
                message: 'شما اجازه حذف این بازار را ندارید',
            });
        }

        await this.prisma.$transaction([
            this.prisma.adView.deleteMany({ where: { ad: { armId: armId } } }),
            this.prisma.callEvent.deleteMany({ where: { ad: { armId: armId } } }),
            this.prisma.ad.deleteMany({ where: { armId: armId } }),
            this.prisma.buyLead.deleteMany({ where: { armId: armId } }),
            this.prisma.armMembership.deleteMany({ where: { armId: armId } }),
            this.prisma.credit.deleteMany({ where: { armId: armId } }),
            this.prisma.creditRequest.deleteMany({ where: { armId: armId } }),
            this.prisma.trustMetric.deleteMany({ where: { armId: armId } }),
            this.prisma.file.deleteMany({ where: { relatedModel: 'Arm', relatedId: armId } }),
            this.prisma.arm.delete({ where: { id: armId } }),
        ]);

        return {
            message: 'بازار و تمام وابسته‌های آن با موفقیت حذف شدند',
            deletedArm: { id: arm.id, slug: arm.slug, name: arm.name },
        };
    }

    // ============================================================
    // 16. سوییچ انتشار صاحب کاتالوگ — مالکیت از مسیر نهاد
    // ============================================================
    async toggleCatalogPublish(userId: string, slug: string, catalogId: string, published: boolean) {
        const arm = await this.prisma.arm.findUnique({
            where: { slug },
            select: { id: true, name: true, categoryTree: true },
        });
        if (!arm) {
            throw new NotFoundException({ errorCode: 'ARM_NOT_FOUND', message: 'بازار یافت نشد' });
        }

        const catalog = await this.prisma.catalog.findUnique({
            where: { id: catalogId },
            select: {
                id: true,
                business: { select: { ownerUserId: true } },
            },
        });
        if (!catalog || (catalog.business as any).ownerUserId !== userId) {
            throw new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'فقط مالک کاتالوگ' });
        }

        // ✅ membership این کاربر در این بازار رو پیدا کن (با armId + userId)
        const membership = await this.prisma.armMembership.findUnique({
            where: { armId_userId: { armId: arm.id, userId } },
        });
        if (!membership || membership.catalogId !== catalogId) {
            throw new BadRequestException({ errorCode: 'NOT_MEMBER', message: 'این کاتالوگ عضو این بازار نیست' });
        }

        if (published) {
            if (membership.status !== 'active') {
                throw new BadRequestException({
                    errorCode: 'MEMBERSHIP_PAUSED',
                    message: 'عضویت شما در این بازار توسط مدیر بازار متوقف شده است',
                });
            }
            const stamp = await this.catalogPublish.stampCatalogAds(arm, catalogId, undefined, userId);
            const updated = await this.prisma.armMembership.update({
                where: { id: membership.id },
                data: { publishState: 'published' },
            });
            return { membership: updated, ...stamp };
        }

        await this.catalogPublish.unstampCatalogAds(catalogId, arm.id);
        const updated = await this.prisma.armMembership.update({
            where: { id: membership.id },
            data: { publishState: 'paused' },
        });
        return { membership: updated };
    }

    // ============================================================
    // 17. بازارهای فعال عمومی
    // ============================================================
    async suggestedArms(catalogId?: string, userId?: string, limit = 6) {
        const excludeArmIds: string[] = [];

        if (catalogId) {
            const catalogMemberships = await this.prisma.armMembership.findMany({
                where: { catalogId },
                select: { armId: true },
            });
            excludeArmIds.push(...catalogMemberships.map((m) => m.armId));
        }

        if (userId) {
            const myMemberships = await this.prisma.armMembership.findMany({
                where: { userId },
                select: { armId: true },
            });
            excludeArmIds.push(...myMemberships.map((m) => m.armId));
        }

        const arms = await this.prisma.arm.findMany({
            where: {
                status: 'active',
                visibility: 'public',
                ...(excludeArmIds.length ? { id: { notIn: excludeArmIds } } : {}),
            },
            select: {
                id: true,
                slug: true,
                name: true,
                shortName: true,
                slogan: true,
                logoUrl: true,
                icon: true,
                _count: {
                    select: {
                        memberships: true,
                        ads: true,
                    },
                },
            },
            take: Math.min(limit * 3, 30),
        });

        arms.sort((a: any, b: any) =>
            (b._count?.memberships ?? 0) - (a._count?.memberships ?? 0),
        );

        return { items: arms.slice(0, limit) };
    }
}