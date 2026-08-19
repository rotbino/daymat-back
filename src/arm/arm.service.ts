// src/arm/arm.service.ts
import {
    Injectable,
    NotFoundException,
    ConflictException,
    BadRequestException,
    ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateArmDto,  } from './dto/create-arm.dto';
import { LocationService } from '../location/location.service';
import { SystemRole } from "src/common/enums/prisma-enums";
@Injectable()
export class ArmService {
    constructor(
        private prisma: PrismaService,
        private locationService: LocationService,
    ) {}

    // ============================================================
    // 1. ایجاد بازاری جدید (فقط مدیران سیستم)
    // ============================================================
    async create(userId: string, dto: CreateArmDto) {
        if (dto.customDomain) {
            const existingDomain = await this.prisma.arm.findFirst({   // ← findFirst
                where: { customDomain: dto.customDomain },
            });
            if (existingDomain) {
                throw new ConflictException({
                    errorCode: 'DUPLICATE_CUSTOM_DOMAIN',
                    message: 'این دامنه قبلاً استفاده شده است',
                });
            }
        }
        // ۱. بررسی یکتایی slug
        const existing = await this.prisma.arm.findUnique({
            where: { slug: dto.slug },
        });
        if (existing) {
            throw new ConflictException({
                errorCode: 'DUPLICATE_SLUG',
                message: 'این slug قبلاً استفاده شده است',
            });
        }

        // ۲. بررسی وجود گره‌های انتخاب‌شده
        const categories = await this.prisma.productCategory.findMany({
            where: {
                id: { in: dto.config.categorySelections.map(c => c.categoryId) },
                isActive: true,
            },
        });
        if (categories.length !== dto.config.categorySelections.length) {
            throw new BadRequestException({
                errorCode: 'SOME_CATEGORIES_NOT_FOUND',
                message: 'برخی از دسته‌بندی‌های انتخاب‌شده وجود ندارند یا غیرفعال هستند.',
            });
        }

        // ۳. بررسی وجود موقعیت‌های انتخاب‌شده
        if (dto.config.locationSelections && dto.config.locationSelections.length > 0) {
            const locations = await this.prisma.location.findMany({
                where: {
                    id: { in: dto.config.locationSelections.map(l => l.locationId) },
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

        // ✅ ۴. دریافت عنوان واحدها برای هر دسته‌بندی
        const categorySelectionsWithUnits = [];
        for (const sel of dto.config.categorySelections) {
            let unitTitle = 'تن';
            if (sel.overrideUnitId) {
                const unit = await this.prisma.unit.findUnique({
                    where: { id: sel.overrideUnitId },
                    select: { title: true },
                });
                if (unit) {
                    unitTitle = unit.title;
                }
            }
            categorySelectionsWithUnits.push({
                ...sel,
                overrideUnitTitle: unitTitle,
            });
        }

        // ۵. ایجاد بازار با تراکنش
        const arm = await this.prisma.$transaction(async (prisma) => {
            // ۵-۱. ایجاد بازار با config
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
                    rankingAlgorithm: dto.rankingAlgorithm || 'simple',
                    metadata: dto.metadata || null,
                    // ✅ ذخیره config با categorySelections دارای unitTitle
                    config: {
                        ...dto.config,
                        categorySelections: categorySelectionsWithUnits,
                    } as any,
                },
            });

            // ۵-۲. اضافه کردن سازنده به‌عنوان ادمین
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
    // 2. دریافت اطلاعات کامل بازار با slug (همراه config)
    // ============================================================
    // src/arm/arm.service.ts - findBySlug
    // src/arm/arm.service.ts
    async findBySlug(slug: string, userId?: string) {  // ← userId اضافه شد
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

        const categoryTree = await this.buildCategoryTreeFromConfig(arm.config);
        const locationTree = await this.buildLocationTreeFromConfig(arm.config);

        // ✅ محاسبه دسترسی‌ها فقط اگر userId وجود داشته باشه
        let isArmOwner = false;
        let isSystemAdmin = false;

        if (userId) {
            // بررسی عضویت arm_owner
            const membership = await this.prisma.armMembership.findFirst({
                where: {
                    armId: arm.id,
                    userId: userId,
                    role: 'arm_owner',
                    status: 'active',
                },
            });
            isArmOwner = !!membership;

            // بررسی نقش سیستمی
            const user = await this.prisma.user.findUnique({
                where: { id: userId },
                select: { role: true },
            });

        }

        return {
            ...arm,
            categoryTree,
            locationTree,
            isArmOwner,

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

        const categoryTree = await this.buildCategoryTreeFromConfig(arm.config);
        const locationTree = await this.buildLocationTreeFromConfig(arm.config);

        return {
            ...arm,
            categoryTree,
            locationTree,
        };
    }

    // ============================================================
    // 4. لیست بازارهای کاربر (همراه config)
    // ============================================================
    async getUserArms(userId: string) {
        const memberships = await this.prisma.armMembership.findMany({
            where: { userId },
            select: {
                role: true,
                status: true,
                joinedAt: true,
                businessId: true,
                rejectionReason: true,   // ✅ اضافه شود
                metadata: true,          // ✅ اضافه شود (اختیاری ولی مفید)
                arm: {
                    include: {
                        _count: {
                            select: {
                                memberships: { where: { status: 'active' } },
                                ads: { where: { status: 'active' } },
                            },
                        },
                    },
                },
            },
            orderBy: { joinedAt: 'desc' },
        });

        const result = [];
        for (const m of memberships) {
            const categoryTree = await this.buildCategoryTreeFromConfig(m.arm.config);
            const locationTree = await this.buildLocationTreeFromConfig(m.arm.config);

            result.push({
                ...m.arm,
                categoryTree,
                locationTree,
                role: m.role,
                status: m.status,
                rejectionReason: m.rejectionReason,   // ✅
                joinedAt: m.joinedAt,
                businessId: m.businessId,
                metadata: m.metadata,                 // ✅
            });
        }

        return result;
    }

    // ============================================================
    // 5. عضویت کاربر در بازار
    // ============================================================
    async join(
        userId: string,
        slug: string,
        roleType?: 'seller' | 'buyer',
        businessId?: string,
    ) {
        // ۱. پیدا کردن بازو
        const arm = await this.prisma.arm.findUnique({
            where: { slug },
        });
        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازوی مورد نظر یافت نشد',
            });
        }

        const config = arm.config as any || {};
        const requireBusiness = config.accessRules?.requireBusinessForMembership ?? false;
        const requireApproval = config.accessRules?.requireAdminApprovalForMembership ?? false;

        // ۲. بررسی نیاز به کسب‌وکار
        if (requireBusiness && !businessId) {
            throw new BadRequestException({
                errorCode: 'BUSINESS_REQUIRED',
                message: 'برای عضویت در این بازار، ابتدا باید کسب‌وکار خود را انتخاب کنید.',
            });
        }

        // ۳. اعتبارسنجی businessId (اگر ارسال شده)
        if (businessId) {
            const business = await this.prisma.business.findFirst({
                where: { id: businessId, ownerUserId: userId },
            });
            if (!business) {
                throw new BadRequestException({
                    errorCode: 'BUSINESS_NOT_FOUND',
                    message: 'کسب‌وکار یافت نشد یا متعلق به شما نیست',
                });
            }
        }

        // ۴. بررسی عضویت قبلی
        const existing = await this.prisma.armMembership.findFirst({
            where: { armId: arm.id, userId: userId },
        });

        const finalStatus = requireApproval ? 'pending' : 'active';

        if (existing) {
            if (existing.status === 'active') {
                throw new BadRequestException({
                    errorCode: 'ALREADY_MEMBER',
                    message: 'شما قبلاً عضو این بازار هستید',
                });
            }

            // اگر قبلاً عضویت داشته ولی غیرفعال/رد شده، دوباره فعال/در انتظار می‌کنیم
            return this.prisma.armMembership.update({
                where: { id: existing.id },
                data: {
                    status: finalStatus,
                    rejectionReason: null,
                    joinedAt: new Date(),
                    roleType: roleType || existing.roleType || null,
                    businessId: businessId || existing.businessId,
                    source: 'manual',
                    metadata: {
                        joined_at: new Date().toISOString(),
                        role_type: roleType || existing.roleType || null,
                    },
                },
            });
        }

        // ۵. ایجاد عضویت جدید
        return this.prisma.armMembership.create({
            data: {
                armId: arm.id,
                userId: userId,
                status: finalStatus,
                role: 'arm_member',
                roleType: roleType || null,
                businessId: businessId || null,
                source: 'manual',
                metadata: {
                    joined_at: new Date().toISOString(),
                    role_type: roleType || null,
                },
            },
        });
    }

    // ============================================================
    // 6. خروج از بازار
    // ============================================================
    async leave(userId: string, slug: string) {
        const arm = await this.prisma.arm.findUnique({ where: { slug } });
        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازاری مورد نظر یافت نشد',
            });
        }

        const membership = await this.prisma.armMembership.findFirst({
            where: {
                armId: arm.id,
                userId: userId,
                status: 'active',
            },
        });

        if (!membership) {
            throw new BadRequestException({
                errorCode: 'NOT_MEMBER',
                message: 'شما عضو این بازار نیستید',
            });
        }

        if (membership.role === 'arm_owner') {
            throw new BadRequestException({
                errorCode: 'ADMIN_CANNOT_LEAVE',
                message: 'مدیر بازار نمی‌تواند از بازار خارج شود. ابتدا نقش خود را به فرد دیگری منتقل کنید.',
            });
        }

        return this.prisma.armMembership.update({
            where: { id: membership.id },
            data: { status: 'paused' },
        });
    }

    // ============================================================
// متد validateRoleType (جدید)
// ============================================================


    private async validateRoleType(
        userId: string,
        slug: string,
        requestedRole?: 'seller' | 'buyer',
        businessId?: string,
    ): Promise<'seller' | 'buyer'> {
        // ۱. اگر کاربر نقش درخواست کرده، آن را برگردان
        if (requestedRole) {
            return requestedRole;
        }

        // ۲. خواندن تنظیمات بازار
        const arm = await this.prisma.arm.findUnique({
            where: { slug },
            select: { config: true },
        });
        const config = arm?.config as any || {};

        // ✅ استفاده از supplierIndustryIds و buyerIndustryIds (از مدل Industry)
        const supplierIndustryIds: string[] = config.supplierIndustryIds || [];
        const buyerIndustryIds: string[] = config.buyerIndustryIds || [];
        const allowManual = config.allowManualRoleSelection ?? true;

        // ۳. اگر کسب‌وکار مشخص شده، صنف آن را بگیر
        if (businessId) {
            const business = await this.prisma.business.findUnique({
                where: { id: businessId },
                select: { industryId: true },
            });

            if (business?.industryId) {
                if (supplierIndustryIds.includes(business.industryId)) {
                    return 'seller';
                }
                if (buyerIndustryIds.includes(business.industryId)) {
                    return 'buyer';
                }
            }
        }

        // ۴. اگر هیچ‌کدام تطابق نداشت و تنظیمات اجازه نمی‌دهد
        if (!allowManual) {
            throw new BadRequestException({
                errorCode: 'ROLE_NOT_ALLOWED',
                message: 'نقش شما با صنف کسب‌وکارتان در این بازار تطابق ندارد. لطفاً ابتدا صنف خود را تکمیل کنید.',
            });
        }

        // ۵. اگر کاربر قبلاً نقش داشته، همان را برگردان
        const existing = await this.prisma.armMembership.findFirst({
            where: { userId, arm: { slug } },
            select: { roleType: true },
        });
        if (existing?.roleType) {
            return existing.roleType as 'seller' | 'buyer';
        }

        return 'seller'; // پیش‌فرض
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
    // 8. به‌روزرسانی بازار (فقط مدیر بازار یا مدیر سیستم)
    // ============================================================
    async updateArm(armId: string, userId: string, dto: Partial<CreateArmDto>) {
        if (dto.customDomain) {
            const existingDomain = await this.prisma.arm.findFirst({   // ← findFirst
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

        // ساخت دیتای به‌روزرسانی
        const updateData: any = {};

        // فیلدهای اصلی
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
        if (dto.rankingAlgorithm) updateData.rankingAlgorithm = dto.rankingAlgorithm;
        if (dto.metadata !== undefined) updateData.metadata = dto.metadata;

        // ✅ به‌روزرسانی config (اگر ارسال شده باشد)
        if (dto.config) {
            // اعتبارسنجی مجدد دسته‌بندی‌ها و موقعیت‌ها
            const categoryIds = dto.config.categorySelections?.map(c => c.categoryId) || [];
            if (categoryIds.length > 0) {
                const categories = await this.prisma.productCategory.findMany({
                    where: { id: { in: categoryIds }, isActive: true },
                });
                if (categories.length !== categoryIds.length) {
                    throw new BadRequestException({
                        errorCode: 'SOME_CATEGORIES_NOT_FOUND',
                        message: 'برخی از دسته‌بندی‌های انتخاب‌شده وجود ندارند یا غیرفعال هستند.',
                    });
                }
            }

            const locationIds = dto.config.locationSelections?.map(l => l.locationId) || [];
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

            // ✅ دریافت عنوان واحدها برای هر دسته‌بندی (اگر categorySelections تغییر کرده باشد)
            let updatedConfig = { ...dto.config };
            if (dto.config.categorySelections) {
                const categorySelectionsWithUnits = [];
                for (const sel of dto.config.categorySelections) {
                    let unitTitle = 'تن';
                    if (sel.overrideUnitId) {
                        const unit = await this.prisma.unit.findUnique({
                            where: { id: sel.overrideUnitId },
                            select: { title: true },
                        });
                        if (unit) {
                            unitTitle = unit.title;
                        }
                    }
                    categorySelectionsWithUnits.push({
                        ...sel,
                        overrideUnitTitle: unitTitle,
                    });
                }
                updatedConfig = {
                    ...updatedConfig,
                    categorySelections: categorySelectionsWithUnits,
                };
            }

            updateData.config = updatedConfig as any;
        }

        return this.prisma.arm.update({
            where: { id: armId },
            data: updateData,
        });
    }

    // ============================================================
    // 9. حذف بازار (soft delete) - فقط مدیر
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
            data: {
                status: 'archived',
                updatedAt: new Date(),
            },
        });
    }

    // ============================================================
    // 10. دریافت درخت دسته‌بندی بازار از config
    // ============================================================
    async getArmCategoryTree(slug: string, nodeId?: string) {
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

        const tree = await this.buildCategoryTreeFromConfig(arm.config, nodeId);
        return tree;
    }

    // ============================================================
    // 11. دریافت درخت موقعیت‌های بازار از config
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

        const tree = await this.buildLocationTreeFromConfig(arm.config);
        return tree;
    }

    // ============================================================
    // 12. بررسی عضویت کاربر
    // ============================================================
    async isMember(userId: string, armId: string) {
        const membership = await this.prisma.armMembership.findFirst({
            where: {
                armId,
                userId,
                status: 'active',
            },
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
        return user?.role ===  SystemRole.system_admin;
    }

    // ============================================================
    // 14. ساخت درخت دسته‌بندی از config (با Smart Trimming)
    // ============================================================
    // src/arm/arm.service.ts

    // src/arm/arm.service.ts - buildCategoryTreeFromConfig بهینه‌شده
    // فایل: src/arm/arm.service.ts
// متد: private async buildCategoryTreeFromConfig

    // src/arm/arm.service.ts

    private async buildCategoryTreeFromConfig(config: any, nodeId?: string): Promise<any[]> {
        if (!config?.categorySelections || config.categorySelections.length === 0) {
            return [];
        }

        const selections = config.categorySelections;
        const leafIds = selections.map((s: any) => s.categoryId);

        // ۱. دریافت برگ‌های انتخاب‌شده
        const leaves = await this.prisma.productCategory.findMany({
            where: { id: { in: leafIds }, isActive: true },
            select: { id: true, title: true, slug: true, path: true, level: true, parentId: true, defaultUnitId: true },
        });

        // ۲. استخراج مسیرهای اجداد
        const ancestorPaths = new Set<string>();
        for (const leaf of leaves) {
            const parts = leaf.path.split('.');
            for (let i = 0; i < parts.length; i++) {
                ancestorPaths.add(parts.slice(0, i + 1).join('.'));
            }
        }

        // ۳. دریافت همه گره‌های درگیر (برگ + اجداد)
        const allCategories = await this.prisma.productCategory.findMany({
            where: { path: { in: Array.from(ancestorPaths) }, isActive: true },
            select: { id: true, title: true, slug: true, path: true, level: true, parentId: true, defaultUnitId: true },
        });

        // ۴. نگاشت انتخاب‌ها
        const selectionMap = new Map<string, any>();
        selections.forEach((s: any) => selectionMap.set(s.categoryId, s));

        // ۵. واکشی واحدهای override شده و واحدهای موجود در CategoryUnitMapping
        type UnitInfo = { id: string; title: string; shortCode: string };

        const overrideUnitIds = [...new Set(selections.map((s: any) => s.overrideUnitId).filter(Boolean))] as string[];
        const overrideUnits: UnitInfo[] = overrideUnitIds.length > 0
            ? await this.prisma.unit.findMany({
                where: { id: { in: overrideUnitIds } },
                select: { id: true, title: true, shortCode: true },
            })
            : [];

        const allMappings = await this.prisma.categoryUnitMapping.findMany({
            where: { categoryId: { in: leafIds } },
            include: { unit: { select: { id: true, title: true, shortCode: true } } },
        });

        const unitMap = new Map<string, UnitInfo>(overrideUnits.map(u => [u.id, u] as [string, UnitInfo]));

        // نگاشت هر categoryId به آرایه‌ای از واحدهای معتبر (با اولویت default)
        const categoryUnitsMap = new Map<string, UnitInfo[]>();
        for (const m of allMappings) {
            if (!categoryUnitsMap.has(m.categoryId)) categoryUnitsMap.set(m.categoryId, []);
            categoryUnitsMap.get(m.categoryId)!.push({ id: m.unit.id, title: m.unit.title, shortCode: m.unit.shortCode });
        }

        // تابع کمکی برای یافتن بهترین واحد معتبر
        const resolveUnit = (catId: string, overrideId: string | null): UnitInfo | null => {
            if (overrideId && unitMap.has(overrideId)) {
                return unitMap.get(overrideId)!;
            }
            const defaultMapping = allMappings.find(m => m.categoryId === catId && m.isDefault);
            if (defaultMapping) {
                return { id: defaultMapping.unit.id, title: defaultMapping.unit.title, shortCode: defaultMapping.unit.shortCode };
            }
            const available = categoryUnitsMap.get(catId);
            if (available && available.length > 0) {
                return available[0];
            }
            return null;
        };

        // ۶. ساخت nodeMap
        const nodeMap = new Map<string, any>();
        for (const cat of allCategories) {
            const isSelected = selectionMap.has(cat.id);
            const selection = selectionMap.get(cat.id);
            const unit = isSelected ? resolveUnit(cat.id, selection?.overrideUnitId) : null;
            const unitId = unit?.id || null;
            const unitTitle = unit?.title || (selection?.overrideUnitTitle ?? 'تن');
            const unitShortCode = unit?.shortCode || unitTitle;

            nodeMap.set(cat.path, {
                id: cat.id,
                title: cat.title,
                slug: cat.slug,
                path: cat.path,
                level: cat.level,
                parentId: cat.parentId,
                isSelected,
                customLabel: isSelected ? selection?.customLabel : null,
                defaultUnitId: unitId,
                unitTitle,
                unitShortCode,
                defaultMinQuantity: selection?.overrideMinQuantity || null,
                example: selection?.example || null,
                children: [],
            });
        }

        // ۷. اتصال فرزندان به والدین
        const roots: any[] = [];
        for (const [path, node] of nodeMap) {
            if (node.parentId) {
                const parentPath = path.split('.').slice(0, -1).join('.');
                const parent = nodeMap.get(parentPath);
                if (parent) parent.children.push(node);
                else roots.push(node);
            } else {
                roots.push(node);
            }
        }

        // ۸. مرتب‌سازی فرزندان
        const sortChildren = (nodes: any[]) => {
            nodes.forEach(node => {
                if (node.children?.length) {
                    node.children.sort((a: any, b: any) => (selectionMap.get(a.id)?.displayPriority ?? 999) - (selectionMap.get(b.id)?.displayPriority ?? 999));
                    sortChildren(node.children);
                }
            });
        };
        sortChildren(roots);

        // ۹. هرس گره‌های تک‌فرزندی غیرانتخابی (برای سطوح داخلی)
        const trimSingleChildNodes = (nodes: any[]): any[] => {
            return nodes.reduce((acc: any[], node: any) => {
                const trimmedChildren = trimSingleChildNodes(node.children || []);
                if (!node.isSelected && trimmedChildren.length === 1) {
                    acc.push(trimmedChildren[0]);
                } else {
                    acc.push({ ...node, children: trimmedChildren });
                }
                return acc;
            }, []);
        };

        // ✅ جدید: collapse ریشه تکی، حتی اگر چند فرزند داشته باشد
        const collapseSingleRoot = (nodes: any[]): any[] => {
            while (nodes.length === 1 && !nodes[0].isSelected && nodes[0].children?.length > 0) {
                nodes = nodes[0].children;
            }
            return nodes;
        };

        // ۱۰. ترکیب هرس و collapse
        let trimmedRoots = collapseSingleRoot(trimSingleChildNodes(roots));

        // ۱۱. بازگشت زیردرخت در صورت درخواست nodeId
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
            const foundNode = findNode(trimmedRoots);
            return foundNode ? [foundNode] : [];
        }

        return trimmedRoots;
    }

    // ============================================================
    // 15. ساخت درخت موقعیت‌ها از config
    // ============================================================
    // src/arm/arm.service.ts

    private async buildLocationTreeFromConfig(config: any): Promise<any[]> {
        if (!config?.locationSelections || config.locationSelections.length === 0) {
            return [];
        }

        const selections = config.locationSelections;
        const locationIds = selections.map((s: any) => s.locationId);

        // ✅ فیلتر کردن locationIds که معتبر هستند (ObjectId 24 کاراکتری)
        const validLocationIds = locationIds.filter((id: string) => /^[0-9a-fA-F]{24}$/.test(id));

        if (validLocationIds.length === 0) {
            return [];
        }

        // دریافت اطلاعات کامل موقعیت‌ها از دیتابیس
        const locations = await this.prisma.location.findMany({
            where: {
                id: { in: validLocationIds },
                isActive: true,
            },
            include: {
                parent: {
                    select: {
                        id: true,
                        title: true,
                        type: true,
                        provinceCode: true,
                    },
                },
            },
        });

        // گروه‌بندی بر اساس استان
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

            const selection = selections.find(s => s.locationId === city.id);
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
    // 16. Smart Trimming: حذف گره‌های تکی غیرانتخابی
    // ============================================================
    private smartTrim(nodes: any[]): any[] {
        if (!nodes || nodes.length === 0) return [];

        const trimmedChildren = nodes.map(node => ({
            ...node,
            children: this.smartTrim(node.children || []),
        }));

        if (trimmedChildren.length === 1) {
            const onlyNode = trimmedChildren[0];
            if (!onlyNode.isSelected && onlyNode.children && onlyNode.children.length > 0) {
                return onlyNode.children;
            }
        }

        return trimmedChildren;
    }

    // src/arm/arm.service.ts

// ============================================================
// 17. حذف کامل بازار و تمام وابسته‌ها (Hard Delete) - فقط توسعه
// ============================================================
    async hardDelete(armId: string, userId: string) {
        // فقط در محیط توسعه
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

        // حذف همه وابسته‌ها با تراکنش
        await this.prisma.$transaction([
            // ۱. حذف بازدیدهای آگهی‌ها
            this.prisma.adView.deleteMany({
                where: { ad: { armId: armId } },
            }),
            // ۲. حذف رویدادهای تماس
            this.prisma.callEvent.deleteMany({
                where: { ad: { armId: armId } },
            }),
            // ۳. حذف آگهی‌ها
            this.prisma.ad.deleteMany({ where: { armId: armId } }),
            // ۴. حذف درخواست‌های خرید
            this.prisma.buyLead.deleteMany({ where: { armId: armId } }),
            // ۵. حذف عضویت‌ها
            this.prisma.armMembership.deleteMany({ where: { armId: armId } }),
            // ۶. حذف دسته‌بندی‌های اختصاصی
            this.prisma.customCategory.deleteMany({ where: { armId: armId } }),
            // ۷. حذف تراکنش‌های اعتباری مرتبط
            this.prisma.credit.deleteMany({ where: { armId: armId } }),
            // ۸. حذف درخواست‌های اعتباری مرتبط
            this.prisma.creditRequest.deleteMany({ where: { armId: armId } }),
            // ۹. حذف امتیازات اعتماد مرتبط
            this.prisma.trustMetric.deleteMany({ where: { armId: armId } }),
            // ۱۰. حذف فایل‌های مرتبط
            this.prisma.file.deleteMany({ where: { relatedModel: 'Arm', relatedId: armId } }),
            // ۱۱. حذف خود بازار
            this.prisma.arm.delete({ where: { id: armId } }),
        ]);

        return {
            message: 'بازار و تمام وابسته‌های آن با موفقیت حذف شدند',
            deletedArm: {
                id: arm.id,
                slug: arm.slug,
                name: arm.name,
            },
        };
    }
}