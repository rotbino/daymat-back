// src/arm-admin/catalogs/arm-admin-catalogs.service.ts
import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogPublishService } from '../../common/services/catalog-publish.service';
import { findCategoryPathInTree, findNodeInTree } from '../../common/utils/arm.utils';

/**
 * مدیریت اعضای بازار — دو-مرحله‌ای:
 *
 *   فروشندگان (Sellers)  = عضویتِ «نوشتن» — کاتالوگ‌هایی که روی تابلو اجازهٔ انتشار دارند
 *   خریداران (Buyers)    = عضویتِ «دیدن» — کسب‌وکارهایی که تابلو را می‌بینند و خرید می‌کنند
 *
 * هر دو از یک رکورد ArmMembership استفاده می‌کنند:
 *   userId    → انسانِ عضو
 *   businessId → کلاهِ کاری عضویت
 *   catalogId  → مجوز نوشتن (فقط فروشنده)
 *
 * دسترسی توسط ArmAdminGuard کنترل می‌شود؛ سرویس دوباره چک نمی‌کند.
 */
@Injectable()
export class ArmAdminCatalogsService {
    constructor(
        private prisma: PrismaService,
        private catalogPublish: CatalogPublishService,
    ) {}

    private async resolveArm(slug: string) {
        const arm = await this.prisma.arm.findUnique({
            where: { slug },
            select: { id: true, ownerUserId: true, categoryTree: true },
        });
        if (!arm) {
            throw new NotFoundException({ errorCode: 'ARM_NOT_FOUND', message: 'بازار یافت نشد' });
        }
        return arm;
    }

    /** همهٔ مالک‌های فعال این بازار */
    private async getOwnerIds(armId: string): Promise<string[]> {
        const owners = await this.prisma.armMembership.findMany({
            where: { armId, role: 'arm_owner', status: 'active' },
            select: { userId: true },
        });
        return owners.map((o) => o.userId);
    }

    /** دریافت/ساخت عضویت فرد در بازار (بدون کاتالوگ) — فقط buyer */
    private async ensureMembership(armId: string, userId: string, businessId: string) {
        // ✅ membership این کاربر در این بازار رو پیدا کن
        const existing = await this.prisma.armMembership.findUnique({
            where: { armId_userId: { armId, userId } },
        });
        if (existing) return existing;
        return this.prisma.armMembership.create({
            data: {
                armId,
                userId,
                businessId,
                role: 'arm_member',
                roleType: 'buyer',
                status: 'active',
                source: 'owner_add',
            },
        });
    }

    // ═══════════════════════════════════════════════════════
    // ═══              فروشندگان بازار                     ═══
    // ═══════════════════════════════════════════════════════

    // ============================================================
    // S1) کاتالوگ‌های فروشندهٔ عضو بازار — با جستجو، فیلتر و سورت
    // ============================================================
    async getSellers(
        slug: string,
        options?: {
            search?: string;
            ownerStatus?: 'all' | 'active' | 'paused';
            sortBy?: string;
            sortOrder?: 'asc' | 'desc';
        },
    ) {
        const arm = await this.resolveArm(slug);
        const search = options?.search?.trim();
        const ownerStatus = options?.ownerStatus ?? 'all';
        const sortBy = options?.sortBy ?? 'joinedAt';
        const sortOrder = options?.sortOrder ?? 'desc';

        const memberships = await this.prisma.armMembership.findMany({
            where: {
                armId: arm.id,
                catalogId: { not: null },  // ✅ seller = کسی که catalogId دارد (شامل seller و seller-buyer)
                status: { not: 'removed' },  // ✅ فقط اعضای حذف‌نشده
                ...(ownerStatus === 'active' ? { businessStatus: 'active' } : {}),
                ...(ownerStatus === 'paused' ? { businessStatus: 'paused' } : {}),
            },
            include: {
                catalog: {
                    select: {
                        id: true, name: true, slug: true, salesType: true, type: true,
                        city: true, logoUrl: true, updatedAt: true,
                        business: {
                            select: {
                                id: true, name: true, type: true, industryName: true,
                                owner: { select: { fullName: true, phone: true } },
                            },
                        },
                    },
                },
            },
            orderBy: { joinedAt: 'desc' },
        });

        const catIds = memberships.map((m) => m.catalogId!).filter(Boolean);

        const [tableCounts, needsCounts, lastUpdates] = catIds.length
            ? await Promise.all([
                this.prisma.ad.groupBy({
                    by: ['catalogId'],
                    where: {
                        catalogId: { in: catIds }, armId: arm.id,
                        status: 'active', expiresAt: { gt: new Date() },
                    },
                    _count: { _all: true },
                }),
                this.prisma.ad.groupBy({
                    by: ['catalogId'],
                    where: {
                        catalogId: { in: catIds }, armId: arm.id,
                        categoryId: null, catalogCategoryId: { not: null },
                    },
                    _count: { _all: true },
                }),
                this.prisma.ad.groupBy({
                    by: ['catalogId'],
                    where: { catalogId: { in: catIds }, armId: arm.id },
                    _max: { updatedAt: true },
                }),
            ])
            : [[], [], []];

        const tableMap = new Map(tableCounts.map((r: any) => [r.catalogId, r._count._all]));
        const needsMap = new Map(needsCounts.map((r: any) => [r.catalogId, r._count._all]));
        const lastUpdateMap = new Map(lastUpdates.map((r: any) => [r.catalogId, r._max.updatedAt]));

        let items = memberships
            .filter((m) => m.catalog)
            .map((m) => ({
                membershipId: m.id,
                status: m.status,
                businessStatus: m.businessStatus,  // ✅ وضعیت تجاری (active | paused)
                publishState: m.publishState,
                roleType: 'seller',  // ✅ backward-compat برای فرانت
                joinedAt: m.joinedAt,
                catalog: {
                    ...(m.catalog as any),
                    owner: (m.catalog as any)?.business?.owner ?? null,
                    businessName: (m.catalog as any)?.business?.name ?? null,
                    businessIndustry: (m.catalog as any)?.business?.industryName ?? null,
                    businessType: (m.catalog as any)?.business?.type ?? null,
                },
                activeOnTable: tableMap.get(m.catalogId!) ?? 0,
                needsCategory: needsMap.get(m.catalogId!) ?? 0,
                lastAdUpdatedAt: lastUpdateMap.get(m.catalogId!) ?? null,
            }));

        if (search) {
            const s = search.toLowerCase();
            items = items.filter((i) =>
                i.catalog.name.toLowerCase().includes(s) ||
                (i.catalog.slug ?? '').toLowerCase().includes(s) ||
                (i.catalog.businessName ?? '').toLowerCase().includes(s) ||
                (i.catalog.owner?.fullName ?? '').toLowerCase().includes(s) ||
                (i.catalog.owner?.phone ?? '').includes(s),
            );
        }

        const dir = sortOrder === 'asc' ? 1 : -1;
        items.sort((a, b) => {
            switch (sortBy) {
                case 'name':
                    return dir * a.catalog.name.localeCompare(b.catalog.name, 'fa');
                case 'table':
                    return dir * (a.activeOnTable - b.activeOnTable);
                case 'needs':
                    return dir * (a.needsCategory - b.needsCategory);
                case 'updated': {
                    const ta = a.lastAdUpdatedAt ? new Date(a.lastAdUpdatedAt).getTime() : 0;
                    const tb = b.lastAdUpdatedAt ? new Date(b.lastAdUpdatedAt).getTime() : 0;
                    return dir * (ta - tb);
                }
                case 'joinedAt':
                default:
                    return dir * (new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime());
            }
        });

        const STALE_MS = 3 * 24 * 60 * 60 * 1000;
        const now = Date.now();
        return {
            items: items.map((i) => ({
                ...i,
                isStale: !i.lastAdUpdatedAt || (now - new Date(i.lastAdUpdatedAt).getTime() > STALE_MS),
            })),
        };
    }

    // ============================================================
    // S2) کاندیدهای فروشنده — کاتالوگ‌هایی که هنوز عضو نیستند
    // ============================================================
    async getSellerCandidates(requesterId: string, slug: string, q?: string, onlyMyReferrals?: boolean) {
        const arm = await this.resolveArm(slug);

        let referredUserIds: string[] | undefined;
        if (onlyMyReferrals) {
            const ownerIds = await this.getOwnerIds(arm.id);
            const isOwner = ownerIds.includes(requesterId);
            const isAdmin = await this.prisma.user.findFirst({
                where: { id: requesterId, role: 'system_admin' },
                select: { id: true },
            });

            if (ownerIds.length === 0 || (!isOwner && !!isAdmin)) {
                referredUserIds = undefined;
            } else {
                const referred = await this.prisma.user.findMany({
                    where: { referredByUserId: { in: ownerIds } },
                    select: { id: true },
                });
                referredUserIds = referred.map((u) => u.id);
                if (referredUserIds.length === 0) return { items: [] };
            }
        }

        // ✅ فقط عضویت‌های «زنده» (active/pending/paused) کاتالوگشان را از کاندیدها حذف می‌کنند —
        //    removed یعنی مالک قبلاً حذف کرده و می‌تواند دوباره اضافه شود
        const liveMembers = await this.prisma.armMembership.findMany({
            where: { armId: arm.id, catalogId: { not: null }, status: { in: ['active', 'pending', 'paused'] } },
            select: { catalogId: true },
        });
        const excludeCatIds = liveMembers.map((m) => m.catalogId!);

        const catalogs = await this.prisma.catalog.findMany({
            where: {
                status: { not: 'closed' },
                ...(excludeCatIds.length ? { id: { notIn: excludeCatIds } } : {}),
                ...(referredUserIds
                    ? { business: { is: { ownerUserId: { in: referredUserIds } } } }
                    : {}),
                ...(q
                    ? {
                        OR: [
                            { name: { contains: q } },
                            { phone: { contains: q } },
                            { industryName: { contains: q } },
                            { business: { is: { owner: { is: { OR: [
                                                    { phone: { contains: q } },
                                                    { fullName: { contains: q } },
                                                ] } } } } },
                        ],
                    }
                    : {}),
            },
            select: {
                id: true, name: true, slug: true, salesType: true, type: true,
                city: true, logoUrl: true, industryName: true,
                business: {
                    select: {
                        id: true, name: true, type: true, industryName: true,
                        owner: { select: { id: true, fullName: true, phone: true } },
                    },
                },
                _count: { select: { ads: { where: { status: 'active' } } } },
            },
            take: 20,
            orderBy: { createdAt: 'desc' },
        });

        return {
            items: catalogs.map((b) => ({
                id: b.id,
                name: b.name,
                slug: b.slug,
                salesType: b.salesType,
                type: b.type,
                city: b.city,
                logoUrl: b.logoUrl,
                industryName: b.industryName,
                owner: (b.business as any)?.owner ?? null,
                businessId: (b.business as any)?.id ?? null,
                businessName: (b.business as any)?.name ?? null,
                businessIndustry: (b.business as any)?.industryName ?? null,
                _count: b._count,
            })),
        };
    }

    // ============================================================
    // S3) افزودن فروشنده — کاتالوگ + مهر انتشار
    // ============================================================
    // ✅ مدل: یک کاربر در یک بازار فقط یک membership دارد
    //    - role (systemic): arm_owner / arm_member — هرگز تغییر نمی‌کند
    //    - roleType (business): seller / buyer / null
    //    - اگه catalogId ست باشه → seller
    //
    // این متد:
    //   1) membership کاربر رو پیدا می‌کنه (با armId + userId)
    //   2) اگه هست و قبلاً با کاتالوگ دیگه‌ای seller شده → خطا
    //   3) اگه هست → آپدیت کن (businessId, catalogId, roleType=seller, publishState=published)
    //      ولی role رو دست نمی‌زنه (اگه arm_owner بوده، arm_owner می‌مونه)
    //   4) اگه نیست → بساز با role=arm_member
    // ============================================================
    async addSeller(slug: string, catalogId: string) {
        const arm = await this.resolveArm(slug);

        const catalog = await this.prisma.catalog.findFirst({
            where: { id: catalogId, status: { not: 'closed' } },
            select: { id: true, business: { select: { id: true, ownerUserId: true } } },
        });
        if (!catalog) {
            throw new NotFoundException({ errorCode: 'CATALOG_NOT_FOUND', message: 'کاتالوگ یافت نشد' });
        }
        const ownerUserId = (catalog.business as any).ownerUserId;
        const businessId = (catalog.business as any).id;

        // ✅ membership این کاربر در این بازار رو پیدا کن
        const existing = await this.prisma.armMembership.findUnique({
            where: { armId_userId: { armId: arm.id, userId: ownerUserId } },
        });

        // ✅ چک کن: اگه قبلاً با کاتالوگ دیگه‌ای seller شده → خطا
        if (existing?.catalogId && existing.catalogId !== catalogId) {
            throw new ConflictException({
                errorCode: 'BUSINESS_HAS_OTHER_CATALOG',
                message: 'این کاربر با کاتالوگ دیگری در این بازار فعال است — ابتدا آن را حذف کنید',
            });
        }

        // ✅ تعیین roleType نهایی:
        //    - اگه buyer هست (businessId داره ولی catalogId نداره) → seller-buyer
        //    - وگرنه → seller
        const newRoleType = existing?.businessId ? 'seller-buyer' : 'seller';

        // ✅ آپدیت یا ساخت membership
        // نکته: role رو دست نمی‌زنیم — اگه arm_owner بوده، arm_owner می‌مونه
        const membership = existing
            ? await this.prisma.armMembership.update({
                where: { id: existing.id },
                data: {
                    status: 'active',
                    publishState: 'published',
                    roleType: newRoleType,
                    businessId,
                    catalogId,
                    rejectionReason: null,
                    reviewedByUserId: null,
                    reviewedAt: null,
                    source: 'owner_add',
                },
            })
            : await this.prisma.armMembership.create({
                data: {
                    armId: arm.id,
                    userId: ownerUserId,
                    businessId,
                    catalogId,
                    role: 'arm_member',
                    roleType: 'seller',
                    status: 'active',
                    publishState: 'published',
                    source: 'owner_add',
                },
            });

        // ✅ قبل از stamp، تمام آگهی‌های فعال این کاتالوگ رو publishToMarket=true کن
        // این یعنی وقتی کاتالوگ به بازار اضافه می‌شه، همه آگهی‌هاش خودکار منتشر می‌شن
        await this.prisma.ad.updateMany({
            where: {
                catalogId,
                status: 'active',
                publishToMarket: false,  // ← فقط اونایی که هنوز false هستن
            },
            data: {
                publishToMarket: true,
            },
        });

        // ✅ همچنین آگهی‌های منقضی‌شده رو تمدید کن (اگه اعتبارشون تموم شده)
        // این کار فقط برای آگهی‌هایی که status=active ولی expiresAt گذشته
        await this.prisma.ad.updateMany({
            where: {
                catalogId,
                status: 'active',
                expiresAt: { lt: new Date() },
            },
            data: {
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),  // ۲۴ ساعت اعتبار
            },
        });

        const stamp = await this.catalogPublish.stampCatalogAds(arm, catalogId, undefined, ownerUserId);
        return {
            membership,
            ...stamp,
            message: stamp.needsCategory.length
                ? `${stamp.stamped} کالا منتشر شد — ${stamp.needsCategory.length} کالا نیاز به تعیین دستهٔ بازاری دارد`
                : `${stamp.stamped} کالا با دستهٔ مناسب منتشر شد`,
        };
    }

    // ═══════════════════════════════════════════════════════
    // ═══              خریداران بازار                      ═══
    // ═══════════════════════════════════════════════════════

    // ============================================================
    // B1) خریداران عضو بازار — کسب‌وکارها + مشخصات
    // ============================================================
    async getBuyers(
        slug: string,
        options?: {
            search?: string;
            ownerStatus?: 'all' | 'active' | 'paused';
            sortBy?: string;
            sortOrder?: 'asc' | 'desc';
        },
    ) {
        const arm = await this.resolveArm(slug);
        const search = options?.search?.trim();
        const ownerStatus = options?.ownerStatus ?? 'all';
        const sortBy = options?.sortBy ?? 'joinedAt';
        const sortOrder = options?.sortOrder ?? 'desc';

        const memberships = await this.prisma.armMembership.findMany({
            where: {
                armId: arm.id,
                businessId: { not: null },  // ✅ buyer = کسی که businessId دارد (شامل buyer و seller-buyer)
                status: { not: 'removed' },  // ✅ فقط اعضای حذف‌نشده
            },
            include: {
                user: { select: { id: true, fullName: true, phone: true, avatarUrl: true } },
                business: {
                    select: {
                        id: true, name: true, type: true, industryName: true,
                        city: true, province: true, logoUrl: true, createdAt: true,
                    },
                },
                catalog: { select: { id: true, name: true, slug: true } },
            },
            orderBy: { joinedAt: 'desc' },
        });

        let items = memberships.map((m) => ({
            membershipId: m.id,
            userId: m.userId,
            status: m.status,
            businessStatus: m.businessStatus,  // ✅ وضعیت تجاری (active | paused)
            joinedAt: m.joinedAt,
            user: m.user,
            // ✅ کسب‌وکارِ عضویت — اگر هنوز نهاد ثبت نکرده (کاربر قدیمی)، null و UI می‌گوید
            business: m.business
                ? {
                    ...(m.business as any),
                    hasCatalog: !!m.catalogId,
                    catalogName: m.catalog?.name ?? null,
                }
                : null,
        }));

        if (search) {
            const s = search.toLowerCase();
            items = items.filter((i) =>
                (i.business?.name ?? '').toLowerCase().includes(s) ||
                (i.business?.industryName ?? '').toLowerCase().includes(s) ||
                (i.user?.fullName ?? '').toLowerCase().includes(s) ||
                (i.user?.phone ?? '').includes(s),
            );
        }

        const dir = sortOrder === 'asc' ? 1 : -1;
        items.sort((a, b) => {
            switch (sortBy) {
                case 'name':
                    return dir * (a.business?.name ?? '').localeCompare(b.business?.name ?? '', 'fa');
                case 'joinedAt':
                default:
                    return dir * (new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime());
            }
        });

        return { items };
    }

    // ============================================================
    // B2) کاندیدهای خریدار — کسب‌وکارهایی که هنوز خریدار این بازار نیستند
    // ============================================================
    async getBuyerCandidates(requesterId: string, slug: string, q?: string, onlyMyReferrals?: boolean) {
        const arm = await this.resolveArm(slug);

        let referredUserIds: string[] | undefined;
        if (onlyMyReferrals) {
            const ownerIds = await this.getOwnerIds(arm.id);
            const isOwner = ownerIds.includes(requesterId);
            const isAdmin = await this.prisma.user.findFirst({
                where: { id: requesterId, role: 'system_admin' },
                select: { id: true },
            });

            if (ownerIds.length === 0 || (!isOwner && !!isAdmin)) {
                referredUserIds = undefined;
            } else {
                const referred = await this.prisma.user.findMany({
                    where: { referredByUserId: { in: ownerIds } },
                    select: { id: true },
                });
                referredUserIds = referred.map((u) => u.id);
                if (referredUserIds.length === 0) return { items: [] };
            }
        }

        // ✅ فقط عضویت‌های «زنده»ٔ خریدار exclude می‌شوند
        const liveBuyers = await this.prisma.armMembership.findMany({
            where: { armId: arm.id, businessId: { not: null }, status: { in: ['active', 'pending', 'paused'] } },
            select: { businessId: true },
        });
        const excludeBizIds = liveBuyers.map((m) => m.businessId).filter(Boolean) as string[];

        const businesses = await this.prisma.business.findMany({
            where: {
                status: 'active',
                ...(excludeBizIds.length ? { id: { notIn: excludeBizIds } } : {}),
                ...(referredUserIds ? { ownerUserId: { in: referredUserIds } } : {}),
                ...(q ? {
                    OR: [
                        { name: { contains: q } },
                        { phone: { contains: q } },
                        { industryName: { contains: q } },
                        {
                            owner: {
                                is: {
                                    OR: [
                                        { phone: { contains: q } },
                                        { fullName: { contains: q } },
                                    ]
                                }
                            }
                        },
                    ],
                } : {}),
            },
            select: {
                id: true,
                name: true,
                type: true,
                industryName: true,
                city: true,
                province: true,
                logoUrl: true,
                owner: { select: { id: true, fullName: true, phone: true } },
                _count: { select: { catalogs: true } },
            },
            take: 20,
            orderBy: { createdAt: 'desc' },
        });

        return { items: businesses };
    }
// ============================================================
// B3) افزودن خریدار — مستقیم توسط مالک بازار (برای نهاد انتخابی)
// ============================================================
async addBuyer(slug: string, businessId: string) {
    const arm = await this.resolveArm(slug);

    const biz = await this.prisma.business.findFirst({
        where: { id: businessId, status: 'active' },
        select: { id: true, ownerUserId: true, name: true },
    });
    if (!biz) {
        throw new NotFoundException({ errorCode: 'BUSINESS_NOT_FOUND', message: 'کسب‌وکار یافت نشد' });
    }

    // ✅ membership این کاربر در این بازار رو پیدا کن
    const existing = await this.prisma.armMembership.findUnique({
        where: { armId_userId: { armId: arm.id, userId: biz.ownerUserId } },
    });

    // ✅ چک کن: اگه قبلاً buyer هست (فقط businessId داره) → خطا
    if (existing?.roleType === 'buyer' && ['active', 'pending', 'paused'].includes(existing.status)) {
        throw new ConflictException({
            errorCode: 'ALREADY_BUYER',
            message: 'این کسب‌وکار قبلاً خریدار این بازار شده است',
        });
    }

    // ✅ تعیین roleType نهایی:
    //    - اگه seller هست (catalogId داره) → seller-buyer (هم فروشنده هم خریدار)
    //    - وگرنه → buyer
    const newRoleType = existing?.catalogId ? 'seller-buyer' : 'buyer';

    // ✅ آپدیت یا ساخت membership
    // نکته: role رو دست نمی‌زنیم — اگه arm_owner بوده، arm_owner می‌مونه
    const membership = existing
        ? await this.prisma.armMembership.update({
            where: { id: existing.id },
            data: {
                status: 'active',
                roleType: newRoleType,
                businessId: biz.id,
                rejectionReason: null,
                source: 'owner_add',
            },
        })
        : await this.prisma.armMembership.create({
            data: {
                armId: arm.id,
                userId: biz.ownerUserId,
                businessId: biz.id,
                role: 'arm_member',
                roleType: 'buyer',
                status: 'active',
                source: 'owner_add',
            },
        });

    return {
        membership,
        message: `«${biz.name}» به‌عنوان خریدار به بازار اضافه شد${newRoleType === 'seller-buyer' ? ' (اکنون هم فروشنده هم خریدار است)' : ''}`,
    };
}

// ============================================================
// ۴) توقف / ادامهٔ عضو — فقط businessStatus (نه status سیستمی)
// ============================================================
// ✅ Pause = تعلیق موقت نقش تجاری
//    - seller: آگهی‌ها از تابلو غیب می‌شن (unstamp) ولی در کاتالوگ می‌مونن
//    - buyer: حق دیدن قیمت‌ها رو از دست می‌ده
//    - status سیستمی (active) دست نمی‌خوره — arm_owner به پنل دسترسی داره
// ============================================================
async setCatalogPaused(slug: string, catalogId: string, paused: boolean) {
    const arm = await this.resolveArm(slug);
    const membership = await this.getMembershipByCatalog(arm.id, catalogId);

    if (paused) {
        // ✅ pause: آگهی‌ها رو از تابلو بردار، businessStatus=paused کن
        await this.catalogPublish.unstampCatalogAds(catalogId, arm.id);
        return this.prisma.armMembership.update({
            where: { id: membership.id },
            data: { businessStatus: 'paused' },
        });
    }

    // ✅ resume: businessStatus=active کن، اگه publishState=published بود دوباره stamp کن
    const updated = await this.prisma.armMembership.update({
        where: { id: membership.id },
        data: { businessStatus: 'active' },
    });
    if (membership.publishState === 'published') {
        const stamp = await this.catalogPublish.stampCatalogAds(arm, catalogId);
        return { membership: updated, ...stamp };
    }
    return { membership: updated };
}

// ============================================================
// ۵) حذف نقش فروشندگی — پاک کردن catalogId از membership
// ============================================================
// ✅ اگه arm_owner هست: فقط catalogId/roleType/publishState رو پاک کن (membership می‌مونه)
//    اگه arm_member هست: کل membership رو به status=removed ببر
// ============================================================
async removeCatalog(slug: string, catalogId: string, adminUserId: string) {
    const arm = await this.resolveArm(slug);
    const membership = await this.getMembershipByCatalog(arm.id, catalogId);

    // آگهی‌ها رو از تابلو بردار
    await this.catalogPublish.unstampCatalogAds(catalogId, arm.id);

    if (membership.role === 'arm_owner') {
        // ✅ arm_owner: فقط نقش فروشندگی رو پاک کن، membership می‌مونه
        // اگه businessId داره (buyer هم هست) → roleType=buyer کن
        // وگرنه → roleType=null کن
        const newRoleType = membership.businessId ? 'buyer' : null;
        return this.prisma.armMembership.update({
            where: { id: membership.id },
            data: {
                catalogId: null,
                publishState: null,
                roleType: newRoleType,
                reviewedByUserId: adminUserId,
                reviewedAt: new Date(),
            },
        });
    }

    // arm_member: کل membership رو removed کن
    return this.prisma.armMembership.update({
        where: { id: membership.id },
        data: {
            status: 'removed',
            publishState: null,
            catalogId: null,
            roleType: null,
            reviewedByUserId: adminUserId,
            reviewedAt: new Date(),
        },
    });
}

// ============================================================
// ۵.۵) حذف نقش خریداری — پاک کردن businessId از membership
// ============================================================
// ✅ اگه arm_owner هست: فقط businessId رو پاک کن (اگه catalogId نداره)
//    اگه arm_member هست: کل membership رو به status=removed ببر
// ============================================================
async removeBuyer(slug: string, membershipId: string, adminUserId: string) {
    const arm = await this.resolveArm(slug);

    const membership = await this.prisma.armMembership.findFirst({
        where: { id: membershipId, armId: arm.id },
    });
    if (!membership) {
        throw new NotFoundException({ errorCode: 'MEMBER_NOT_FOUND', message: 'عضو یافت نشد' });
    }

    if (membership.role === 'arm_owner') {
        // ✅ arm_owner: فقط اگه catalogId نداره، businessId رو پاک کن
        // اگه catalogId داره (seller-buyer هست)، فقط roleType رو به seller تغییر بده
        if (membership.catalogId) {
            return this.prisma.armMembership.update({
                where: { id: membership.id },
                data: {
                    businessId: null,
                    roleType: 'seller',
                    reviewedByUserId: adminUserId,
                    reviewedAt: new Date(),
                },
            });
        }
        // فقط buyer هست → businessId و roleType رو پاک کن
        return this.prisma.armMembership.update({
            where: { id: membership.id },
            data: {
                businessId: null,
                roleType: null,
                reviewedByUserId: adminUserId,
                reviewedAt: new Date(),
            },
        });
    }

    // arm_member: کل membership رو removed کن
    return this.prisma.armMembership.update({
        where: { id: membership.id },
        data: {
            status: 'removed',
            publishState: null,
            businessId: null,
            roleType: null,
            reviewedByUserId: adminUserId,
            reviewedAt: new Date(),
        },
    });
}

// ============================================================
// ۵.۷) Pause/Resume buyer — فقط businessStatus (نه status سیستمی)
// ============================================================
async setBuyerPaused(slug: string, membershipId: string, paused: boolean) {
    const arm = await this.resolveArm(slug);
    const membership = await this.prisma.armMembership.findFirst({
        where: { id: membershipId, armId: arm.id },
    });
    if (!membership) {
        throw new NotFoundException({ errorCode: 'MEMBER_NOT_FOUND', message: 'عضو یافت نشد' });
    }

    return this.prisma.armMembership.update({
        where: { id: membership.id },
        data: { businessStatus: paused ? 'paused' : 'active' },
    });
}

// ============================================================
// ۶) کالاهای نیازمند تعیین دستهٔ بازاری (پنل مالک)
// ============================================================
async getNeedsCategory(slug: string) {
    const arm = await this.resolveArm(slug);

    const ads = await this.prisma.ad.findMany({
        where: {
            armId: arm.id, status: 'active',
            categoryId: null, catalogCategoryId: { not: null },
        },
        select: {
            id: true, title: true, productType: true, updatedAt: true,
            catalogId: true, catalogCategoryId: true,
            catalog: { select: { name: true, config: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 200,
    });

    const treeCache = new Map<string, any[]>();
    const items = ads.map((ad) => {
        let tree = treeCache.get(ad.catalogId);
        if (!tree) {
            tree = (((ad.catalog as any)?.config as any)?.categoryTree as any[]) || [];
            treeCache.set(ad.catalogId, tree);
        }
        const node = findNodeInTree(tree, ad.catalogCategoryId!);
        return {
            id: ad.id,
            title: ad.title,
            productType: ad.productType,
            catalogName: (ad.catalog as any)?.name ?? '',
            catalogCategoryTitle: node?.title ?? null,
        };
    });

    return { items };
}

// ============================================================
// ۷) تعیین دستهٔ بازاری یک کالا (توسط مالک بازار)
// ============================================================
async setAdCategory(slug: string, adId: string, categoryId: string) {
    const arm = await this.resolveArm(slug);

    const node = findNodeInTree((arm.categoryTree as any[]) || [], categoryId);
    if (!node) {
        throw new BadRequestException({
            errorCode: 'CATEGORY_NOT_IN_ARM',
            message: 'این دسته در درخت بازار وجود ندارد',
        });
    }

    const ad = await this.prisma.ad.findFirst({
        where: { id: adId, armId: arm.id },
        select: { id: true },
    });
    if (!ad) {
        throw new NotFoundException({ errorCode: 'AD_NOT_IN_ARM', message: 'آگهی در این بازار منتشر نیست' });
    }

    return this.prisma.ad.update({
        where: { id: adId },
        data: {
            categoryId,
            categoryPath: findCategoryPathInTree(
                (arm.categoryTree as any[]) || [],
                categoryId,
            ) || [],
        },
        select: { id: true, categoryId: true, categoryPath: true },
    });
}

// ============================================================
// ۸) آمار رفرال بازار
// ============================================================
async getReferralStats(requesterId: string, slug: string) {
    const arm = await this.resolveArm(slug);
    const ownerIds = await this.getOwnerIds(arm.id);

    const isAdmin = await this.prisma.user.findFirst({
        where: { id: requesterId, role: 'system_admin' },
        select: { id: true },
    });
    const scopeOwnerIds = (ownerIds.length === 0 || (!ownerIds.includes(requesterId) && !!isAdmin))
        ? null as string[] | null
        : ownerIds;

    const invitedUsers = await this.prisma.user.findMany({
        where: scopeOwnerIds
            ? { referredByUserId: { in: scopeOwnerIds } }
            : { referredByUserId: { not: null } },
        select: {
            id: true, fullName: true, phone: true, createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
    });
    const invitedIds = invitedUsers.map((u) => u.id);

    // ✅ شمارش کاتالوگ هر دعوت‌شده — groupBy (User رلیشن catalogs ندارد)
    const catCountRows = invitedIds.length
        ? await this.prisma.catalog.groupBy({
            by: ['referredByUserId'],
            _count: { _all: true },
            where: {
                referredByUserId: { in: invitedIds },
                status: { not: 'closed' },
            },
        })
        : [];
    const catCountMap = new Map<string, number>();
    for (const r of catCountRows as any[]) {
        if (r.referredByUserId) catCountMap.set(r.referredByUserId, r._count._all);
    }

    const catalogs = await this.prisma.catalog.findMany({
        where: {
            status: { not: 'closed' },
            OR: scopeOwnerIds
                ? [
                    { referredByUserId: { in: scopeOwnerIds } },
                    ...(invitedIds.length
                        ? [{ business: { is: { ownerUserId: { in: invitedIds } } } }]
                        : []),
                ]
                : [
                    { referredByUserId: { not: null } },
                    ...(invitedIds.length
                        ? [{ business: { is: { ownerUserId: { in: invitedIds } } } }]
                        : []),
                ],
        },
        select: {
            id: true, name: true, slug: true, salesType: true, createdAt: true,
            referredByUserId: true,
            business: {
                select: { owner: { select: { fullName: true, phone: true } } },
            },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
    });

    const catIds = catalogs.map((c) => c.id);
    const members = catIds.length
        ? await this.prisma.armMembership.findMany({
            where: { armId: arm.id, catalogId: { in: catIds } },
            select: { catalogId: true, status: true, publishState: true },
        })
        : [];
    const mMap = new Map(members.map((m) => [m.catalogId, m]));

    return {
        invitedCount: invitedUsers.length,
        invitedUsers: invitedUsers.map((u) => ({
            id: u.id,
            fullName: u.fullName,
            phone: u.phone,
            catalogsCount: catCountMap.get(u.id) ?? 0,
            joinedAt: u.createdAt,
        })),
        catalogs: catalogs.map((c) => ({
            id: c.id,
            name: c.name,
            slug: c.slug,
            salesType: c.salesType,
            createdAt: c.createdAt,
            owner: (c.business as any)?.owner ?? null,
            isMember: mMap.has(c.id),
            membership: mMap.get(c.id) ?? null,
        })),
    };
}

// ============================================================
// ۹) تعیین دستهٔ بازاری توسط صاحب کاتالوگ (از داشبورد)
// ============================================================
async setOwnAdCategory(userId: string, adId: string, categoryId: string) {
    const ad = await this.prisma.ad.findUnique({
        where: { id: adId },
        select: {
            id: true,
            armId: true,
            catalogCategoryId: true,
            catalog: { select: { business: { select: { ownerUserId: true } } } },
        },
    });
    if (!ad) {
        throw new NotFoundException({ errorCode: 'AD_NOT_FOUND', message: 'آگهی یافت نشد' });
    }
    if ((ad.catalog as any)?.business?.ownerUserId !== userId) {
        throw new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'فقط مالک کاتالوگ' });
    }
    if (!ad.armId) {
        throw new BadRequestException({
            errorCode: 'NOT_IN_MARKET',
            message: 'این کالا در هیچ بازاری منتشر نشده است',
        });
    }

    const arm = await this.prisma.arm.findUnique({
        where: { id: ad.armId },
        select: { id: true, categoryTree: true },
    });
    if (!arm) {
        throw new NotFoundException({ errorCode: 'ARM_NOT_FOUND', message: 'بازار یافت نشد' });
    }

    const node = findNodeInTree((arm.categoryTree as any[]) || [], categoryId);
    if (!node) {
        throw new BadRequestException({
            errorCode: 'CATEGORY_NOT_IN_ARM',
            message: 'این دسته در درخت بازار وجود ندارد',
        });
    }

    return this.prisma.ad.update({
        where: { id: adId },
        data: {
            categoryId,
            categoryPath: findCategoryPathInTree(
                (arm.categoryTree as any[]) || [],
                categoryId,
            ) || [],
        },
        select: { id: true, categoryId: true, categoryPath: true },
    });
}

// ============================================================
// ۱۰) کالاهای «کاربر» منتشرشده در بازار که دستهٔ بازاری ندارند
// ============================================================
async getMyNeedsCategory(userId: string) {
    const bizIds = (await this.prisma.business.findMany({
        where: { ownerUserId: userId, status: 'active' },
        select: { id: true },
    })).map((b) => b.id);

    const myCatalogIds = bizIds.length
        ? (await this.prisma.catalog.findMany({
            where: { businessId: { in: bizIds } },
            select: { id: true },
        })).map((c) => c.id)
        : [];

    if (myCatalogIds.length === 0) return { items: [] };

    const ads = await this.prisma.ad.findMany({
        where: {
            armId: { not: null },
            status: 'active',
            categoryId: null,
            catalogCategoryId: { not: null },
            catalogId: { in: myCatalogIds },
        },
        select: {
            id: true, title: true, productType: true, updatedAt: true,
            armId: true, catalogCategoryId: true,
            catalogId: true,
            arm: { select: { slug: true, name: true, categoryTree: true } },
            catalog: { select: { name: true, config: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 200,
    });

    const items = ads.map((ad) => {
        const catTree = (((ad.catalog as any)?.config as any)?.categoryTree as any[]) || [];
        const catNode = findNodeInTree(catTree, ad.catalogCategoryId!);
        const marketTree = ((ad.arm as any)?.categoryTree as any[]) || [];
        const suggestion = marketTree[0]?.children?.[0]?.id ?? marketTree[0]?.id ?? null;
        return {
            id: ad.id,
            title: ad.title,
            productType: ad.productType,
            armSlug: (ad.arm as any)?.slug,
            armName: (ad.arm as any)?.name,
            businessId: ad.catalogId,
            catalogId: ad.catalogId,
            businessName: (ad.catalog as any)?.name ?? '',
            catalogCategoryTitle: catNode?.title ?? null,
            suggestedCategoryId: suggestion,
            marketCategoryTitles: marketTree.slice(0, 6).map((n: any) => n.title),
        };
    });

    return { items };
}

// ============================================================
// ۱۱) کاتالوگ‌های عضو بازار (سازگاری با تب «کاتالوگ‌های بازار» قدیمی)
// ============================================================
async getCatalogs(
    slug: string,
    options?: {
        search?: string;
        ownerStatus?: 'all' | 'active' | 'paused';
        sortBy?: string;
        sortOrder?: 'asc' | 'desc';
    },
) {
    return this.getSellers(slug, options);
}

async getCandidates(requesterId: string, slug: string, q?: string, onlyMyReferrals?: boolean) {
    return this.getSellerCandidates(requesterId, slug, q, onlyMyReferrals);
}

async addCatalog(slug: string, catalogId: string) {
    return this.addSeller(slug, catalogId);
}

// ─── خصوصی ───
private async getMembershipByCatalog(armId: string, catalogId: string) {
    // ✅ membership که این catalogId رو داره پیدا کن (فقط seller)
    const membership = await this.prisma.armMembership.findFirst({
        where: { armId, catalogId, roleType: 'seller' },
    });
    if (!membership) {
        throw new NotFoundException({ errorCode: 'NOT_MEMBER', message: 'این کاتالوگ عضو این بازار نیست' });
    }
    return membership;
}
}