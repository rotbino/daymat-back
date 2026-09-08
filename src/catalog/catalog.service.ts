// src/catalog/catalog.service.ts
import {
    Injectable,
    NotFoundException,
    ConflictException,
    BadRequestException,
    ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCatalogDto, UpdateCatalogDto } from './catalog.dto';
import { CatalogRole } from '../common/enums/prisma-enums';

/**
 * کاتالوگ — ویترینِ یک نهاد تجاری.
 * ⚠️ مالکیت فقط از مسیر Business: catalog.business.ownerUserId
 *    (رلیشن مستقیم Catalog→User حذف شده)
 * تیک اعتماد: روی نهاد (Business) — این سرویس فقط می‌خواند، نمی‌نویسد.
 * صنف: industryName (متن) روی هر دو؛ رلیشن Industry حذف شده.
 */
@Injectable()
export class CatalogService {
    private readonly RESERVED_SLUGS = [
        'dashboard', 'api', 'admin', 'login', 'register', 'profile',
        'c', 'ad', 'arm', 'arms', 'business', 'docs', 'feedback',
        'credit', 'saved-ads', 'no-arm', 'new-home', 'catalog', 'catalogs',
        'market', 'my-catalogs', 'notifications',
    ];

    constructor(private prisma: PrismaService) {}

    // ─── اسلاگ ───
    private normalizeSlug(input: string): string {
        return (input ?? '')
            .replace(/\s+/g, '-')
            .replace(/[^\u0600-\u06FF\u0750-\u077F\w\-]/g, '')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .substring(0, 40);
    }

    private validateSlugOrThrow(raw: string): string {
        const slug = this.normalizeSlug(raw);
        if (!slug || slug.length < 3) {
            throw new BadRequestException({ errorCode: 'INVALID_SLUG', message: 'آدرس کاتالوگ باید حداقل ۳ حرف باشد' });
        }
        if (this.RESERVED_SLUGS.includes(slug.toLowerCase())) {
            throw new BadRequestException({ errorCode: 'SLUG_RESERVED', message: 'این آدرس قابل انتخاب نیست' });
        }
        return slug;
    }

    private async ensureSlugAvailable(slug: string, excludeId?: string): Promise<void> {
        const [cat, arm] = await Promise.all([
            this.prisma.catalog.findFirst({
                where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
                select: { id: true },
            }),
            this.prisma.arm.findFirst({ where: { slug }, select: { id: true } }),
        ]);
        if (cat || arm) {
            throw new ConflictException({ errorCode: 'SLUG_TAKEN', message: 'این آدرس قبلاً گرفته شده است' });
        }
    }

    async checkSlugAvailability(raw: string, excludeId?: string) {
        const slug = this.normalizeSlug(raw);
        if (!slug || slug.length < 3) return { available: false, reason: 'invalid', slug };
        if (this.RESERVED_SLUGS.includes(slug.toLowerCase())) return { available: false, reason: 'reserved', slug };
        const [cat, arm] = await Promise.all([
            this.prisma.catalog.findFirst({
                where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
                select: { id: true },
            }),
            this.prisma.arm.findFirst({ where: { slug }, select: { id: true } }),
        ]);
        return { available: !cat && !arm, slug };
    }

    // ─── مالکیت ───
    private async getOwnedCatalog(catalogId: string, userId: string) {
        const catalog = await this.prisma.catalog.findUnique({
            where: { id: catalogId },
            include: {
                // ✅ فیلدهای کامل business — برای نمایش در CatalogEditModal
                business: {
                    select: {
                        id: true,
                        ownerUserId: true,
                        name: true,
                        industryId: true,        // ✅ برای autocomplete
                        industryName: true,      // ✅ برای نمایش
                        phone: true,             // ✅ برای فیلد تماس
                        logoUrl: true,           // ✅ برای لوگو
                        province: true,          // ✅ برای نمایش موقعیت
                        provinceCode: true,
                        city: true,
                        cityCode: true,
                        type: true,
                        verificationStatus: true,
                        verificationTier: true,
                    },
                },
            },
        });
        if (!catalog) {
            throw new NotFoundException({ errorCode: 'CATALOG_NOT_FOUND', message: 'کاتالوگ یافت نشد' });
        }
        if (catalog.business.ownerUserId !== userId) {
            throw new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'شما به این کاتالوگ دسترسی ندارید' });
        }
        return catalog;
    }

    private async getUserBusinessIds(userId: string): Promise<string[]> {
        const bizs = await this.prisma.business.findMany({
            where: { ownerUserId: userId, status: 'active' },
            select: { id: true },
        });
        return bizs.map((b) => b.id);
    }

    // ============================================================
    // ثبت کاتالوگ — الزاماً برای یک نهاد
    // ============================================================
    async create(userId: string, dto: CreateCatalogDto) {
        if (!dto.businessId) {
            throw new BadRequestException({
                errorCode: 'BUSINESS_REQUIRED',
                message: 'کاتالوگ باید برای یک کسب‌وکار ساخته شود',
            });
        }
        const biz = await this.prisma.business.findUnique({
            where: { id: dto.businessId },
            select: { id: true, ownerUserId: true },
        });
        if (!biz) {
            throw new NotFoundException({ errorCode: 'BUSINESS_NOT_FOUND', message: 'کسب‌وکار یافت نشد' });
        }
        if (biz.ownerUserId !== userId) {
            throw new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'این کسب‌وکار متعلق به شما نیست' });
        }

        const dup = await this.prisma.catalog.findFirst({
            where: { businessId: biz.id, name: dto.name, status: 'active' },
        });
        if (dup) {
            throw new ConflictException({
                errorCode: 'DUPLICATE_CATALOG_NAME',
                message: 'برای این کسب‌وکار قبلاً کاتالوگی با این نام ساخته‌اید',
            });
        }

        const slug = this.validateSlugOrThrow(dto.slug || dto.name);
        await this.ensureSlugAvailable(slug);

        let refCode: string | null = null;
        let refUserId: string | null = null;
        const rawRef = (dto.refCode ?? '').trim().slice(0, 16);
        if (rawRef) {
            const refUser = await this.prisma.user.findUnique({
                where: { referralCode: rawRef },
                select: { id: true },
            });
            if (refUser && refUser.id !== userId) {
                refCode = rawRef;
                refUserId = refUser.id;
            }
        }

        const catalog = await this.prisma.catalog.create({
            data: {
                businessId: biz.id,
                name: dto.name,
                slug,
                salesType: dto.salesType === 'retail' ? 'retail' : 'wholesale',
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
                // ✅ industryId حذف — صنف فقط متن آزاد (industryName)
                industryName: dto.industryName || null,
                referredByCode: refCode,
                referredByUserId: refUserId,
                status: 'active',
            },
        });

        await this.prisma.teamMember.create({
            data: {
                catalogId: catalog.id,
                userId,
                role: CatalogRole.catalog_owner,
                status: 'active',
                permissions: { canManageCatalog: true, canManageAds: true, canManageTeam: true },
            },
        });

        if (dto.armSlug) {
            const arm = await this.prisma.arm.findUnique({ where: { slug: dto.armSlug }, select: { id: true } });
            if (arm) {
                await this.prisma.armMembership.updateMany({
                    where: { armId: arm.id, userId, status: 'active' },
                    data: { catalogId: catalog.id },
                });
            }
        }

        if (refUserId) {
            const me = await this.prisma.user.findUnique({
                where: { id: userId },
                select: { referredByUserId: true },
            });
            if (!me?.referredByUserId) {
                await this.prisma.user.update({
                    where: { id: userId },
                    data: { referredByUserId: refUserId, referredAt: new Date() },
                });
            }
        }

        return catalog;
    }

    async createForBusiness(userId: string, dto: CreateCatalogDto & { businessId?: string }) {
        return this.create(userId, dto);
    }

    // ============================================================
    // لیست کاتالوگ‌های کاربر — از مسیر نهادها
    // ============================================================
    async findAllByUser(userId: string) {
        const bizIds = await this.getUserBusinessIds(userId);

        const catalogs = await this.prisma.catalog.findMany({
            where: { businessId: { in: bizIds }, status: { not: 'closed' } },
            include: {
                // ✅ فیلدهای business — برای CatalogEditModal (صنف، لوگو، موقعیت، تماس)
                business: {
                    select: {
                        id: true,
                        name: true,
                        industryId: true,        // ✅ برای autocomplete در مودال ویرایش
                        industryName: true,      // ✅ برای نمایش صنف ذخیره‌شده
                        phone: true,             // ✅ برای فیلد تماس
                        logoUrl: true,           // ✅ برای لوگو
                        province: true,
                        provinceCode: true,
                        city: true,
                        cityCode: true,
                        type: true,
                        verificationStatus: true,
                        verificationTier: true,
                    },
                },
                armMemberships: {
                    where: { status: { not: 'deleted' } },
                    include: { arm: { select: { id: true, slug: true, name: true, icon: true, colorPrimary: true } } },
                },
                _count: {
                    select: {
                        ads: { where: { status: 'active' } },
                        armMemberships: { where: { status: 'active' } },
                    },
                },
            },
            orderBy: { createdAt: 'asc' },
        });

        const result = [];
        for (const catalog of catalogs) {
            const logoFile = await this.prisma.file.findFirst({
                where: { relatedModel: 'Catalog', relatedId: catalog.id, fieldKey: 'logo' },
                select: { id: true, path: true, thumbnailPath: true, fieldKey: true },
            });
            result.push({
                ...catalog,
                logoFile: logoFile || null,
                logoUrl: logoFile?.path || catalog.logoUrl || null,
                activeAdsCount: catalog._count.ads,
                activeMembershipsCount: catalog._count.armMemberships,
            });
        }
        return result;
    }

    async getActiveCatalog(userId: string) {
        const list = await this.findAllByUser(userId);
        return list[0] ?? null;
    }

    // ============================================================
    // جزئیات یک کاتالوگ — فعالیت‌ها و تیک از مسیر نهاد
    // ============================================================
    async findOne(id: string, userId: string) {
        const owned = await this.getOwnedCatalog(id, userId);

        const [activeAdsCount, expiredAdsCount] = await Promise.all([
            this.prisma.ad.count({ where: { catalogId: id, status: 'active', expiresAt: { gt: new Date() } } }),
            this.prisma.ad.count({
                where: {
                    catalogId: id,
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
            where: { relatedModel: 'Catalog', relatedId: id, fieldKey: 'logo' },
            select: { id: true, path: true, thumbnailPath: true, fieldKey: true },
        });

        const catalog = await this.prisma.catalog.findUnique({
            where: { id },
            include: {
                business: {
                    include: {
                        activities: {
                            include: {
                                activity: {
                                    select: { id: true, title: true, slug: true, path: true, level: true },
                                },
                            },
                        },
                        // ✅ تیک اعتماد از نهاد
                        verifications: {
                            orderBy: { submittedAt: 'desc' },
                            select: { id: true, tier: true, status: true, notes: true, submittedAt: true, reviewedAt: true },
                            take: 1,
                        },
                    },
                },
                armMemberships: {
                    where: { status: { not: 'deleted' } },
                    include: { arm: { select: { id: true, slug: true, name: true, icon: true, colorPrimary: true } } },
                },
                credits: { orderBy: { createdAt: 'desc' }, take: 10 },
                teamMembers: { where: { userId }, select: { position: true, role: true }, take: 1 },
                _count: {
                    select: {
                        ads: { where: { status: { not: 'deleted' } } },
                        armMemberships: { where: { status: 'active' } },
                    },
                },
            },
        });

        return {
            ...catalog,
            businessId: owned.businessId,
            business: owned.business,
            position: catalog?.teamMembers?.[0]?.position || null,
            activities: (catalog?.business as any)?.activities?.map((item: any) => ({
                id: item.activityId,
                title: item.activity.title,
                slug: item.activity.slug,
                path: item.activity.path,
                level: item.activity.level,
            })) ?? [],
            // ✅ تیک از نهاد — شکل قدیمی برای فرانت
            latestVerification: (catalog?.business as any)?.verifications?.[0] || null,
            verificationStatus: (catalog?.business as any)?.verificationStatus ?? null,
            verificationTier: (catalog?.business as any)?.verificationTier ?? null,
            totalAdsCount: catalog?._count?.ads ?? 0,
            activeAdsCount,
            expiredAdsCount,
            activeMembershipsCount: catalog?._count?.armMemberships ?? 0,
            logoFile: logoFile || null,
            logoUrl: logoFile?.path || catalog?.logoUrl || null,
        };
    }

    // ============================================================
    // ویرایش کاتالوگ — بدون industryId (صنف متن آزاد)
    // ============================================================
    async update(id: string, userId: string, dto: UpdateCatalogDto) {
        await this.getOwnedCatalog(id, userId);

        if (dto.logoFileId) {
            const logoFile = await this.prisma.file.findUnique({
                where: { id: dto.logoFileId },
                select: { path: true, thumbnailPath: true },
            });
            await this.prisma.catalog.update({
                where: { id },
                data: { logoUrl: logoFile?.thumbnailPath || logoFile?.path || '' },
            });
        }

        let normalizedSlug: string | undefined;
        if (dto.slug !== undefined && dto.slug !== '') {
            normalizedSlug = this.validateSlugOrThrow(dto.slug);
            await this.ensureSlugAvailable(normalizedSlug, id);
        }

        const catalog = await this.prisma.catalog.update({
            where: { id },
            data: {
                name: dto.name,
                ...(normalizedSlug ? { slug: normalizedSlug } : {}),
                ...(dto.salesType ? { salesType: dto.salesType } : {}),
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
                // ✅ industryId حذف
                industryName: dto.industryName,
                updatedAt: new Date(),
            },
        });

        if (dto.position !== undefined) {
            await this.prisma.teamMember.updateMany({
                where: { catalogId: id, userId },
                data: { position: dto.position || null },
            });
        }

        return catalog;
    }

    // ============================================================
    // حذف کاتالوگ (soft delete)
    // ============================================================
    async remove(id: string, userId: string) {
        await this.getOwnedCatalog(id, userId);

        const activeAds = await this.prisma.ad.count({ where: { catalogId: id, status: 'active' } });
        if (activeAds > 0) {
            throw new ConflictException({
                errorCode: 'CATALOG_HAS_ACTIVE_ADS',
                message: 'این کاتالوگ آگهی فعال دارد، ابتدا آنها را حذف کنید',
            });
        }
        return this.prisma.catalog.update({ where: { id }, data: { status: 'closed', updatedAt: new Date() } });
    }

    async exists(id: string): Promise<boolean> {
        const count = await this.prisma.catalog.count({ where: { id, status: 'active' } });
        return count > 0;
    }

    async isOwner(catalogId: string, userId: string): Promise<boolean> {
        const catalog = await this.prisma.catalog.findUnique({
            where: { id: catalogId },
            select: { business: { select: { ownerUserId: true } } },
        });
        return catalog?.business?.ownerUserId === userId;
    }

    // ============================================================
    // کاتالوگ عمومی با آدرس (/{slug}) — owner از نهاد
    // ============================================================
    async findBySlug(slug: string) {
        const catalog = await this.prisma.catalog.findFirst({
            where: { slug, status: 'active' },
            include: {
                business: {
                    include: {
                        owner: {
                            select: {
                                id: true,
                                fullName: true,
                                phone: true,
                                avatarUrl: true,
                                referralCode: true,
                                files: {
                                    where: { fieldKey: 'avatar' },
                                    orderBy: { createdAt: 'desc' },
                                    select: { id: true, path: true, thumbnailPath: true },
                                    take: 1,
                                },
                            },
                        },
                        activities: {
                            include: { activity: { select: { id: true, title: true, slug: true } } },
                        },
                        // ✅ تیک از نهاد
                        verifications: {
                            orderBy: { submittedAt: 'desc' },
                            select: { tier: true, status: true, reviewedAt: true },
                            take: 1,
                        },
                    },
                },
                files: {
                    where: { fieldKey: 'logo' },
                    orderBy: { createdAt: 'desc' },
                    select: { id: true, path: true, thumbnailPath: true, fieldKey: true },
                    take: 1,
                },
                _count: { select: { ads: { where: { status: { not: 'deleted' } } } } },
            },
        });

        if (!catalog) {
            throw new NotFoundException({ errorCode: 'CATALOG_NOT_FOUND', message: 'کاتالوگ یافت نشد' });
        }

        const ownerTeamMember = await this.prisma.teamMember.findFirst({
            where: { catalogId: catalog.id, userId: catalog.business.ownerUserId },
            select: { position: true, role: true },
        });

        const logoFile = catalog.files?.[0];
        const bizOwner = catalog.business.owner;
        const ownerAvatarFile = bizOwner?.files?.[0];
        const bizVerification = (catalog.business as any)?.verifications?.[0];

        return {
            ...catalog,
            activities: (catalog.business as any)?.activities?.map((ba: any) => ba.activity) ?? [],
            // ✅ تیک از نهاد — شکل قدیمی برای فرانت
            verificationTier: bizVerification?.tier ?? null,
            verificationStatus: bizVerification?.status ?? null,
            owner: bizOwner ? {
                id: bizOwner.id,
                fullName: bizOwner.fullName,
                phone: bizOwner.phone,
                avatarUrl: ownerAvatarFile?.thumbnailPath || ownerAvatarFile?.path || bizOwner.avatarUrl || null,
                referralCode: bizOwner.referralCode,
                avatarFile: ownerAvatarFile || null,
                position: ownerTeamMember?.position || null,
                role: ownerTeamMember?.role || null,
            } : null,
            logoUrl: logoFile?.path || catalog.logoUrl || null,
            logoFile: logoFile || null,
        };
    }

    async getFeatured(limit = 12) {
        const now = new Date();
        const items = await this.prisma.catalog.findMany({
            where: {
                status: 'active',
                isFeatured: true,
                OR: [{ featuredUntil: null }, { featuredUntil: { gt: now } }],
            },
            select: {
                id: true, name: true, slug: true, industryName: true,
                logoUrl: true, city: true,
                _count: { select: { ads: { where: { status: { not: 'deleted' } } } } },
            },
            take: limit,
        });
        return { items };
    }

    async updateConfig(id: string, userId: string, dto: { units?: any[]; categoryTree?: any[] }) {
        await this.getOwnedCatalog(id, userId);

        const catalog = await this.prisma.catalog.findUnique({ where: { id }, select: { config: true } });
        const currentConfig = (catalog?.config as any) || {};
        const newConfig = {
            ...currentConfig,
            ...(dto.units !== undefined ? { units: dto.units } : {}),
            ...(dto.categoryTree !== undefined ? { categoryTree: dto.categoryTree } : {}),
        };

        await this.prisma.catalog.update({
            where: { id },
            data: { config: newConfig as any, updatedAt: new Date() },
        });
        return { success: true, config: newConfig };
    }

    // ═══════════════════════════════════════════════════════
    // تعاملات
    // ═══════════════════════════════════════════════════════

    async trackView(catalogId: string, userId?: string, ipAddress?: string) {
        const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const existing = await this.prisma.catalogInteraction.findFirst({
            where: {
                catalogId,
                type: 'view',
                ...(userId ? { userId } : { ipAddress: ipAddress || 'unknown' }),
                createdAt: { gte: dayAgo },
            },
        });
        if (existing) return existing;
        return this.prisma.catalogInteraction.create({
            data: { catalogId, userId: userId || null, type: 'view', ipAddress: ipAddress || null },
        });
    }

    async save(catalogId: string, userId: string) {
        const catalog = await this.prisma.catalog.findUnique({ where: { id: catalogId }, select: { id: true } });
        if (!catalog) {
            throw new NotFoundException({ errorCode: 'CATALOG_NOT_FOUND', message: 'کاتالوگ یافت نشد' });
        }
        const existing = await this.prisma.catalogInteraction.findFirst({
            where: { catalogId, userId, type: 'save' },
        });
        if (existing) return existing;
        return this.prisma.catalogInteraction.create({ data: { catalogId, userId, type: 'save' } });
    }

    async unsave(catalogId: string, userId: string) {
        return this.prisma.catalogInteraction.deleteMany({ where: { catalogId, userId, type: 'save' } });
    }

    async isSaved(catalogId: string, userId: string) {
        const saved = await this.prisma.catalogInteraction.findFirst({
            where: { catalogId, userId, type: 'save' },
        });
        return { isSaved: !!saved };
    }

    async getStats(catalogId: string) {
        const [views, saves, shares] = await Promise.all([
            this.prisma.catalogInteraction.count({ where: { catalogId, type: 'view' } }),
            this.prisma.catalogInteraction.count({ where: { catalogId, type: 'save' } }),
            this.prisma.catalogInteraction.count({ where: { catalogId, type: 'share' } }),
        ]);
        const savedBy = await this.prisma.catalogInteraction.findMany({
            where: { catalogId, type: 'save', userId: { not: null } },
            include: { user: { select: { id: true, fullName: true, phone: true, avatarUrl: true } } },
            orderBy: { createdAt: 'desc' },
            take: 20,
        });
        const viewedBy = await this.prisma.catalogInteraction.findMany({
            where: { catalogId, type: 'view', userId: { not: null } },
            include: { user: { select: { id: true, fullName: true, avatarUrl: true } } },
            orderBy: { createdAt: 'desc' },
            take: 10,
            distinct: ['userId'],
        });
        return {
            views, saves, shares,
            savedBy: savedBy.map((s) => ({ user: s.user, savedAt: s.createdAt })),
            viewedBy: viewedBy.map((v) => ({ user: v.user, viewedAt: v.createdAt })),
        };
    }

    async getSavedList(userId: string) {
        const saved = await this.prisma.catalogInteraction.findMany({
            where: { userId, type: 'save' },
            include: {
                catalog: {
                    select: {
                        id: true, name: true, slug: true, logoUrl: true,
                        city: true, province: true, type: true,
                        shortDescription: true,
                        // ✅ تیک از نهاد
                        business: { select: { verificationTier: true } },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        const result = await Promise.all(
            saved.map(async (s: any) => {
                const logoFile = await this.prisma.file.findFirst({
                    where: { relatedModel: 'Catalog', relatedId: s.catalog.id, fieldKey: 'logo' },
                    select: { path: true, thumbnailPath: true },
                });
                return {
                    ...s.catalog,
                    verificationTier: s.catalog.business?.verificationTier ?? null, // ✅ شکل قدیمی
                    business: undefined,
                    logoUrl: logoFile?.path || s.catalog.logoUrl || null,
                    savedAt: s.createdAt,
                };
            }),
        );
        return result;
    }

    async getCatalogAds(catalogId: string, page: number = 1, limit: number = 10, search?: string) {
        const skip = (page - 1) * limit;
        const where: any = { catalogId, status: { not: 'deleted' } };
        if (search) {
            where.OR = [
                { title: { contains: search } },
                { productType: { contains: search } },
            ];
        }
        const [ads, total] = await Promise.all([
            this.prisma.ad.findMany({
                where,
                include: {
                    unit: { select: { id: true, title: true, shortCode: true } },
                    arm: { select: { id: true, slug: true, name: true } },
                    files: { select: { id: true, path: true, thumbnailPath: true, fieldKey: true } },
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            this.prisma.ad.count({ where }),
        ]);
        return { ads, total, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
    }

    async trackShare(catalogId: string, userId?: string) {
        return this.prisma.catalogInteraction.create({
            data: { catalogId, userId: userId || null, type: 'share' },
        });
    }
}