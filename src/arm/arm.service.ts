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

        // بررسی موقعیت‌ها
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

        // ✅ ساخت locationTree
        const locationTree = await this.buildLocationTreeFromConfig(dto.config);

        // ایجاد بازار با تراکنش
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
                    rankingAlgorithm: dto.rankingAlgorithm || 'simple',
                    metadata: dto.metadata || null,
                    // ✅ categoryTree خالی
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
    // 2. دریافت بازار با slug
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

        // پیدا کردن لوگو
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

        // ✅ categoryTree مستقیم از فیلد سطح بالا
        const categoryTree = arm.categoryTree || [];

        // ✅ allowedCategoryScopeTree - اول از فیلد سطح بالا، بعد از داخل config
        // چون ممکنه داده‌های قدیمی داخل config ذخیره شده باشن
        const allowedCategoryScopeTree = arm.allowedCategoryScopeTree ||
            config.allowedCategoryScopeTree || [];

        // ✅ اگر allowedCategoryScopeTree داخل config بود ولی در فیلد سطح بالا نبود،
        // مهاجرت داده به فیلد سطح بالا (آپدیت خودکار)
        if (!arm.allowedCategoryScopeTree && config.allowedCategoryScopeTree) {
            await this.prisma.arm.update({
                where: { id: arm.id },
                data: {
                    allowedCategoryScopeTree: config.allowedCategoryScopeTree,
                },
            }).catch(() => {
                // اگر آپدیت شکست خورد، مشکلی نیست، داده رو از config می‌خونیم
            });
        }

        // ✅ locationTree از cached یا rebuild
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

        let isArmOwner = false;
        let isSystemAdmin = false;

        if (userId) {
            const [membership, user] = await Promise.all([
                this.prisma.armMembership.findFirst({
                    where: {
                        armId: arm.id,
                        userId: userId,
                        role: 'arm_owner',
                        status: 'active',
                    },
                    select: { role: true },
                }),
                this.prisma.user.findUnique({
                    where: { id: userId },
                    select: { role: true },
                }),
            ]);

            isArmOwner = !!membership;
            isSystemAdmin = user?.role === SystemRole.system_admin;
        }

        // ✅ پاک‌سازی config از فیلدهایی که به سطح بالا منتقل شدن
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
            isArmOwner,
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

        // پیدا کردن لوگو
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

        // ✅ categoryTree مستقیم از فیلد سطح بالا
        const categoryTree = arm.categoryTree || [];

        // ✅ allowedCategoryScopeTree - اول از فیلد سطح بالا، بعد از داخل config
        const allowedCategoryScopeTree = arm.allowedCategoryScopeTree ||
            config.allowedCategoryScopeTree || [];

        // ✅ مهاجرت خودکار داده
        if (!arm.allowedCategoryScopeTree && config.allowedCategoryScopeTree) {
            await this.prisma.arm.update({
                where: { id: arm.id },
                data: {
                    allowedCategoryScopeTree: config.allowedCategoryScopeTree,
                },
            }).catch(() => {});
        }

        // ✅ locationTree
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

        // ✅ پاک‌سازی config
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
    // 4. لیست بازارهای کاربر
    // ============================================================
    async getUserArms(userId: string) {
        const memberships = await this.prisma.armMembership.findMany({
            where: { userId },
            select: {
                role: true,
                status: true,
                rejectionReason: true,
                joinedAt: true,
                roleType: true,
                businessId: true,
                business: {
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
                        categoryTree: true, // ✅ اضافه
                    },
                },
            },
            orderBy: { joinedAt: 'desc' },
        });

        if (memberships.length === 0) return [];

        const armIds = memberships.map(m => m.arm.id);

        const logoFiles = await this.prisma.file.findMany({
            where: {
                relatedModel: 'Arm',
                relatedId: { in: armIds },
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

            result.push({
                id: m.arm.id,
                slug: m.arm.slug,
                name: m.arm.name,
                slogan: m.arm.slogan,
                colorPrimary: m.arm.colorPrimary,
                logoUrl: logoUrl,
                role: m.role,
                status: m.status,
                rejectionReason: m.rejectionReason,
                joinedAt: m.joinedAt,
                roleType: m.roleType,
                businessId: m.businessId,
                business: m.business,
                categoryTree: m.arm.categoryTree || [], // ✅ اضافه
            });
        }

        return result;
    }

    // ============================================================
    // 5. پیوستن به بازار
    // ============================================================
    async join(userId: string, slug: string, roleType?: 'seller' | 'buyer', businessId?: string) {
        const arm = await this.prisma.arm.findUnique({ where: { slug } });
        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازار مورد نظر یافت نشد',
            });
        }

        const config = arm.config as any || {};
        const requireBusiness = config.accessRules?.requireBusinessForMembership ?? false;
        const requireApproval = config.accessRules?.requireAdminApprovalForMembership ?? false;

        if (requireBusiness && !businessId) {
            throw new BadRequestException({
                errorCode: 'BUSINESS_REQUIRED',
                message: 'برای پیوستن به این بازار، ابتدا باید کسب‌وکار خود را انتخاب کنید.',
            });
        }

        if (businessId) {
            const business = await this.prisma.business.findFirst({
                where: { id: businessId, ownerUserId: userId },
                select: { id: true, name: true },
            });
            if (!business) {
                throw new BadRequestException({
                    errorCode: 'BUSINESS_NOT_FOUND',
                    message: 'کسب‌وکار یافت نشد یا متعلق به شما نیست',
                });
            }
        }

        const existing = await this.prisma.armMembership.findFirst({
            where: { armId: arm.id, userId: userId },
        });

        const finalStatus = requireApproval ? 'pending' : 'active';

        if (existing) {
            if (existing.status === 'active' && existing.businessId) {
                throw new BadRequestException({
                    errorCode: 'ALREADY_MEMBER',
                    message: 'شما قبلاً به این بازار پیوسته‌اید',
                });
            }

            return this.prisma.armMembership.update({
                where: { id: existing.id },
                data: {
                    status: existing.status === 'active' ? 'active' : finalStatus,
                    rejectionReason: null,
                    joinedAt: new Date(),
                    roleType: roleType || existing.roleType || null,
                    businessId: businessId || existing.businessId,
                    source: 'manual',
                },
            });
        }

        return this.prisma.armMembership.create({
            data: {
                armId: arm.id,
                userId: userId,
                status: finalStatus,
                role: 'arm_member',
                roleType: roleType || null,
                businessId: businessId || null,
                source: 'manual',
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
            where: { armId: arm.id, userId: userId, status: 'active' },
        });

        if (!membership) {
            throw new BadRequestException({
                errorCode: 'NOT_MEMBER',
                message: 'شما به این بازار نپیوسته‌اید',
            });
        }

        if (membership.role === 'arm_owner') {
            throw new BadRequestException({
                errorCode: 'ADMIN_CANNOT_LEAVE',
                message: 'مدیر بازار نمی‌تواند از بازار خارج شود.',
            });
        }

        return this.prisma.armMembership.update({
            where: { id: membership.id },
            data: { status: 'paused' },
        });
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
        if (dto.rankingAlgorithm) updateData.rankingAlgorithm = dto.rankingAlgorithm;
        if (dto.metadata !== undefined) updateData.metadata = dto.metadata;

        // ✅ ذخیره categoryTree
        if ((dto as any).categoryTree !== undefined) {
            updateData.categoryTree = (dto as any).categoryTree;
        }

        if (dto.config) {
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

            let updatedConfig = { ...dto.config };

            // ✅ حذف categorySelections و _cachedCategoryTree از config
            delete updatedConfig.categorySelections;
            delete updatedConfig._cachedCategoryTree;
            delete updatedConfig._treeUpdatedAt;

            // ✅ locationTree فقط اگه تغییر کرده
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
            this.prisma.customCategory.deleteMany({ where: { armId: armId } }),
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
}