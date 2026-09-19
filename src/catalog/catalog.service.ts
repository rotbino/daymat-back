// src/catalog/catalog.service.ts
import {
    Injectable,
    NotFoundException,
    ConflictException,
    BadRequestException,
    ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCatalogDto, UpdateCatalogDto, UpdateCatalogConfigDto } from './catalog.dto';
import { CatalogRole } from '../common/enums/prisma-enums';
import { CacheHelper, VITRINE_CACHE_PREFIX } from '../common/services/cache.helper';
import { RESERVED_SLUGS } from '../common/reserved-slugs';
import { CatalogPublishService } from '../common/services/catalog-publish.service';
import { CatalogAccessService } from '../common/services/catalog-access.service';
import { normalizeForCompare, normalizeForStore } from '../common/persian-text.util';
import { canCreateSalesArmRole, canCreateSalesArmSector } from '../common/constants/market-roles';

/** نرمال‌سازی نام کالا برای مقایسهٔ تکراری‌ها — همان قاعدهٔ ایمپورت */
const FA_DIGITS: Record<string, string> = {
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};
const normalizeItemName = (s: string): string =>
    normalizeForCompare((s ?? '').replace(/[۰-۹٠-٩]/g, (d) => FA_DIGITS[d] ?? d)).trim().toLowerCase();

/** سقف کپی در هر درخواست */
const MAX_COPY_ITEMS = 500;

/** عمر کش لیست‌های عمومی بازوی فروش — ۵ دقیقه */
const PUBLIC_LIST_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * بازوی فروش — ویترینِ یک کسب‌وکارِ مرجع.
 * ✅ مالکیتِ مستقیم روی بازوی فروش: catalog.ownerUserId (کاربری که بازوی فروش را ساخته)
 *    کسب‌وکار مشترک/مرجع است و مالکِ شخصی ندارد — هر کاربری می‌تواند بازوی فروشش را
 *    روی هر کسب‌وکارِ فعالی بسازد و با پستِ خودش عضو تیمِ آن کسب‌وکار می‌شود (BusinessMember).
 * تیک اعتماد: روی نهاد (Business) — این سرویس فقط می‌خواند، نمی‌نویسد.
 * صنف: industryName (متن) روی هر دو؛ رلیشن Industry حذف شده.
 */
@Injectable()
export class CatalogService {
    constructor(
        private prisma: PrismaService,
        private cache: CacheHelper,
        private catalogPublish: CatalogPublishService,
        private catalogAccess: CatalogAccessService,
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
            throw new BadRequestException({ errorCode: 'INVALID_SLUG', message: 'آدرس بازوی فروش باید حداقل ۳ حرف باشد' });
        }
        if (RESERVED_SLUGS.includes(slug.toLowerCase())) {
            throw new BadRequestException({ errorCode: 'SLUG_RESERVED', message: 'این آدرس قابل انتخاب نیست' });
        }
        return slug;
    }

    // ✅ فضای اسلاگ سراسری است (بازوی فروش + بازار + صفحهٔ اعلان خرید همه روی ریشه بالا می‌آیند)
    private async ensureSlugAvailable(slug: string, excludeId?: string): Promise<void> {
        const [cat, arm, inq] = await Promise.all([
            this.prisma.catalog.findFirst({
                where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
                select: { id: true },
            }),
            this.prisma.arm.findFirst({ where: { slug }, select: { id: true } }),
            this.prisma.inquiry.findFirst({ where: { slug }, select: { id: true } }),
        ]);
        if (cat || arm || inq) {
            throw new ConflictException({ errorCode: 'SLUG_TAKEN', message: 'این آدرس قبلاً گرفته شده است' });
        }
    }

    async checkSlugAvailability(raw: string, excludeId?: string) {
        const slug = this.normalizeSlug(raw);
        if (!slug || slug.length < 3) return { available: false, reason: 'invalid', slug };
        if (RESERVED_SLUGS.includes(slug.toLowerCase())) return { available: false, reason: 'reserved', slug };
        const [cat, arm, inq] = await Promise.all([
            this.prisma.catalog.findFirst({
                where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
                select: { id: true },
            }),
            this.prisma.arm.findFirst({ where: { slug }, select: { id: true } }),
            this.prisma.inquiry.findFirst({ where: { slug }, select: { id: true } }),
        ]);
        return { available: !cat && !arm && !inq, slug };
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
            throw new NotFoundException({ errorCode: 'CATALOG_NOT_FOUND', message: 'بازوی فروش یافت نشد' });
        }
        if (catalog.ownerUserId !== userId) {
            throw new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'شما به این بازوی فروش دسترسی ندارید' });
        }
        return catalog;
    }

    // ============================================================
    // ثبت بازوی فروش — روی هر کسب‌وکارِ فعال (مرجع/مشترک):
    //   · کسب‌وکار از قبل ثبت‌شده (حتی توسط دیگری) → انتخاب و ساخت بازوی فروش
    //   · کاربر با پستِ انتخابی‌اش عضو تیمِ کسب‌وکار می‌شود (BusinessMember)
    // ============================================================
    async create(userId: string, dto: CreateCatalogDto) {
        if (!dto.businessId) {
            throw new BadRequestException({
                errorCode: 'BUSINESS_REQUIRED',
                message: 'بازوی فروش باید برای یک کسب‌وکار ساخته شود',
            });
        }
        const biz = await this.prisma.business.findUnique({
            where: { id: dto.businessId },
            select: { id: true, status: true, name: true, businessRole: true, businessSector: true },
        });
        if (!biz) {
            throw new NotFoundException({ errorCode: 'BUSINESS_NOT_FOUND', message: 'کسب‌وکار یافت نشد' });
        }
        if (biz.status !== 'active') {
            throw new BadRequestException({ errorCode: 'BUSINESS_INACTIVE', message: 'این کسب‌وکار فعال نیست' });
        }

        // ✅ گیتِ بازوی فروش (فلسفهٔ نوی مالک — بازنویسی بازوها):
        //    بازوی خرید برای همه؛ بازوی فروشِ عمده فقط برای لایه‌های بالادستی زنجیره
        //    (تولید / بازرگانی / توزیع‌وپخش). خرده‌فروش و خدمات فقط خریدار عمده‌اند —
        //    بازوی فروشِ بی‌مصرف، پیشنهاد تامینِ بی‌معنا و هرج‌ومرجِ بازار می‌سازد.
        //    در این نسخه وارد بازارِ فروشِ خدمات هم نمی‌شویم.
        //    مقادیرِ خالی/قدیمی محدود نمی‌شوند (سازگاری با داده‌های قبل).
        if (biz.businessRole && !canCreateSalesArmRole(biz.businessRole)) {
            throw new ForbiddenException({
                errorCode: 'SALES_ARM_NOT_ALLOWED',
                message: 'برای کسب‌وکارهای خرده‌فروشی و خدمات، بازوی فروش عمده ساخته نمی‌شود — بازوی خرید شما فعال است',
            });
        }
        if (biz.businessSector && !canCreateSalesArmSector(biz.businessSector)) {
            throw new ForbiddenException({
                errorCode: 'SALES_ARM_NOT_ALLOWED',
                message: 'برای کسب‌وکارهای خرده‌فروشی و خدمات، بازوی فروش عمده ساخته نمی‌شود — بازوی خرید شما فعال است',
            });
        }

        // ✅ نام تکراری — در بازوی فروش‌های خودِ کاربر (نه کسب‌وکار؛ کسب‌وکار مشترک است)
        const dup = await this.prisma.catalog.findFirst({
            where: { ownerUserId: userId, name: dto.name, status: 'active' },
        });
        if (dup) {
            throw new ConflictException({
                errorCode: 'DUPLICATE_CATALOG_NAME',
                message: 'قبلاً بازوی فروشی با این نام ساخته‌اید',
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

        // ✅ فیکسِ بنر جشنِ کاذب: ساختِ بازوی فروش دیگر عضویتِ فروشندگیِ خودکار نمی‌سازد.
        //    قبلاً armSlug (آخرین بازاری که کاربر دیده بود — از redux-persist!) می‌آمد و بی‌اجازهٔ
        //    مدیرِ بازار، عضویتِ seller فعال+published ساخته می‌شد → بنر «محصولات شما در بازار X
        //    قرار گرفت!» بی‌دلیل ظاهر می‌شد و کالاها هم بی‌اجازه مهرِ بازار می‌خوردند.
        //    حالا ورودِ بازوی فروش به بازار فقط با تصمیمِ مدیر (owner_add) یا تاییدِ
        //    درخواستِ عضویت (membership_request) اتفاق می‌افتد.
        //    نکتهٔ سازگاری: فیلد armSlug در DTO می‌ماند (کلاینت‌های قدیمی ۴۰۰ نگیرند) ولی نادیده گرفته می‌شود.

        // ✅ همهٔ نوشته‌ها در یک تراکنش — یا همه ثبت می‌شود یا هیچ‌کدام؛ خطای وسطِ راه دیگر بازوی فروش یتیم جا نمی‌گذارد
        const catalog = await this.prisma.$transaction(async (tx) => {
            const cat = await tx.catalog.create({
                data: {
                    ownerUserId: userId, // ✅ مالکِ مستقیم بازوی فروش = سازندهٔ آن
                    businessId: biz.id,
                    name: dto.name,
                    slug,
                    // ✅ بازوی فروش خصوصی — قیمت‌ها فقط برای مالک و اعضای پذیرفته‌شده
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

            // ✅ تیم بازوی فروش — رکورد مالک با لِین فروشندهٔ فعال (مالک خودش هم سفارش می‌گیرد)
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
                data: { catalogId: cat.id, userId, eventType: 'joined', actorUserId: userId, note: 'ساخت بازوی فروش — مالک و  فروشندهٔ فعال' },
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

            // ✅ دیگر عضویتِ بازار و مهرِ کالاها اینجا انجام نمی‌شود — فقط با اددِ مدیر یا تاییدِ درخواست

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

        // ✅ سینک تیم کسب‌وکار → بازوی فروش تازه — اعضای فعال تیم در صف تاییدِ همکاری در فروش می‌نشینند
        try {
            await this.syncBusinessTeamIntoNewCatalog(catalog.id, biz.id, userId);
        } catch (err) {
            console.error('catalog create: business-team sync failed:', err);
        }

        // ⚠️ دیتای خود کاربر تغییر کرد → کش لیست بازوی فروش‌هایش فوراً باطل
        await this.bustUserCatalogs(userId);

        return catalog;
    }

    /** اعضای فعال تیم کسب‌وکار → sellerStatus=pending (sellerVia=business_team) در بازوی فروش تازه */
    private async syncBusinessTeamIntoNewCatalog(catalogId: string, businessId: string, creatorUserId: string) {
        const team = await this.prisma.businessMember.findMany({
            where: { businessId, status: 'active', userId: { not: creatorUserId } },
            select: { userId: true, business: { select: { ownerUserId: true, creatorUserId: true } } },
        });
        if (!team.length) return;
        const cat = await this.prisma.catalog.findUnique({
            where: { id: catalogId },
            select: { id: true, name: true, ownerUserId: true },
        });
        if (!cat) return;
        for (const m of team) {
            if (m.userId === cat.ownerUserId) continue;
            const row = await this.prisma.catalogMember.findUnique({
                where: { catalogId_userId: { catalogId, userId: m.userId } },
            });
            if (row?.sellerStatus === 'active' || row?.sellerStatus === 'pending' || row?.sellerStatus === 'removed') continue;
            const data: any = {
                status: 'active' as const,
                leftAt: null as Date | null,
                sellerStatus: 'pending' as const,
                sellerVia: 'business_team' as const,
                sellerRole: 'seller' as const,
                sellerJoinedAt: null as Date | null,
                sellerLeftAt: null as Date | null,
                invitedBy: creatorUserId,
            };
            if (row) {
                await this.prisma.catalogMember.update({ where: { id: row.id }, data });
            } else {
                await this.prisma.catalogMember.create({ data: { catalogId, userId: m.userId, ...data } });
            }
            await this.prisma.catalogTeamEvent.create({
                data: { catalogId, userId: m.userId, eventType: 'seller_requested', actorUserId: creatorUserId, note: 'سینک از تیم کسب‌وکار' },
            });
        }
    }

    // ============================================================
    // لیست بازوی فروش‌های کاربر — مالکیت مستقیم روی بازوی فروش
    // ⚠️ دیتای خود کاربر: کش per-user + باطل‌سازی فوری در create/update/remove/updateConfig
    // ============================================================
    async findAllByUser(userId: string) {
        return this.cache.wrap(`my-catalogs:${userId}`, [], PUBLIC_LIST_CACHE_TTL_MS, () =>
            this.fetchAllByUser(userId));
    }

    /** باطل‌سازی کش لیست بازوی فروش‌های یک کاربر */
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
        //    فایل بازوی فروش → catalog.logoUrl → فایل Business → business.logoUrl
        //    (ریشهٔ باگ «لوگوی شرکت ست می‌شود ولی در بازوی فروش نمی‌آمد»:
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

        // ✅ بازوی فروش‌های تیمی — عضوِ فروش (فروشنده/ویزیتور بازوی فروش دیگری)، مدیر بازوی فروش، یا درخواستِ در انتظار
        //    تیم بازوی فروش: بازار پخش — اعضایِ فروش بدون بازوی فروشِ جدا در بازوی فروشِ مالک کار می‌کنند
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
    // جزئیات یک بازوی فروش — فعالیت‌ها و تیک از مسیر نهاد
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
    // ویرایش بازوی فروش — بدون industryId (صنف متن آزاد)
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
            // ✅ سمت نمایشی روی رکورد تیم بازوی فروش (CatalogMember) — جایگزین TeamMember legacy
            await this.prisma.catalogMember.updateMany({
                where: { catalogId: id, userId },
                data: { position: dto.position || null },
            });
        }

        // ⚠️ دیتای خود کاربر تغییر کرد → کش لیست بازوی فروش‌هایش باطل؛
        // صفحهٔ عمومی بازوی فروش (findBySlug) هم تازه شود (اسلاگ قبلی و جدید)
        await this.bustUserCatalogs(userId);
        const oldSlug = (owned as any)?.slug;
        if (oldSlug) await this.cache.bust(`catalog-slug:${oldSlug}`);
        await this.cache.bust(`catalog-slug:${(catalog as any).slug}`);

        return catalog;
    }

    // ============================================================
    // حذف بازوی فروش (soft delete)
    // ============================================================
    async remove(id: string, userId: string) {
        const owned = await this.getOwnedCatalog(id, userId);

        const activeAds = await this.prisma.ad.count({ where: { catalogId: id, status: 'active' } });
        if (activeAds > 0) {
            throw new ConflictException({
                errorCode: 'CATALOG_HAS_ACTIVE_ADS',
                message: 'این بازوی فروش آگهی فعال دارد، ابتدا آنها را حذف کنید',
            });
        }
        const closed = await this.prisma.catalog.update({ where: { id }, data: { status: 'closed', updatedAt: new Date() } });

        // ✅ آزادسازی اتصال بازارها — رهاکردن catalogId یتیم، ساخت بازوی فروش بعدی در همان بازار را قفل نمی‌کند
        //    (عضویتِ خریدارِ بازار دست‌نخورده می‌ماند؛ فقط لینکِ فروشنده آزاد می‌شود)
        await this.prisma.armMembership.updateMany({
            where: { catalogId: id, roleType: 'seller' },
            data: { catalogId: null, status: 'inactive', publishState: 'draft' },
        });
        await this.prisma.armMembership.updateMany({
            where: { catalogId: id },
            data: { catalogId: null, publishState: 'draft' },
        });

        // ⚠️ کش لیست مالک + صفحهٔ عمومی بازوی فروش باطل شود
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
    // بازوی فروش عمومی با آدرس (/{slug}) — owner از نهاد
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
            throw new NotFoundException({ errorCode: 'CATALOG_NOT_FOUND', message: 'بازوی فروش یافت نشد' });
        }

        // ✅ بازوی فروش عمومی با آدرس — مالکِ بازوی فروش (نه مالکِ کسب‌وکارِ مشترک)
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

        // ✅ سیگنال اعتماد — تعداد معامله‌های موفقِ ثبت‌شده (پیش‌فاکتورهای تاییدشده)
        const successfulDeals = await this.prisma.proforma.count({
            where: { sellerCatalogId: catalog.id, status: 'confirmed' },
        });

        return {
            ...catalog,
            activities: (catalog.business as any)?.activities?.map((ba: any) => ba.activity) ?? [],
            // ✅ تیک از نهاد — شکل قدیمی برای فرانت
            verificationTier: bizVerification?.tier ?? null,
            verificationStatus: bizVerification?.status ?? null,
            // ✅ سیگنال‌های اعتماد — عضو از کِی + چند معاملهٔ موفق ثبت کرده
            memberSince: catalog.createdAt,
            successfulDeals,
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
        // ✅ کش عمومی ۵ دقیقه‌ای — دیتای دیگران؛ ثبت/ویرایش بازوی فروش کش را نمی‌شکند
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

    async updateConfig(id: string, userId: string, dto: UpdateCatalogConfigDto & { units?: any[]; categoryTree?: any[] }) {
        const owned = await this.getOwnedCatalog(id, userId);

        const catalog = await this.prisma.catalog.findUnique({ where: { id }, select: { config: true } });
        const currentConfig = (catalog?.config as any) || {};
        // 🎨 تم و واحد پول — برندبوکِ بازوی فروش؛ ادغام‌شونده تا فیلدهای دیگر پرت نشوند
        const nextTheme = dto.theme !== undefined
            ? {
                ...(currentConfig.theme || {}),
                ...(dto.theme?.color !== undefined ? { color: dto.theme.color || null } : {}),
            }
            : currentConfig.theme;
        const newConfig = {
            ...currentConfig,
            ...(dto.units !== undefined ? { units: dto.units } : {}),
            ...(dto.categoryTree !== undefined ? { categoryTree: dto.categoryTree } : {}),
            ...(nextTheme !== undefined ? { theme: nextTheme } : {}),
            ...(dto.currency !== undefined ? { currency: dto.currency || null } : {}),
            // 📋 اجازهٔ کپی محصولات — صاحب بازو هر وقت بخواهد روشن/خاموش می‌کند
            ...(dto.allowCopy !== undefined ? { allowCopy: dto.allowCopy } : {}),
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
    // کارت ویزیت — ذخیرهٔ مشخصات (JSON) در metadata بازوی فروش
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

        // کش مالک + صفحهٔ عمومی بازوی فروش باطل شود
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
            throw new NotFoundException({ errorCode: 'CATALOG_NOT_FOUND', message: 'بازوی فروش یافت نشد' });
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

    // ════════════════════════════════════════════════════════════
    // 📋 کپی کالاها از بازوی فروش دیگر — «موتور رشد تیم‌های فروش»
    //    یک نفر لیست را یک‌بار وارد می‌کند؛ بقیهٔ تیم در چند ثانیه کپی می‌کنند.
    //    شرط: صاحب بازو در تنظیماتش تیک «اجازهٔ کپی محصولات» را روشن کرده باشد
    //    (config.allowCopy) — هر وقت خواست برمی‌دارد. اگر خود کاربر به بازوی مبدأ
    //    دسترسی مدیریت داشته باشد، بدون تیک هم می‌تواند کپی کند (کاتالوگ خودی).
    // ════════════════════════════════════════════════════════════

    /**
     * جست‌وجوی کسب‌وکار/بازوی فروش برای کپی — با نام بازو یا نام کسب‌وکار.
     * بازوهای خودی (مدیریت‌پذیر) حذف می‌شوند — کپی بین بازوهای خودی از پنل خودش.
     * وضعیت اجازهٔ کپی هر بازو برمی‌گردد تا حتی غیرقابل‌کپی‌ها هم (برای تماس با صاحبش) دیده شوند.
     */
    async copySearch(userId: string, query: string) {
        const q = (query || '').trim().replace(/\s+/g, ' ');
        if (q.length < 2) return { items: [] };

        const candidates = await this.prisma.catalog.findMany({
            where: {
                status: 'active',
                OR: [
                    { name: { contains: q } },
                    { business: { name: { contains: q } } },
                ],
            },
            select: {
                id: true, name: true, slug: true, logoUrl: true, config: true,
                business: { select: { name: true, phone: true, logoUrl: true, verificationStatus: true } },
                _count: { select: { ads: { where: { status: { not: 'deleted' } } } } },
            },
            take: 60,
            orderBy: { createdAt: 'desc' },
        });

        // بازوهای خودی حذف — مالک یا ادمین، بدون نیاز به تیک از پنل خودش کپی می‌کند
        const [ownedIds, adminIds] = await Promise.all([
            this.prisma.catalog.findMany({
                where: { ownerUserId: userId, status: 'active', id: { in: candidates.map((c) => c.id) } },
                select: { id: true },
            }),
            this.prisma.catalogMember.findMany({
                where: { catalogId: { in: candidates.map((c) => c.id) }, userId, role: 'catalog_admin', status: 'active' },
                select: { catalogId: true },
            }),
        ]);
        const mine = new Set([...ownedIds.map((o) => o.id), ...adminIds.map((a) => a.catalogId)]);

        const items = candidates
            .filter((c) => !mine.has(c.id))
            .map((c) => ({
                id: c.id,
                name: c.name,
                slug: c.slug,
                logoUrl: c.logoUrl || c.business?.logoUrl || null,
                businessName: c.business?.name || null,
                verified: c.business?.verificationStatus === 'approved',
                phone: c.business?.phone || null,
                productCount: c._count?.ads ?? 0,
                copyAllowed: (c.config as any)?.allowCopy === true,
            }))
            .sort((a, b) => Number(b.copyAllowed) - Number(a.copyAllowed) || b.productCount - a.productCount)
            .slice(0, 20);

        return { items };
    }

    /** آیا این بازو برای این کاربر قابل‌کپی است؟ (مدیریت‌پذیر = همیشه، غیره فقط با تیک اجازه) */
    private async assertCopyable(catalogId: string, userId: string) {
        const catalog = await this.prisma.catalog.findUnique({
            where: { id: catalogId },
            select: { id: true, name: true, ownerUserId: true, status: true, config: true },
        });
        if (!catalog || catalog.status !== 'active') {
            throw new BadRequestException({ errorCode: 'INVALID_CATALOG', message: 'بازوی فروش مبدأ یافت نشد' });
        }
        if (catalog.ownerUserId === userId) return catalog;
        const admin = await this.prisma.catalogMember.findFirst({
            where: { catalogId, userId, role: 'catalog_admin', status: 'active' },
            select: { id: true },
        });
        if (admin) return catalog;
        if ((catalog.config as any)?.allowCopy !== true) {
            throw new ForbiddenException({
                errorCode: 'COPY_NOT_ALLOWED',
                message: 'صاحب این بازوی فروش فعلاً اجازهٔ کپی نداده — از او بخواه در تنظیمات، «اجازهٔ کپی محصولات» را روشن کند',
            });
        }
        return catalog;
    }

    /** لیست کالاهای کاملِ بازوی مبدأ برای تیک‌زدن — کالاهای «نیاز به تکمیل» کپی نمی‌شوند */
    async copyProducts(sourceCatalogId: string, userId: string) {
        const catalog = await this.assertCopyable(sourceCatalogId, userId);
        const ads = await this.prisma.ad.findMany({
            where: { catalogId: catalog.id, status: 'active' },
            select: {
                id: true, title: true, productType: true, description: true,
                unitPrice: true, singleUnitPrice: true, consumerPrice: true, filterPrice: true,
                unitQty: true, unitBaseTitle: true, customFields: true,
                unit: { select: { title: true } },
                brand: { select: { title: true } },
                files: { where: { fieldKey: { startsWith: 'ad-image', not: 'ad-image-ref' } }, select: { path: true, thumbnailPath: true, fieldKey: true }, orderBy: { fieldKey: 'asc' } },
            },
            orderBy: { title: 'asc' },
            take: 1000,
        });
        const items = ads
            .filter((a) => (a.customFields as any)?.needsCompletion !== true)
            .map((a) => ({
                id: a.id,
                title: a.title,
                price: a.singleUnitPrice ?? a.unitPrice, // قیمت عمدهٔ یک عدد
                unitPrice: a.unitPrice,                  // قیمت واحد فروش (کارتن = تکی × تعداد)
                unitTitle: a.unit?.title || null,
                unitQty: a.unitQty ?? null,
                unitBaseTitle: a.unitBaseTitle ?? null,
                brandTitle: a.brand?.title || null,
                image: a.files?.[0]?.thumbnailPath || a.files?.[0]?.path || null,
            }));
        return { catalog: { id: catalog.id, name: catalog.name }, items };
    }

    /**
     * ثبت کپی — کالاهای تیک‌خوردهٔ بازوی مبدأ به بازوی مقصد اضافه می‌شوند.
     * همه‌چیز با هم می‌آید: قیمت تکی/واحد فروش، تعداد در بسته، برند، کالای مرجع، توضیح و عکس‌ها.
     * تکراری‌های مقصد رد می‌شوند و در گزارش می‌آیند؛ استان/شهر کالاها = کسب‌وکارِ مقصد.
     */
    async copyProductsCommit(
        userId: string,
        dto: { sourceCatalogId: string; targetCatalogId: string; adIds: string[] },
    ) {
        const adIds = (dto.adIds || []).filter((v) => !!v).slice(0, MAX_COPY_ITEMS);
        if (!adIds.length) {
            throw new BadRequestException({ errorCode: 'COPY_EMPTY', message: 'حداقل یک کالا را تیک بزن' });
        }
        // مقصد — باید بتوانی در آن محصول اضافه کنی
        const target = await this.prisma.catalog.findUnique({
            where: { id: dto.targetCatalogId },
            select: {
                id: true, city: true, province: true, countryCode: true, provinceCode: true, cityCode: true, config: true,
                business: { select: { province: true, provinceCode: true, city: true, cityCode: true, countryCode: true } },
            },
        });
        if (!target) throw new BadRequestException({ errorCode: 'INVALID_CATALOG', message: 'بازوی فروش مقصد یافت نشد' });
        await this.catalogAccess.assertCanManageCatalog(target.id, userId, {
            errorCode: 'FORBIDDEN_CATALOG',
            message: 'به این بازوی فروش دسترسی نداری',
        });

        // مبدأ — تیک اجازه یا دسترسی مدیریت
        const source = await this.assertCopyable(dto.sourceCatalogId, userId);
        if (source.id === target.id) {
            throw new BadRequestException({ errorCode: 'COPY_SAME_CATALOG', message: 'کپی از خودِ این بازو به خودش معنی ندارد' });
        }

        const sourceAds = await this.prisma.ad.findMany({
            where: { id: { in: adIds }, catalogId: source.id, status: 'active' },
            include: {
                unit: { select: { id: true, title: true } },
                files: { where: { fieldKey: { startsWith: 'ad-image', not: 'ad-image-ref' } }, orderBy: { fieldKey: 'asc' } },
            },
        });

        // تکراری‌های مقصد — یک کوئری، تطبیق در حافظه (همان قاعدهٔ ایمپورت)
        const targetAds = await this.prisma.ad.findMany({
            where: { catalogId: target.id, status: { not: 'deleted' } },
            select: { id: true, productType: true, title: true },
            take: 3000,
        });
        const existingKeys = new Set<string>();
        for (const a of targetAds) {
            const k = normalizeItemName(a.productType || a.title || '');
            if (k) existingKeys.add(k);
        }

        const loc = {
            province: target.business?.province || target.province || '',
            provinceCode: target.business?.provinceCode ?? target.provinceCode ?? null,
            city: target.business?.city || target.city || '',
            cityCode: target.business?.cityCode ?? target.cityCode ?? null,
            countryCode: target.business?.countryCode || target.countryCode || 'IR',
        };

        const createdAds: { id: string; title: string }[] = [];
        const failed: { name: string; reason: string }[] = [];
        const usedUnits = new Map<string, { id: string; containsQty: number | null }>();
        const now = new Date();

        for (const src of sourceAds) {
            const storeTitle = normalizeForStore(src.productType || src.title || '');
            if (!storeTitle) { failed.push({ name: src.title, reason: 'نام کالا خالی است' }); continue; }
            const key = normalizeItemName(storeTitle);
            if (existingKeys.has(key)) { failed.push({ name: storeTitle, reason: 'این کالا را از قبل داشتی — کپی نشد' }); continue; }

            const srcCustom = (src.customFields as any) || {};
            const customFields: Record<string, unknown> = { ...srcCustom };
            delete customFields.needsCompletion; // کپی کامل است — پنهان نمی‌شود
            customFields.importSource = 'copy';
            customFields.copiedFromCatalogId = source.id;
            customFields.copiedFromAdId = src.id;
            customFields.copiedAt = now.toISOString();

            const ad = await this.prisma.ad.create({
                data: {
                    armId: null,
                    catalogId: target.id,
                    createdByUserId: userId,
                    catalogCategoryId: null, // دستهٔ خصوصیِ مبدأ به مقصد منتقل نمی‌شود — خودت دسته‌بندی کن
                    categoryId: src.categoryId ?? null,
                    categoryPath: [...(src.categoryPath ?? [])],
                    unitId: src.unitId,
                    title: storeTitle,
                    productType: storeTitle,
                    productReferenceId: src.productReferenceId ?? null,
                    brandId: src.brandId ?? null,
                    paymentMethods: (src.paymentMethods as any) ?? null,
                    customFields: customFields as any,
                    description: src.description ?? '',
                    unitPrice: src.unitPrice,
                    singleUnitPrice: src.singleUnitPrice ?? null,
                    consumerPrice: src.consumerPrice ?? null,
                    filterPrice: src.filterPrice ?? null,
                    hasCheque: src.hasCheque,
                    chequeMinDays: src.chequeMinDays ?? null,
                    chequeMaxDays: src.chequeMaxDays ?? null,
                    minQuantity: src.minQuantity ?? 1,
                    availableQuantity: src.availableQuantity ?? null,
                    availableQuantityBucket: src.availableQuantityBucket ?? null,
                    giftPrice: src.giftPrice ?? null,
                    volumeTiers: (src.volumeTiers as any) ?? undefined,
                    unitQty: src.unitQty ?? undefined,
                    unitIsVariableQty: src.unitIsVariableQty,
                    unitBaseTitle: src.unitBaseTitle ?? undefined,
                    city: loc.city,
                    province: loc.province,
                    countryCode: loc.countryCode,
                    provinceCode: loc.provinceCode,
                    cityCode: loc.cityCode,
                    locationDetail: '',
                    validityHours: 0, // لیست قیمت — بدون انقضا
                    expiresAt: null,
                    priceUpdatedAt: now,
                    isAnonymous: false,
                    publishToMarket: true, // کپی کامل است — مستحقِ تابلوی بازار
                    priceHistory: [{ price: src.unitPrice, updatedAt: now.toISOString(), note: 'کپی از بازوی فروش دیگر' }],
                    status: 'active',
                    source: 'copy',
                },
                select: { id: true, title: true },
            });
            createdAds.push(ad);
            existingKeys.add(key); // تکرار داخل همین بچ هم رد شود
            if (src.unitQty && src.unitQty >= 2) {
                usedUnits.set(src.unitId, { id: src.unitId, containsQty: src.unitQty });
            }

            // 🖼️ عکس‌های کالا — فایل فیزیکی همان است، فقط رکوردِ مالکیتِ تازه برای مقصد ساخته می‌شود
            for (const f of src.files ?? []) {
                try {
                    await this.prisma.file.create({
                        data: {
                            userId,
                            name: f.name,
                            mimeType: f.mimeType,
                            size: f.size,
                            path: f.path,
                            thumbnailPath: f.thumbnailPath ?? null,
                            relatedModel: 'Ad',
                            relatedId: ad.id,
                            fieldKey: f.fieldKey,
                            metadata: (f.metadata as any) ?? undefined,
                        },
                    });
                } catch { /* عکس حیاتی نیست — کالا بدون عکس هم ثبت بماند */ }
            }
        }

        // ── واحدهای تازه‌استفاده‌شده → واحدهای منتخب بازوی مقصد (config.units) ──
        if (usedUnits.size) {
            try {
                const cfg = (target.config as any) || {};
                const existing: any[] = Array.isArray(cfg.units) ? cfg.units : [];
                const existingIds = new Set(existing.map((u) => u?.unitId));
                const additions = Array.from(usedUnits.values())
                    .filter((u) => !existingIds.has(u.id))
                    .map((u) => ({ unitId: u.id, containsQty: u.containsQty ?? null, qtyIsFixed: false }));
                if (additions.length) {
                    await this.prisma.catalog.update({
                        where: { id: target.id },
                        data: { config: { ...cfg, units: [...existing, ...additions] } as any, updatedAt: new Date() },
                    });
                }
            } catch { /* غیرحیاتی */ }
        }

        // ── مهر خودکار روی بازارهای منتشرِ بازوی مقصد — کپی‌ها کامل‌اند ──
        if (createdAds.length) {
            const memberships = await this.prisma.armMembership.findMany({
                where: { catalogId: target.id, status: 'active', publishState: 'published' },
                select: { armId: true },
            });
            if (memberships.length) {
                const arms = await this.prisma.arm.findMany({
                    where: { id: { in: memberships.map((m) => m.armId) }, status: 'active' },
                    select: { id: true, categoryTree: true },
                });
                for (const arm of arms) {
                    try {
                        await this.catalogPublish.stampCatalogAds(arm, target.id, createdAds.map((a) => a.id), userId);
                    } catch { /* مهر حیاتی نیست */ }
                }
            }
            await this.cache.bust('prod-search').catch(() => undefined);
            await this.cache.bust(VITRINE_CACHE_PREFIX).catch(() => undefined);
        }

        return {
            copied: createdAds.length,
            skipped: failed.length,
            failed,
            ads: createdAds,
            targetCatalogId: target.id,
        };
    }
}