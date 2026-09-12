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
import { CacheHelper } from '../common/services/cache.helper';
import { CatalogPublishService } from '../common/services/catalog-publish.service';
import { checkMarketTypeMismatch } from '../common/utils/arm.utils';

/** عمر کش لیست‌های عمومی کاتالوگ — ۵ دقیقه */
const PUBLIC_LIST_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * کاتالوگ — ویترینِ یک کسب‌وکارِ مرجع.
 * ✅ مالکیتِ مستقیم روی کاتالوگ: catalog.ownerUserId (کاربری که کاتالوگ را ساخته)
 *    کسب‌وکار مشترک/مرجع است و مالکِ شخصی ندارد — هر کاربری می‌تواند کاتالوگش را
 *    روی هر کسب‌وکارِ فعالی بسازد و با پستِ خودش عضو تیمِ آن کسب‌وکار می‌شود (BusinessMember).
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

    constructor(
        private prisma: PrismaService,
        private cache: CacheHelper,
        private catalogPublish: CatalogPublishService,
    ) {}

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
                        creatorUserId: true,
                        name: true,
                        industryId: true,        // ✅ برای autocomplete
                        industryName: true,      // ✅ برای نمایش
                        phone: true,             // ✅ برای فیلد تماس
                        logoUrl: true,           // ✅ برای لوگو
                        province: true,          // ✅ برای نمایش موقعیت
                        provinceCode: true,
                        city: true,
                        cityCode: true,
                        address: true,
                        description: true,
                        type: true,
                        businessRole: true,      // ✅ نوع دقیق فعالیت
                        businessSector: true,    // ✅ دسته‌بندی
                        verificationStatus: true,
                        verificationTier: true,
                    },
                },
            },
        });
        if (!catalog) {
            throw new NotFoundException({ errorCode: 'CATALOG_NOT_FOUND', message: 'کاتالوگ یافت نشد' });
        }
        if (catalog.ownerUserId !== userId) {
            throw new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'شما به این کاتالوگ دسترسی ندارید' });
        }
        return catalog;
    }

    // ============================================================
    // ثبت کاتالوگ — روی هر کسب‌وکارِ فعال (مرجع/مشترک):
    //   · کسب‌وکار از قبل ثبت‌شده (حتی توسط دیگری) → انتخاب و ساخت کاتالوگ
    //   · کاربر با پستِ انتخابی‌اش عضو تیمِ کسب‌وکار می‌شود (BusinessMember)
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
            select: { id: true, status: true, name: true },
        });
        if (!biz) {
            throw new NotFoundException({ errorCode: 'BUSINESS_NOT_FOUND', message: 'کسب‌وکار یافت نشد' });
        }
        if (biz.status !== 'active') {
            throw new BadRequestException({ errorCode: 'BUSINESS_INACTIVE', message: 'این کسب‌وکار فعال نیست' });
        }

        // ✅ نام تکراری — در کاتالوگ‌های خودِ کاربر (نه کسب‌وکار؛ کسب‌وکار مشترک است)
        const dup = await this.prisma.catalog.findFirst({
            where: { ownerUserId: userId, name: dto.name, status: 'active' },
        });
        if (dup) {
            throw new ConflictException({
                errorCode: 'DUPLICATE_CATALOG_NAME',
                message: 'قبلاً کاتالوگی با این نام ساخته‌اید',
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

        // ✅ ناوردی بازار — «قبل از هر نوشتنی» چک می‌شود تا کاتالوگ یتیم نسازد:
        //    • عضویتِ فعال با کاتالوگِ واقعیِ دیگر → خطا (بدون ساخت کاتالوگ)
        //    • ارجاعِ یتیم (کاتالوگ حذف/بسته شده) → مانع نیست؛ عضویت با کاتالوگ تازه repoint می‌شود
        let armCtx: { id: string; categoryTree: any } | null = null;
        if (dto.armSlug) {
            const arm = await this.prisma.arm.findUnique({
                where: { slug: dto.armSlug },
                select: { id: true, categoryTree: true, config: true },
            });
            if (arm) {
                const existing = await this.prisma.armMembership.findUnique({
                    where: { armId_userId: { armId: arm.id, userId } },
                    select: { catalogId: true },
                });
                if (existing?.catalogId) {
                    const existingCat = await this.prisma.catalog.findUnique({
                        where: { id: existing.catalogId },
                        select: { status: true },
                    });
                    if (existingCat?.status === 'active') {
                        throw new ConflictException({
                            errorCode: 'BUSINESS_HAS_OTHER_CATALOG',
                            message: 'شما در این بازار با کاتالوگ دیگری فعال هستید — ابتدا آن کاتالوگ را حذف یا اتصالش را از پنل بازار قطع کنید',
                        });
                    }
                }
                const typeMismatch = checkMarketTypeMismatch(arm, dto.salesType === 'retail' ? 'retail' : 'wholesale');
                if (typeMismatch) {
                    throw new BadRequestException({ errorCode: 'MARKET_TYPE_MISMATCH', message: typeMismatch });
                }
                armCtx = { id: arm.id, categoryTree: arm.categoryTree };
            }
        }

        // ✅ همهٔ نوشته‌ها در یک تراکنش — یا همه ثبت می‌شود یا هیچ‌کدام؛ خطای وسطِ راه دیگر کاتالوگ یتیم جا نمی‌گذارد
        const catalog = await this.prisma.$transaction(async (tx) => {
            const cat = await tx.catalog.create({
                data: {
                    ownerUserId: userId, // ✅ مالکِ مستقیم کاتالوگ = سازندهٔ آن
                    businessId: biz.id,
                    name: dto.name,
                    slug,
                    // ✅ کاتالوگ خصوصی — قیمت‌ها فقط برای مالک و اعضای پذیرفته‌شده
                    isPrivate: dto.isPrivate ?? false,
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

            // ✅ تیم کاتالوگ — رکورد مالک با لِین فروشندهٔ فعال (مالک خودش هم سفارش می‌گیرد)
            // (TeamMember legacy — دیگر نوشته نمی‌شود)
            await tx.catalogMember.create({
                data: {
                    catalogId: cat.id,
                    userId,
                    role: CatalogRole.catalog_owner,
                    status: 'active',
                    permissions: { canManageCatalog: true, canManageAds: true, canManageTeam: true },
                    sellerBusinessId: (cat as any).businessId,
                    sellerStatus: 'active',
                    sellerJoinedAt: new Date(),
                },
            });
            await tx.catalogTeamEvent.create({
                data: { catalogId: cat.id, userId, eventType: 'joined', actorUserId: userId, note: 'ساخت کاتالوگ — مالک با لِین فروشندهٔ فعال' },
            });

            // ✅ تیمِ کسب‌وکار — کاربر با پستِ انتخابی‌اش عضو کسب‌وکارِ مرجع می‌شود
            await tx.businessMember.upsert({
                where: { businessId_userId: { businessId: biz.id, userId } },
                create: {
                    businessId: biz.id,
                    userId,
                    position: dto.position?.trim() || null,
                    viaCatalogId: cat.id,
                    status: 'active',
                },
                update: {
                    position: dto.position?.trim() || undefined,
                    viaCatalogId: cat.id,
                    status: 'active',
                },
            });

            if (armCtx) {
                await tx.armMembership.upsert({
                    where: { armId_userId: { armId: armCtx.id, userId } },
                    create: {
                        armId: armCtx.id,
                        userId,
                        businessId: cat.businessId,
                        catalogId: cat.id,
                        role: 'arm_member',
                        roleType: 'seller',
                        status: 'active',
                        publishState: 'published',
                        source: 'manual',
                    },
                    update: {
                        catalogId: cat.id,
                        status: 'active',
                        publishState: 'published',
                        roleType: 'seller',
                        businessId: cat.businessId,
                    },
                });
                // ✅ انتشار پیش‌فرض: همهٔ آگهی‌های کاتالوگ تازه به این بازار مهر می‌خورند
                await tx.ad.updateMany({
                    where: { catalogId: cat.id, status: 'active', publishToMarket: false },
                    data: { publishToMarket: true },
                });
            }

            if (refUserId) {
                const me = await tx.user.findUnique({
                    where: { id: userId },
                    select: { referredByUserId: true },
                });
                if (!me?.referredByUserId) {
                    await tx.user.update({
                        where: { id: userId },
                        data: { referredByUserId: refUserId, referredAt: new Date() },
                    });
                }
            }

            return cat;
        });

        // ✅ مهرِ دسته‌بندی آگهی‌ها — سرویسِ جدا و غیربحرانی؛ بعد از commit اجرا می‌شود
        if (armCtx) {
            try {
                await this.catalogPublish.stampCatalogAds(armCtx as any, catalog.id, undefined, userId);
            } catch (err) {
                console.error(`catalog create: stampCatalogAds failed for arm ${armCtx.id}:`, err);
            }
        }

        // ⚠️ دیتای خود کاربر تغییر کرد → کش لیست کاتالوگ‌هایش فوراً باطل
        await this.bustUserCatalogs(userId);

        return catalog;
    }

    // ============================================================
    // لیست کاتالوگ‌های کاربر — مالکیت مستقیم روی کاتالوگ
    // ⚠️ دیتای خود کاربر: کش per-user + باطل‌سازی فوری در create/update/remove/updateConfig
    // ============================================================
    async findAllByUser(userId: string) {
        return this.cache.wrap(`my-catalogs:${userId}`, [], PUBLIC_LIST_CACHE_TTL_MS, () =>
            this.fetchAllByUser(userId));
    }

    /** باطل‌سازی کش لیست کاتالوگ‌های یک کاربر */
    private async bustUserCatalogs(userId: string) {
        await this.cache.bust(`my-catalogs:${userId}`);
    }

    private async fetchAllByUser(userId: string) {
        const catalogs = await this.prisma.catalog.findMany({
            where: { ownerUserId: userId, status: { not: 'closed' } },
            include: {
                // ✅ فیلدهای business — برای CatalogEditModal (صنف، لوگو، موقعیت، تماس)
                business: {
                    select: {
                        id: true,
                        name: true,
                        ownerUserId: true,      // ✅ برای canEdit در فرانت (ویرایش‌پذیریِ مشخصات کسب‌وکار)
                        creatorUserId: true,    // ✅ برای canEdit در فرانت
                        industryId: true,        // ✅ برای autocomplete در مودال ویرایش
                        industryName: true,      // ✅ برای نمایش صنف ذخیره‌شده
                        phone: true,             // ✅ برای فیلد تماس
                        logoUrl: true,           // ✅ برای لوگو
                        province: true,
                        provinceCode: true,
                        city: true,
                        cityCode: true,
                        address: true,           // ✅ برای ویرایش آدرس
                        description: true,       // ✅ برای ویرایش توضیحات
                        type: true,
                        businessRole: true,      // ✅ نوع دقیق فعالیت
                        businessSector: true,    // ✅ دسته‌بندی
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

        const catalogIds = catalogs.map((c) => c.id);
        const bizIdList = [...new Set(catalogs.map((c) => c.businessId).filter(Boolean))];

        // ✅ لوگوها در ۲ کوئری بچ (به‌جای N+1 قبلی) + فال‌بک کامل:
        //    فایل کاتالوگ → catalog.logoUrl → فایل Business → business.logoUrl
        //    (ریشهٔ باگ «لوگوی شرکت ست می‌شود ولی در کاتالوگ نمی‌آمد»:
        //     فایل/فیلد لوگوی Business هرگز خوانده نمی‌شد)
        const [catLogoFiles, bizLogoFiles] = await Promise.all([
            catalogIds.length
                ? this.prisma.file.findMany({
                      where: { relatedModel: 'Catalog', relatedId: { in: catalogIds }, fieldKey: 'logo' },
                      select: { id: true, path: true, thumbnailPath: true, relatedId: true },
                      orderBy: { createdAt: 'desc' },
                  })
                : Promise.resolve([]),
            bizIdList.length
                ? this.prisma.file.findMany({
                      where: { relatedModel: 'Business', relatedId: { in: bizIdList }, fieldKey: 'logo' },
                      select: { id: true, path: true, thumbnailPath: true, relatedId: true },
                      orderBy: { createdAt: 'desc' },
                  })
                : Promise.resolve([]),
        ]);
        const catLogoMap = new Map(catLogoFiles.map((f) => [f.relatedId, f]));
        const bizLogoMap = new Map(bizLogoFiles.map((f) => [f.relatedId, f]));

        const own = catalogs.map((catalog: any) => {
            const catLogo = catLogoMap.get(catalog.id) ?? null;
            const bizLogo = catLogo ? null : (bizLogoMap.get(catalog.businessId) ?? null);
            return {
                ...catalog,
                logoFile: catLogo || bizLogo,
                logoUrl: catLogo?.path || catalog.logoUrl || bizLogo?.path || catalog.business?.logoUrl || null,
                activeAdsCount: catalog._count.ads,
                activeMembershipsCount: catalog._count.armMemberships,
            };
        });

        // ✅ کاتالوگ‌های تیمی — عضوِ فروش (فروشنده/ویزیتور کاتالوگ دیگری)، مدیر کاتالوگ، یا درخواستِ در انتظار
        //    تیم کاتالوگ: بازار پخش — اعضایِ فروش بدون کاتالوگِ جدا در کاتالوگِ مالک کار می‌کنند
        const teamRows = await this.prisma.catalogMember.findMany({
            where: {
                userId,
                status: 'active',
                OR: [
                    { sellerStatus: { in: ['active', 'pending'] } },
                    { role: 'catalog_admin' },
                ],
            },
            include: {
                catalog: {
                    select: {
                        id: true, name: true, slug: true, logoUrl: true, phone: true, status: true,
                        business: { select: { id: true, name: true, logoUrl: true } },
                    },
                },
            },
        });
        const ownIds = new Set(own.map((c) => c.id));
        const teamEntries = teamRows
            .filter((m: any) => m.catalog && m.catalog.status !== 'closed' && !ownIds.has(m.catalog.id))
            .map((m: any) => ({
                ...m.catalog,
                logoUrl: m.catalog.logoUrl || m.catalog.business?.logoUrl || null,
                isTeamEntry: true,
                teamMode: m.role === 'catalog_admin' ? 'admin' : m.sellerStatus === 'active' ? 'seller' : 'pending',
                teamMemberId: m.id,
                teamSellerRegion: m.sellerRegion || null,
                position: m.position || null,
            }));

        return [...own, ...teamEntries];
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
                members: { where: { userId }, select: { position: true, role: true, sellerRegion: true }, take: 1 },
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
            position: catalog?.members?.[0]?.position || null,
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
        const owned = await this.getOwnedCatalog(id, userId);

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
                ...(dto.isPrivate !== undefined ? { isPrivate: dto.isPrivate } : {}),
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
            // ✅ سمت نمایشی روی رکورد تیم کاتالوگ (CatalogMember) — جایگزین TeamMember legacy
            await this.prisma.catalogMember.updateMany({
                where: { catalogId: id, userId },
                data: { position: dto.position || null },
            });
        }

        // ⚠️ دیتای خود کاربر تغییر کرد → کش لیست کاتالوگ‌هایش باطل؛
        // صفحهٔ عمومی کاتالوگ (findBySlug) هم تازه شود (اسلاگ قبلی و جدید)
        await this.bustUserCatalogs(userId);
        const oldSlug = (owned as any)?.slug;
        if (oldSlug) await this.cache.bust(`catalog-slug:${oldSlug}`);
        await this.cache.bust(`catalog-slug:${(catalog as any).slug}`);

        return catalog;
    }

    // ============================================================
    // حذف کاتالوگ (soft delete)
    // ============================================================
    async remove(id: string, userId: string) {
        const owned = await this.getOwnedCatalog(id, userId);

        const activeAds = await this.prisma.ad.count({ where: { catalogId: id, status: 'active' } });
        if (activeAds > 0) {
            throw new ConflictException({
                errorCode: 'CATALOG_HAS_ACTIVE_ADS',
                message: 'این کاتالوگ آگهی فعال دارد، ابتدا آنها را حذف کنید',
            });
        }
        const closed = await this.prisma.catalog.update({ where: { id }, data: { status: 'closed', updatedAt: new Date() } });

        // ✅ آزادسازی اتصال بازارها — رهاکردن catalogId یتیم، ساخت کاتالوگ بعدی در همان بازار را قفل نمی‌کند
        //    (عضویتِ خریدارِ بازار دست‌نخورده می‌ماند؛ فقط لینکِ فروشنده آزاد می‌شود)
        await this.prisma.armMembership.updateMany({
            where: { catalogId: id, roleType: 'seller' },
            data: { catalogId: null, status: 'inactive', publishState: 'draft' },
        });
        await this.prisma.armMembership.updateMany({
            where: { catalogId: id },
            data: { catalogId: null, publishState: 'draft' },
        });

        // ⚠️ کش لیست مالک + صفحهٔ عمومی کاتالوگ باطل شود
        await this.bustUserCatalogs(userId);
        const slug = (owned as any)?.slug;
        if (slug) await this.cache.bust(`catalog-slug:${slug}`);

        return closed;
    }

    async exists(id: string): Promise<boolean> {
        const count = await this.prisma.catalog.count({ where: { id, status: 'active' } });
        return count > 0;
    }

    async isOwner(catalogId: string, userId: string): Promise<boolean> {
        const catalog = await this.prisma.catalog.findUnique({
            where: { id: catalogId },
            select: { ownerUserId: true },
        });
        return catalog?.ownerUserId === userId;
    }

    // ============================================================
    // کاتالوگ عمومی با آدرس (/{slug}) — owner از نهاد
    // ⚠️ کش عمومی ۵ دقیقه‌ای per slug؛ ویرایش/حذف/کانفیگ مالک فوراً bust می‌کند
    // ============================================================
    async findBySlug(slug: string) {
        return this.cache.wrap(`catalog-slug:${slug}`, [], PUBLIC_LIST_CACHE_TTL_MS, () =>
            this.fetchBySlug(slug));
    }

    private async fetchBySlug(slug: string) {
        const catalog = await this.prisma.catalog.findFirst({
            where: { slug, status: 'active' },
            include: {
                business: {
                    include: {
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

        // ✅ کاتالوگ عمومی با آدرس — مالکِ کاتالوگ (نه مالکِ کسب‌وکارِ مشترک)
        const ownerUser = await this.prisma.user.findUnique({
            where: { id: catalog.ownerUserId },
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
        });

        const ownerTeamMember = await this.prisma.catalogMember.findFirst({
            where: { catalogId: catalog.id, userId: catalog.ownerUserId },
            select: { position: true, role: true },
        });

        const logoFile = catalog.files?.[0];
        const ownerAvatarFile = ownerUser?.files?.[0];
        const bizVerification = (catalog.business as any)?.verifications?.[0];

        return {
            ...catalog,
            activities: (catalog.business as any)?.activities?.map((ba: any) => ba.activity) ?? [],
            // ✅ تیک از نهاد — شکل قدیمی برای فرانت
            verificationTier: bizVerification?.tier ?? null,
            verificationStatus: bizVerification?.status ?? null,
            owner: ownerUser ? {
                id: ownerUser.id,
                fullName: ownerUser.fullName,
                phone: ownerUser.phone,
                avatarUrl: ownerAvatarFile?.thumbnailPath || ownerAvatarFile?.path || ownerUser.avatarUrl || null,
                referralCode: ownerUser.referralCode,
                avatarFile: ownerAvatarFile || null,
                position: ownerTeamMember?.position || null,
                role: ownerTeamMember?.role || null,
            } : null,
            logoUrl: logoFile?.path || catalog.logoUrl || null,
            logoFile: logoFile || null,
        };
    }

    async getFeatured(limit = 12) {
        // ✅ کش عمومی ۵ دقیقه‌ای — دیتای دیگران؛ ثبت/ویرایش کاتالوگ کش را نمی‌شکند
        return this.cache.wrap('catalog-featured', [limit], PUBLIC_LIST_CACHE_TTL_MS, async () => {
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
        });
    }

    async updateConfig(id: string, userId: string, dto: { units?: any[]; categoryTree?: any[] }) {
        const owned = await this.getOwnedCatalog(id, userId);

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

        // ⚠️ کانفیگ ویتروین/واحد/درخت دسته عوض شد → کش‌های مالک و صفحهٔ عمومی باطل
        await this.bustUserCatalogs(userId);
        const slug = (owned as any)?.slug;
        if (slug) await this.cache.bust(`catalog-slug:${slug}`);

        return { success: true, config: newConfig };
    }

    // ═══════════════════════════════════════════════════════
    // کارت ویزیت — ذخیرهٔ مشخصات (JSON) در metadata کاتالوگ
    // کاربر طرح کارت را یک‌بار می‌سازد و زحمتش از بین نمی‌رود
    // ═══════════════════════════════════════════════════════
    async saveVisitCard(id: string, userId: string, spec: Record<string, any> | null | undefined) {
        const owned = await this.getOwnedCatalog(id, userId);

        // 🛡️ گارد حجم — تصاویر dataURL فشرده سمت کلاینت می‌آیند؛ سقف منطقی ۱.۵MB
        if (spec !== undefined && spec !== null && JSON.stringify(spec).length > 1_500_000) {
            throw new BadRequestException('حجم مشخصات کارت ویزیت بیش از حد مجاز است');
        }

        const catalog = await this.prisma.catalog.findUnique({ where: { id }, select: { metadata: true } });
        const newMetadata: Record<string, any> = { ...((catalog?.metadata as any) || {}) };
        if (spec === null) {
            delete newMetadata.visitCard; // حذف کارت ذخیره‌شده
        } else if (spec !== undefined) {
            newMetadata.visitCard = { ...spec, updatedAt: new Date().toISOString() };
        }

        await this.prisma.catalog.update({
            where: { id },
            data: { metadata: newMetadata as any, updatedAt: new Date() },
        });

        // کش مالک + صفحهٔ عمومی کاتالوگ باطل شود
        await this.bustUserCatalogs(userId);
        const slug = (owned as any)?.slug;
        if (slug) await this.cache.bust(`catalog-slug:${slug}`);

        return { success: true, visitCard: newMetadata.visitCard ?? null };
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