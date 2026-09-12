// src/catalog/catalog-member.service.ts
import {
    Injectable,
    NotFoundException,
    ConflictException,
    BadRequestException,
    ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheHelper } from '../common/services/cache.helper';

/**
 * اعضای کاتالوگ — ابزار ارتباطات تجاری برای هر دسته‌بندی کالا (پخش فقط یک نمونه است):
 *
 *   نقش سیستمی:  مالک (= مالکِ کسب‌وکارِ کاتالوگ — مشتق، بالاترین دسترسی)
 *                مدیر (منصوبِ مالک — سهیم در مدیریت) | عضو
 *   لِین بیزینسی: همکار فروش (فروشنده/ویزیتور — با منطقهٔ فروش)
 *                خریدار (کسب‌وکارِ ثبت‌شده — منتسب به یک مسئول فروش برای مسیریابی تماس)
 *                تامین‌کننده (عضویت با کاتالوگِ خودش — شبکه‌سازی بین کاتالوگ‌ها)
 *
 *   جریان‌ها (یک در برای همه: «درخواست ارتباط تجاری» روی کاتالوگ):
 *   - هر سه نقش: درخواست → تایید مدیر (مالک کاتالوگ) → فعال
 *   - خریدارِ ثبت‌شده توسط مسئول فروش: تایید با صاحبِ کسب‌وکار (مسیر Push حفظ شده)
 *   - تماس از آگهی: خریدارِ فعال با مسئولِ منتسب → شمارهٔ همان عضوِ فروش (resolveCallRoute)
 *
 *   همهٔ تغییرها: تاریخ دقیق + عامل + رویداد CatalogTeamEvent — برای شکایت‌ها.
 */
@Injectable()
export class CatalogMemberService {
    constructor(
        private prisma: PrismaService,
        private cache: CacheHelper,
    ) {}

    // ════════════════════════════════════════════════════════════
    //  تنظیمات ماژول کاتالوگ — ارث از بازار + اورایت اختصاصی کاتالوگ
    //  همهٔ کاتالوگ‌ها «چندفروشندگی» را از config.modules.catalog بازار می‌برند؛
    //  مالک بازار می‌تواند برای کاتالوگ خاصی در config.settings.multiSeller اورایت کند.
    // ════════════════════════════════════════════════════════════
    async getEffectiveCatalogSettings(catalogId: string) {
        const catalog = await this.getCatalogOrThrow(catalogId);
        const memberships = await this.prisma.armMembership.findMany({
            where: { catalogId: catalog.id, status: 'active' },
            orderBy: { joinedAt: 'asc' },
            select: { armId: true },
            take: 20,
        });
        const armId = memberships.find((m) => !!m.armId)?.armId || null;
        let armModule: any = {};
        if (armId) {
            const arm = await this.prisma.arm.findUnique({ where: { id: armId }, select: { config: true } });
            armModule = (arm?.config as any)?.modules?.catalog ?? {};
        }
        const override = (catalog.config as any)?.settings?.multiSeller;
        const multiSeller =
            typeof override === 'boolean'
                ? override
                : typeof armModule.multiSeller === 'boolean'
                    ? armModule.multiSeller
                    : true; // پیش‌فرض: فعال
        return {
            enabled: armModule.enabled !== false,
            freeAdLimit: Number.isFinite(armModule.freeAdLimit) ? Number(armModule.freeAdLimit) : 0,
            multiSeller,
            armId,
            source: typeof override === 'boolean' ? 'catalog' : typeof armModule.multiSeller === 'boolean' ? 'arm' : 'default',
        };
    }

    // ════════════════════════════════════════════════════════════
    //  resolve helpers
    // ════════════════════════════════════════════════════════════

    private async getCatalogOrThrow(catalogId: string) {
        if (!catalogId || !/^[a-f\d]{24}$/i.test(catalogId)) {
            throw new BadRequestException({ errorCode: 'INVALID_CATALOG_ID', message: 'شناسه کاتالوگ نامعتبر است' });
        }
        const catalog = await this.prisma.catalog.findUnique({
            where: { id: catalogId },
            select: {
                id: true, name: true, slug: true, status: true, businessId: true, config: true,
                ownerUserId: true, // ✅ مالکِ مستقیم کاتالوگ
                business: { select: { id: true, name: true, ownerUserId: true, creatorUserId: true, phone: true } },
            },
        });
        if (!catalog || catalog.status === 'closed') {
            throw new NotFoundException({ errorCode: 'CATALOG_NOT_FOUND', message: 'کاتالوگ یافت نشد' });
        }
        return catalog as any;
    }

    /** اونر = مالکِ مستقیمِ کاتالوگ (کاربری که کاتالوگ را ساخته) */
    private isOwner(catalog: any, userId: string): boolean {
        return catalog.ownerUserId === userId;
    }

    /** کاربرِ مسئولِ کسب‌وکار — مالکِ قدیمی یا ثبت‌کنندهٔ اول */
    private responsibleUserId(biz: { ownerUserId?: string | null; creatorUserId?: string | null } | null | undefined): string | null {
        return biz?.ownerUserId || biz?.creatorUserId || null;
    }

    /** «کسب‌وکارِ من» — مسئولِ کسب‌وکار (مالک قدیمی/ثبت‌کننده) یا عضوِ فعالِ تیمِ آن */
    private async isMyBusiness(biz: { id: string; ownerUserId?: string | null; creatorUserId?: string | null } | null, userId: string): Promise<boolean> {
        if (!biz) return false;
        if (this.responsibleUserId(biz) === userId) return true;
        const m = await this.prisma.businessMember.findFirst({
            where: { businessId: biz.id, userId, status: 'active' },
            select: { id: true },
        });
        return !!m;
    }

    private async getMemberRow(catalogId: string, userId: string) {
        return this.prisma.catalogMember.findUnique({
            where: { catalogId_userId: { catalogId, userId } },
        });
    }

    /** رکورد عضو با اعتبارسنجی ObjectId — نامعتبر = 404 (نه 500) */
    private async getMemberById(catalogId: string, memberId: string, include?: any) {
        if (!memberId || !/^[a-f\d]{24}$/i.test(memberId)) {
            throw new NotFoundException({ errorCode: 'MEMBER_NOT_FOUND', message: 'عضو یافت نشد' });
        }
        const row = await this.prisma.catalogMember.findUnique({ where: { id: memberId }, include });
        if (!row || row.catalogId !== catalogId) {
            throw new NotFoundException({ errorCode: 'MEMBER_NOT_FOUND', message: 'عضو یافت نشد' });
        }
        return row;
    }

    private async requireMemberRow(catalogId: string, userId: string) {
        const row = await this.getMemberRow(catalogId, userId);
        if (!row || row.status !== 'active') {
            throw new NotFoundException({ errorCode: 'NOT_TEAM_MEMBER', message: 'شما عضو تیم این کاتالوگ نیستید' });
        }
        return row;
    }

    /** اونر یا ادمینِ فعال — مدیرِ تیم */
    private async assertTeamManager(catalog: any, userId: string) {
        if (this.isOwner(catalog, userId)) return;
        const row = await this.getMemberRow(catalog.id, userId);
        if (row?.status === 'active' && row.role === 'catalog_admin') return;
        throw new ForbiddenException({ errorCode: 'NOT_TEAM_MANAGER', message: 'فقط اونر یا ادمین کاتالوگ به این بخش دسترسی دارد' });
    }

    /** آیا کاربر لِین فروشندهٔ فعال دارد؟ */
    private hasActiveSellerLane(row: any): boolean {
        return row?.status === 'active' && row?.sellerStatus === 'active';
    }

    /** آیا رکورد هنوز لِین فعالی دارد؟ (برای تعیین status کلی) */
    private hasAnyActiveLane(row: any): boolean {
        return (
            row.status === 'active' ||
            row.sellerStatus === 'active' ||
            row.customerStatus === 'active' ||
            row.supplierStatus === 'active'
        );
    }

    private async syncOverallStatus(catalogId: string, userId: string) {
        const row = await this.getMemberRow(catalogId, userId);
        if (!row) return;
        if (!this.hasAnyActiveLane(row)) {
            await this.prisma.catalogMember.update({
                where: { id: row.id },
                data: { status: 'removed', leftAt: new Date() },
            });
        } else if (row.status === 'removed') {
            await this.prisma.catalogMember.update({
                where: { id: row.id },
                data: { status: 'active', leftAt: null },
            });
        }
    }

    private async event(
        catalogId: string,
        userId: string,
        eventType: string,
        actorUserId?: string,
        note?: string,
        data?: any,
    ) {
        await this.prisma.catalogTeamEvent.create({
            data: { catalogId, userId, eventType, actorUserId: actorUserId || null, note, data },
        });
    }

    /** باطل‌سازی کش «کاتالوگ‌های من» برای کاربران متأثر */
    private async bustUsersCache(userIds: (string | null | undefined)[]) {
        const uniq = Array.from(new Set(userIds.filter(Boolean) as string[]));
        for (const uid of uniq) {
            await this.cache.bust(`my-catalogs:${uid}`);
        }
    }

    private memberCard(row: any, armSlugByBiz?: Map<string, string>) {
        const slugFor = (id?: string | null) => (id && armSlugByBiz?.get(id)) || null;
        return {
            id: row.id,
            userId: row.userId,
            fullName: row.user?.fullName || null,
            phone: row.user?.phone || null,
            avatarUrl: row.user?.avatarUrl || null,
            business: row.sellerBusiness
                ? { id: row.sellerBusiness.id, name: row.sellerBusiness.name, phone: row.sellerBusiness.phone, slug: slugFor(row.sellerBusiness.id) }
                : row.customerBusiness
                    ? { id: row.customerBusiness.id, name: row.customerBusiness.name, phone: row.customerBusiness.phone, slug: slugFor(row.customerBusiness.id) }
                    : null,
            role: row.role,
            position: row.position || null,
            sellerStatus: row.sellerStatus || null,
            sellerRole: row.sellerRole || 'seller',
            sellerRegion: row.sellerRegion || null,
            sellerBusiness: row.sellerBusiness
                ? { id: row.sellerBusiness.id, name: row.sellerBusiness.name, phone: row.sellerBusiness.phone, slug: slugFor(row.sellerBusiness.id) }
                : null,
            sellerJoinedAt: row.sellerJoinedAt || null,
            customerStatus: row.customerStatus || null,
            customerBusiness: row.customerBusiness
                ? { id: row.customerBusiness.id, name: row.customerBusiness.name, phone: row.customerBusiness.phone, city: row.customerBusiness.city || null, slug: slugFor(row.customerBusiness.id) }
                : null,
            customerJoinedAt: row.customerJoinedAt || null,
            supplierStatus: row.supplierStatus || null,
            supplierCatalog: row.supplierCatalog
                ? { id: row.supplierCatalog.id, name: row.supplierCatalog.name, slug: row.supplierCatalog.slug, logoUrl: row.supplierCatalog.logoUrl || null }
                : null,
            supplierJoinedAt: row.supplierJoinedAt || null,
            memberCity: row.memberCity || null,
            memberProvince: row.memberProvince || null,
            assignedSellerUserId: row.assignedSellerUserId || null,
            assignedAt: row.assignedAt || null,
            joinedAt: row.joinedAt,
        };
    }

    /** اسلاگ تابلوی کسب‌وکارها (صفحهٔ شخصی عضو) — اولین تابلوی فعال هر کسب‌وکار */
    private async armSlugMap(businessIds: (string | null | undefined)[]): Promise<Map<string, string>> {
        const ids = Array.from(new Set(businessIds.filter(Boolean) as string[]));
        const map = new Map<string, string>();
        if (!ids.length) return map;
        const memberships = await this.prisma.armMembership.findMany({
            where: { businessId: { in: ids }, status: 'active' },
            select: { businessId: true, joinedAt: true, arm: { select: { slug: true } } },
            orderBy: { joinedAt: 'asc' },
        });
        for (const m of memberships) {
            if (m.businessId && m.arm?.slug && !map.has(m.businessId)) map.set(m.businessId, m.arm.slug);
        }
        return map;
    }

    /** کارت‌های «کادر» کاتالوگ: مالک (اگر در هیچ لِین فعالی دیده نمی‌شود) + مدیرهای خالص (بدون لِین) */
    private async buildStaffCards(catalog: any, rows: any[], canManage: boolean, armSlugByBiz?: Map<string, string>) {
        const ownerUserId = catalog.ownerUserId;
        const ownerVisible = rows.some(
            (r) => r.userId === ownerUserId && r.status === 'active' &&
                (r.sellerStatus === 'active' || r.customerStatus === 'active' || r.customerStatus === 'pending' ||
                    r.supplierStatus === 'active' || r.role === 'catalog_admin'),
        );
        const adminRows = rows.filter(
            (r) => r.role === 'catalog_admin' && r.status === 'active' && !r.sellerStatus && !r.customerStatus && !r.supplierStatus,
        );
        const cards: any[] = adminRows.map((r) => ({
            ...this.memberCard(r, armSlugByBiz),
            phone: canManage ? r.user?.phone || null : null,
            isOwner: r.userId === ownerUserId,
            isAdmin: true,
        }));
        if (!ownerVisible) {
            const ownerUser = await this.prisma.user.findUnique({
                where: { id: ownerUserId },
                select: { id: true, fullName: true, phone: true, avatarUrl: true },
            });
            if (ownerUser) {
                cards.unshift({
                    id: `owner-${ownerUserId}`,
                    userId: ownerUserId,
                    fullName: ownerUser.fullName || null,
                    phone: canManage ? ownerUser.phone || null : null,
                    avatarUrl: ownerUser.avatarUrl || null,
                    business: null,
                    role: 'catalog_owner',
                    position: null,
                    sellerStatus: null,
                    sellerRole: null,
                    sellerRegion: null,
                    sellerBusiness: null,
                    sellerJoinedAt: null,
                    customerStatus: null,
                    customerBusiness: null,
                    customerJoinedAt: null,
                    supplierStatus: null,
                    supplierCatalog: null,
                    supplierJoinedAt: null,
                    memberCity: null,
                    memberProvince: null,
                    assignedSellerUserId: null,
                    assignedAt: null,
                    joinedAt: null,
                    isOwner: true,
                    isAdmin: false,
                });
            }
        }
        return cards;
    }

    private readonly MEMBER_INCLUDE = {
        user: { select: { id: true, fullName: true, phone: true, avatarUrl: true, city: true, province: true } },
        sellerBusiness: { select: { id: true, name: true, phone: true, city: true } },
        customerBusiness: { select: { id: true, name: true, phone: true, city: true } },
        supplierCatalog: { select: { id: true, name: true, slug: true, logoUrl: true } },
    } as const;

    // ════════════════════════════════════════════════════════════
    //  نمای تیم
    // ════════════════════════════════════════════════════════════

    async getTeam(catalogId: string, actorId: string) {
        const catalog = await this.getCatalogOrThrow(catalogId);
        const isOwner = this.isOwner(catalog, actorId);
        const myRow = await this.getMemberRow(catalog.id, actorId);
        const isAdmin = myRow?.status === 'active' && myRow.role === 'catalog_admin';
        const isSeller = this.hasActiveSellerLane(myRow);
        const isPendingSeller = myRow?.status === 'active' && myRow.sellerStatus === 'pending';

        const settings = await this.getEffectiveCatalogSettings(catalog.id);
        const ownerUserId = catalog.ownerUserId;

        // ── نمای عمومی (کاربر لاگین‌شدهٔ غیرعضو) — همکاران فروش + تامین‌کننده‌ها، بدون شماره تماس ──
        if (!isOwner && !isAdmin && !isSeller && !isPendingSeller) {
            const publicRows = await this.prisma.catalogMember.findMany({
                where: { catalogId: catalog.id, OR: [{ sellerStatus: 'active' }, { supplierStatus: 'active' }] },
                include: this.MEMBER_INCLUDE,
                orderBy: { createdAt: 'asc' },
            });
            const armSlugs = await this.armSlugMap([
                ...publicRows.flatMap((r) => [r.sellerBusinessId, r.customerBusinessId]),
                catalog.businessId,
            ]);
            const publicSellers = publicRows
                .filter((r) => r.sellerStatus === 'active')
                .map((r) => ({
                    ...this.memberCard(r, armSlugs),
                    phone: null,
                    isOwner: r.userId === ownerUserId,
                    isAdmin: r.role === 'catalog_admin',
                    customersCount: 0,
                }));
            const publicSuppliers = publicRows
                .filter((r) => r.supplierStatus === 'active')
                .map((r) => ({
                    ...this.memberCard(r, armSlugs),
                    phone: null,
                    isOwner: r.userId === ownerUserId,
                    isAdmin: r.role === 'catalog_admin',
                }));
            // کادر (مالک + مدیرهای خالص) — بدون لِین فعال
            const staffRows = await this.prisma.catalogMember.findMany({
                where: { catalogId: catalog.id, role: 'catalog_admin', status: 'active' },
                include: this.MEMBER_INCLUDE,
            });
            const staff = (await this.buildStaffCards(catalog, [...publicRows, ...staffRows], false, armSlugs))
                .map((c) => ({ ...c, phone: null }));
            return {
                catalog: {
                    id: catalog.id,
                    name: catalog.name,
                    slug: catalog.slug,
                    businessId: catalog.business.id,
                    businessName: catalog.business.name,
                    ownerUserId,
                },
                myRole: {
                    isOwner: false,
                    isAdmin: false,
                    isSeller: false,
                    isPendingSeller: false,
                    canManage: false,
                    userId: actorId,
                    memberId: null,
                    sellerRegion: null,
                    position: null,
                },
                staff,
                sellers: publicSellers,
                suppliers: publicSuppliers,
                pendingRequests: [],
                customers: [],
                events: [],
                stats: { sellers: publicSellers.length, suppliers: publicSuppliers.length, pendingRequests: 0, customers: 0 },
                settings,
            };
        }

        const canManage = isOwner || isAdmin;

        const rows = await this.prisma.catalogMember.findMany({
            where: {
                catalogId: catalog.id,
                OR: [
                    { sellerStatus: { in: ['active', 'pending'] } },
                    { customerStatus: { in: ['active', 'pending'] } },
                    { supplierStatus: { in: ['active', 'pending'] } },
                    { role: 'catalog_admin', status: 'active' },
                ],
            },
            include: this.MEMBER_INCLUDE,
            orderBy: { createdAt: 'asc' },
        });

        // اسلاگ تابلوی کسب‌وکارها — برای لینک به صفحهٔ شخصی هر عضو
        const armSlugs = await this.armSlugMap([
            ...rows.flatMap((r) => [r.sellerBusinessId, r.customerBusinessId]),
            catalog.businessId,
        ]);

        // شمارش خریدارهای هر عضوِ فروش
        const customerCounts = new Map<string, number>();
        for (const r of rows) {
            if (r.customerStatus === 'active' && r.assignedSellerUserId) {
                customerCounts.set(r.assignedSellerUserId, (customerCounts.get(r.assignedSellerUserId) || 0) + 1);
            }
        }

        const sellers = rows
            .filter((r) => r.sellerStatus === 'active')
            .map((r) => ({
                ...this.memberCard(r, armSlugs),
                isOwner: r.userId === ownerUserId,
                isAdmin: r.role === 'catalog_admin',
                customersCount: customerCounts.get(r.userId) || 0,
            }));

        const suppliers = rows
            .filter((r) => r.supplierStatus === 'active')
            .map((r) => ({
                ...this.memberCard(r, armSlugs),
                isOwner: r.userId === ownerUserId,
                isAdmin: r.role === 'catalog_admin',
            }));

        // درخواست‌های همکاریِ در انتظار تایید مدیر — تایپ‌دار برای UI
        const pendingRequests = canManage
            ? rows
                  .filter((r) => r.sellerStatus === 'pending' || r.customerStatus === 'pending' || r.supplierStatus === 'pending')
                  .map((r) => {
                      const card = this.memberCard(r, armSlugs);
                      if (r.sellerStatus === 'pending') {
                          return { ...card, requestType: 'seller' as const, pendingGate: 'manager' as const, note: null };
                      }
                      if (r.supplierStatus === 'pending') {
                          return { ...card, requestType: 'supplier' as const, pendingGate: 'manager' as const, note: null };
                      }
                      // لِین خریدار — دو مسیر: درخواستِ خودِ خریدار (تایید با مدیر) یا ثبتِ توسط فروشنده (تایید با صاحبِ کسب‌وکار)
                      return {
                          ...card,
                          requestType: 'buyer' as const,
                          pendingGate: (r.customerVia === 'self_request' ? 'manager' : 'business_owner') as 'manager' | 'business_owner',
                          note: null,
                      };
                  })
            : [];

        let customers = rows
            .filter((r) => r.customerStatus === 'active' || r.customerStatus === 'pending')
            .map((r) => ({
                ...this.memberCard(r, armSlugs),
                sellerName: null as string | null,
                isOwner: r.userId === ownerUserId,
                isAdmin: r.role === 'catalog_admin',
            }));

        // نام مسئولِ منتسب — با یک کوئری دیگر
        const sellerUserIds = Array.from(new Set(customers.map((c) => c.assignedSellerUserId).filter(Boolean))) as string[];
        let sellerNameMap = new Map<string, { fullName: string | null; businessName: string | null }>();
        if (sellerUserIds.length) {
            const sellerRows = await this.prisma.catalogMember.findMany({
                where: { catalogId: catalog.id, userId: { in: sellerUserIds }, sellerStatus: 'active' },
                select: { userId: true, user: { select: { fullName: true } }, sellerBusiness: { select: { name: true } } },
            });
            sellerNameMap = new Map(
                sellerRows.map((s) => [s.userId, { fullName: s.user?.fullName || null, businessName: s.sellerBusiness?.name || null }]),
            );
        }
        customers = customers.map((c) => {
            const s = c.assignedSellerUserId ? sellerNameMap.get(c.assignedSellerUserId) : null;
            return { ...c, sellerName: s ? (s.fullName || s.businessName) : null };
        });

        // عضوِ فروش فقط خریدارهای خودش را می‌بیند
        const scopedCustomers = canManage ? customers : customers.filter((c) => c.assignedSellerUserId === actorId);
        const scopedSellers = canManage
            ? sellers
            : sellers.filter((s) => s.userId === actorId).map((s) => ({ ...s, phone: s.phone }));

        const events = canManage
            ? await this.prisma.catalogTeamEvent.findMany({
                  where: { catalogId: catalog.id },
                  orderBy: { createdAt: 'desc' },
                  take: 30,
                  select: {
                      id: true, userId: true, eventType: true, actorUserId: true, note: true, data: true, createdAt: true,
                      user: { select: { fullName: true } },
                  },
              })
            : [];

        // کادر: مالک (اگر در لیست‌های بالا دیده نمی‌شود) + مدیرهای خالص
        const staff = await this.buildStaffCards(catalog, rows, canManage, armSlugs);

        return {
            catalog: {
                id: catalog.id,
                name: catalog.name,
                slug: catalog.slug,
                businessId: catalog.business.id,
                businessName: catalog.business.name,
                ownerUserId,
            },
            myRole: {
                isOwner,
                isAdmin,
                isSeller,
                isPendingSeller,
                canManage,
                userId: actorId,
                memberId: myRow?.id || null,
                sellerRegion: myRow?.sellerRegion || null,
                position: myRow?.position || null,
            },
            staff,
            sellers: scopedSellers,
            suppliers,
            pendingRequests,
            customers: scopedCustomers,
            events,
            stats: {
                sellers: sellers.length,
                suppliers: suppliers.length,
                pendingRequests: canManage ? pendingRequests.length : undefined,
                activeCustomers: customers.filter((c) => c.customerStatus === 'active').length,
                pendingCustomers: customers.filter((c) => c.customerStatus === 'pending').length,
            },
            settings,
        };
    }

    /** وضعیت من در تیم این کاتالوگ — برای UI */
    async getMyMembership(catalogId: string, userId: string) {
        const catalog = await this.getCatalogOrThrow(catalogId);
        const row = await this.getMemberRow(catalog.id, userId);
        return {
            isOwner: this.isOwner(catalog, userId),
            member: row ? this.memberCard(row) : null,
        };
    }

    /** همهٔ عضویت‌های من در سراسر کاتالوگ‌ها — پروفایل و سوییچر */
    async getMyMemberships(userId: string) {
        const rows = await this.prisma.catalogMember.findMany({
            where: {
                userId,
                status: 'active',
                OR: [
                    { sellerStatus: { in: ['active', 'pending'] } },
                    { customerStatus: { in: ['active', 'pending'] } },
                    { supplierStatus: { in: ['active', 'pending'] } },
                    { role: 'catalog_admin' },
                ],
            },
            include: {
                ...this.MEMBER_INCLUDE,
                catalog: { select: { id: true, name: true, slug: true, logoUrl: true, status: true } },
            },
            orderBy: { createdAt: 'desc' },
        });

        // نام/شمارهٔ مسئولِ منتسب برای لِین خریدار
        const sellerUserIds = Array.from(new Set(rows.map((r) => r.assignedSellerUserId).filter(Boolean))) as string[];
        const sellerMap = new Map<string, { fullName: string | null; phone: string | null; businessName: string | null }>();
        if (sellerUserIds.length) {
            const catalogIds = Array.from(new Set(rows.filter((r) => r.assignedSellerUserId).map((r) => r.catalogId)));
            const sellerRows = await this.prisma.catalogMember.findMany({
                where: { catalogId: { in: catalogIds }, userId: { in: sellerUserIds }, sellerStatus: 'active' },
                select: {
                    catalogId: true, userId: true,
                    user: { select: { fullName: true, phone: true } },
                    sellerBusiness: { select: { name: true, phone: true } },
                },
            });
            for (const s of sellerRows) {
                sellerMap.set(`${s.catalogId}:${s.userId}`, {
                    fullName: s.user?.fullName || null,
                    phone: s.sellerBusiness?.phone || s.user?.phone || null,
                    businessName: s.sellerBusiness?.name || null,
                });
            }
        }

        return rows.map((r) => {
            const seller = r.assignedSellerUserId ? sellerMap.get(`${r.catalogId}:${r.assignedSellerUserId}`) : null;
            return {
                id: r.id,
                catalog: r.catalog,
                role: r.role,
                position: r.position || null,
                sellerStatus: r.sellerStatus || null,
                sellerRegion: r.sellerRegion || null,
                sellerBusinessName: r.sellerBusiness?.name || null,
                sellerJoinedAt: r.sellerJoinedAt || null,
                customerStatus: r.customerStatus || null,
                customerBusinessName: r.customerBusiness?.name || null,
                customerJoinedAt: r.customerJoinedAt || null,
                supplierStatus: r.supplierStatus || null,
                supplierCatalogName: r.supplierCatalog?.name || null,
                supplierJoinedAt: r.supplierJoinedAt || null,
                assignedSeller: seller
                    ? { userId: r.assignedSellerUserId, fullName: seller.fullName, businessName: seller.businessName, phone: seller.phone }
                    : null,
            };
        });
    }

    // ════════════════════════════════════════════════════════════
    //  درخواست ارتباط تجاری — یک در برای هر سه نقش بیزینسی (فروش/خرید/تامین)
    // ════════════════════════════════════════════════════════════

    /**
     * درخواست ارتباط تجاری با کاتالوگ — کاربر روی کاتالوگ دکمهٔ «درخواست ارتباط تجاری» را می‌زند:
     *   type=seller   → همکار فروش (فروشنده/ویزیتور — برچسب ترجیحی؛ کسب‌وکار اختیاری)
     *   type=buyer    → خریدار (الزامی: انتخاب کسب‌وکار)
     *   type=supplier → تامین‌کننده (الزامی: انتخاب کاتالوگِ خودش)
     * همهٔ درخواست‌ها pending می‌مانند تا تایید مدیر (مالک کاتالوگ).
     * شهر/استانِ لحظهٔ درخواست روی رکورد اسنپ‌شات می‌شود تا مالک ببیند.
     */
    async joinCoop(
        catalogId: string,
        userId: string,
        dto: { type: 'seller' | 'buyer' | 'supplier'; sellerRole?: 'seller' | 'visitor'; businessId?: string; supplierCatalogId?: string; note?: string },
    ) {
        const catalog = await this.getCatalogOrThrow(catalogId);
        if (this.isOwner(catalog, userId)) {
            throw new ConflictException({ errorCode: 'IS_CATALOG_OWNER', message: 'مالک کاتالوگ به‌طور پیش‌فرض عضو است — نیازی به درخواست ارتباط تجاری نیست' });
        }

        const type = dto?.type;
        if (!['seller', 'buyer', 'supplier'].includes(type)) {
            throw new BadRequestException({ errorCode: 'INVALID_TYPE', message: 'نوع همکاری نامعتبر است' });
        }

        // شهر/استان — از کسب‌وکار/کاتالوگ انتخابی، وگرنه از پروفایل کاربر
        const me = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, city: true, province: true },
        });
        let memberCity = me?.city || null;
        let memberProvince = me?.province || null;

        const existing = await this.getMemberRow(catalog.id, userId);
        const laneTaken =
            (type === 'seller' && (existing?.sellerStatus === 'active' || existing?.sellerStatus === 'pending')) ||
            (type === 'buyer' && (existing?.customerStatus === 'active' || existing?.customerStatus === 'pending')) ||
            (type === 'supplier' && (existing?.supplierStatus === 'active' || existing?.supplierStatus === 'pending'));
        if (laneTaken) {
            throw new ConflictException({ errorCode: 'ALREADY_REQUESTED', message: 'درخواست ارتباط تجاری شما قبلاً ثبت شده است' });
        }

        const data: any = {
            status: 'active' as const,
            leftAt: null as Date | null,
            memberCity,
            memberProvince,
        };

        if (type === 'seller') {
            // گیتِ چندفروشندگی — از تنظیمات بازار (با اورایت اختصاصی کاتالوگ)
            const settings = await this.getEffectiveCatalogSettings(catalog.id);
            if (!settings.multiSeller) {
                throw new ForbiddenException({
                    errorCode: 'MULTI_SELLER_DISABLED',
                    message: 'همکاری در فروش برای این کاتالوگ فعال نیست — فقط مالک کاتالوگ فروشنده است',
                });
            }
            // کسب‌وکار اختیاری برای همکار فروش — اگر داد باید عضو/مسئولِ آن باشد (کسب‌وکار مرجع مشترک است)
            let businessId: string | null = null;
            if (dto.businessId) {
                const biz = await this.prisma.business.findUnique({
                    where: { id: dto.businessId },
                    select: { id: true, ownerUserId: true, creatorUserId: true, status: true, city: true, province: true },
                });
                if (!biz || biz.status !== 'active' || !(await this.isMyBusiness(biz, userId))) {
                    throw new BadRequestException({ errorCode: 'INVALID_BUSINESS', message: 'کسب‌وکار انتخابی معتبر نیست' });
                }
                businessId = biz.id;
                memberCity = biz.city || memberCity;
                memberProvince = biz.province || memberProvince;
            }
            Object.assign(data, {
                sellerBusinessId: businessId,
                sellerStatus: 'pending' as const,
                sellerRole: (dto.sellerRole === 'visitor' ? 'visitor' : 'seller') as string,
                sellerJoinedAt: null as Date | null,
                sellerLeftAt: null as Date | null,
                memberCity,
                memberProvince,
            });
        } else if (type === 'buyer') {
            if (!dto.businessId) {
                throw new BadRequestException({ errorCode: 'BUSINESS_REQUIRED', message: 'برای درخواست ارتباط تجاری به‌عنوان خریدار، ابتدا کسب‌وکار خود را انتخاب یا بسازید' });
            }
            const biz = await this.prisma.business.findUnique({
                where: { id: dto.businessId },
                select: { id: true, ownerUserId: true, creatorUserId: true, status: true, city: true, province: true },
            });
            if (!biz || biz.status !== 'active' || !(await this.isMyBusiness(biz, userId))) {
                throw new BadRequestException({ errorCode: 'INVALID_BUSINESS', message: 'کسب‌وکار انتخابی معتبر نیست' });
            }
            if (biz.id === catalog.businessId) {
                throw new BadRequestException({ errorCode: 'OWN_CATALOG_BUSINESS', message: 'این کسب‌وکار مالِ همین کاتالوگ است' });
            }
            // این کسب‌وکار از قبل خریدار همین کاتالوگ نباشد (حتی از رکورد کاربر دیگری)
            const dup = await this.prisma.catalogMember.findFirst({
                where: { catalogId: catalog.id, customerBusinessId: biz.id, customerStatus: { in: ['active', 'pending'] } },
            });
            if (dup) {
                throw new ConflictException({ errorCode: 'ALREADY_CUSTOMER', message: 'این کسب‌وکار قبلاً به‌عنوان خریدار ثبت شده است' });
            }
            memberCity = biz.city || memberCity;
            memberProvince = biz.province || memberProvince;
            Object.assign(data, {
                customerBusinessId: biz.id,
                customerStatus: 'pending' as const,
                customerVia: 'self_request' as const,
                customerJoinedAt: null as Date | null,
                customerLeftAt: null as Date | null,
                memberCity,
                memberProvince,
            });
        } else {
            if (!dto.supplierCatalogId) {
                throw new BadRequestException({ errorCode: 'SUPPLIER_CATALOG_REQUIRED', message: 'برای درخواست ارتباط تجاری به‌عنوان تامین‌کننده، ابتدا کاتالوگ خود را انتخاب یا بسازید' });
            }
            const supCatalog = await this.prisma.catalog.findUnique({
                where: { id: dto.supplierCatalogId },
                select: { id: true, businessId: true, status: true, city: true, province: true, ownerUserId: true },
            });
            if (!supCatalog || supCatalog.status === 'closed' || supCatalog.ownerUserId !== userId) {
                throw new BadRequestException({ errorCode: 'INVALID_SUPPLIER_CATALOG', message: 'کاتالوگ انتخابی معتبر نیست' });
            }
            if (supCatalog.id === catalog.id) {
                throw new BadRequestException({ errorCode: 'SELF_SUPPLIER', message: 'کاتالوگ نمی‌تواند تامین‌کنندهٔ خودش باشد' });
            }
            memberCity = supCatalog.city || memberCity;
            memberProvince = supCatalog.province || memberProvince;
            Object.assign(data, {
                supplierCatalogId: supCatalog.id,
                supplierStatus: 'pending' as const,
                supplierJoinedAt: null as Date | null,
                supplierLeftAt: null as Date | null,
                memberCity,
                memberProvince,
            });
        }

        if (existing) {
            await this.prisma.catalogMember.update({ where: { id: existing.id }, data });
        } else {
            await this.prisma.catalogMember.create({ data: { catalogId: catalog.id, userId, ...data } });
        }

        await this.event(catalog.id, userId, 'coop_requested', userId, dto?.note || null, { type });
        await this.bustUsersCache([userId]);
        const label = type === 'seller' ? 'همکاری در فروش' : type === 'buyer' ? 'خریدار' : 'تامین‌کننده';
        return { success: true, requestType: type, message: `درخواست ارتباط تجاری (${label}) ثبت شد — در انتظار تایید مدیر (مالک کاتالوگ)` };
    }

    /** تایید درخواست همکار فروش — مالک/مدیر؛ نقش بیزینسی (فروشنده/ویزیتور) اینجا تعیین می‌شود */
    async approveSeller(catalogId: string, memberId: string, actorId: string, sellerRole?: 'seller' | 'visitor') {
        const catalog = await this.getCatalogOrThrow(catalogId);
        await this.assertTeamManager(catalog, actorId);
        const row = await this.getMemberById(catalog.id, memberId, { user: { select: { id: true, fullName: true } } });
        if (row.sellerStatus !== 'pending') {
            throw new ConflictException({ errorCode: 'NOT_PENDING', message: 'این درخواست در انتظار تایید نیست' });
        }
        await this.prisma.catalogMember.update({
            where: { id: row.id },
            data: {
                sellerStatus: 'active',
                sellerJoinedAt: new Date(),
                sellerLeftAt: null,
                sellerRole: sellerRole || row.sellerRole || 'seller',
            },
        });
        await this.event(catalog.id, row.userId, 'seller_approved', actorId, sellerRole ? (sellerRole === 'visitor' ? 'ویزیتور' : 'فروشنده') : undefined);
        await this.bustUsersCache([row.userId, actorId]);
        return { success: true, message: 'به اعضا اضافه شد' };
    }

    /** رد درخواست ارتباط تجاری (هر نقش) — مالک/مدیر */
    async rejectSeller(catalogId: string, memberId: string, actorId: string, reason?: string) {
        const catalog = await this.getCatalogOrThrow(catalogId);
        await this.assertTeamManager(catalog, actorId);
        const row = await this.getMemberById(catalog.id, memberId);
        if (row.sellerStatus !== 'pending') {
            throw new ConflictException({ errorCode: 'NOT_PENDING', message: 'این درخواست در انتظار تایید نیست' });
        }
        await this.prisma.catalogMember.update({
            where: { id: row.id },
            data: { sellerStatus: 'removed', sellerLeftAt: new Date() },
        });
        await this.syncOverallStatus(catalog.id, row.userId);
        await this.event(catalog.id, row.userId, 'seller_rejected', actorId, reason || null);
        await this.bustUsersCache([row.userId, actorId]);
        return { success: true, message: 'درخواست ارتباط تجاری رد شد' };
    }

    /** تایید درخواست ارتباط تجاریِ خریدار — مالک/مدیر؛ با انتساب اختیاری به عضوِ فروش */
    async approveBuyer(catalogId: string, memberId: string, actorId: string, sellerUserId?: string) {
        const catalog = await this.getCatalogOrThrow(catalogId);
        await this.assertTeamManager(catalog, actorId);
        const row = await this.getMemberById(catalog.id, memberId, { customerBusiness: { select: { id: true, name: true } } });
        if (row.customerStatus !== 'pending' || row.customerVia !== 'self_request') {
            throw new ConflictException({ errorCode: 'NOT_PENDING', message: 'این درخواست در انتظار تایید مدیر نیست' });
        }
        let assignedSellerUserId = row.assignedSellerUserId || null;
        if (sellerUserId) {
            const sellerRow = await this.getMemberRow(catalog.id, sellerUserId);
            if (!this.hasActiveSellerLane(sellerRow)) {
                throw new BadRequestException({ errorCode: 'INVALID_SELLER', message: 'مسئول فروشِ انتخابی فعال نیست' });
            }
            assignedSellerUserId = sellerUserId;
        }
        await this.prisma.catalogMember.update({
            where: { id: row.id },
            data: {
                customerStatus: 'active',
                customerJoinedAt: new Date(),
                customerLeftAt: null,
                assignedSellerUserId,
                assignedAt: assignedSellerUserId ? new Date() : null,
            },
        });
        await this.event(catalog.id, row.userId, 'buyer_approved', actorId, null, {
            businessId: (row.customerBusiness as any)?.id,
            assignedSellerUserId,
        });
        await this.bustUsersCache([row.userId, actorId]);
        return { success: true, message: 'به اعضا اضافه شد' };
    }

    /** رد درخواست ارتباط تجاریِ خریدار — مالک/مدیر */
    async rejectBuyer(catalogId: string, memberId: string, actorId: string, reason?: string) {
        const catalog = await this.getCatalogOrThrow(catalogId);
        await this.assertTeamManager(catalog, actorId);
        const row = await this.getMemberById(catalog.id, memberId);
        if (row.customerStatus !== 'pending' || row.customerVia !== 'self_request') {
            throw new ConflictException({ errorCode: 'NOT_PENDING', message: 'این درخواست در انتظار تایید مدیر نیست' });
        }
        await this.prisma.catalogMember.update({
            where: { id: row.id },
            data: { customerStatus: 'removed', customerLeftAt: new Date(), assignedSellerUserId: null, assignedAt: null },
        });
        await this.syncOverallStatus(catalog.id, row.userId);
        await this.event(catalog.id, row.userId, 'buyer_rejected', actorId, reason || null);
        await this.bustUsersCache([row.userId, actorId]);
        return { success: true, message: 'درخواست ارتباط تجاری رد شد' };
    }

    /** تایید درخواست تامین‌کننده — مالک/مدیر */
    async approveSupplier(catalogId: string, memberId: string, actorId: string) {
        const catalog = await this.getCatalogOrThrow(catalogId);
        await this.assertTeamManager(catalog, actorId);
        const row = await this.getMemberById(catalog.id, memberId, { supplierCatalog: { select: { id: true, name: true } } });
        if (row.supplierStatus !== 'pending') {
            throw new ConflictException({ errorCode: 'NOT_PENDING', message: 'این درخواست در انتظار تایید نیست' });
        }
        await this.prisma.catalogMember.update({
            where: { id: row.id },
            data: { supplierStatus: 'active', supplierJoinedAt: new Date(), supplierLeftAt: null },
        });
        await this.event(catalog.id, row.userId, 'supplier_approved', actorId, null, {
            supplierCatalogId: (row.supplierCatalog as any)?.id,
        });
        await this.bustUsersCache([row.userId, actorId]);
        return { success: true, message: 'به اعضا اضافه شد' };
    }

    /** رد درخواست تامین‌کننده — مالک/مدیر */
    async rejectSupplier(catalogId: string, memberId: string, actorId: string, reason?: string) {
        const catalog = await this.getCatalogOrThrow(catalogId);
        await this.assertTeamManager(catalog, actorId);
        const row = await this.getMemberById(catalog.id, memberId);
        if (row.supplierStatus !== 'pending') {
            throw new ConflictException({ errorCode: 'NOT_PENDING', message: 'این درخواست در انتظار تایید نیست' });
        }
        await this.prisma.catalogMember.update({
            where: { id: row.id },
            data: { supplierStatus: 'removed', supplierLeftAt: new Date() },
        });
        await this.syncOverallStatus(catalog.id, row.userId);
        await this.event(catalog.id, row.userId, 'supplier_rejected', actorId, reason || null);
        await this.bustUsersCache([row.userId, actorId]);
        return { success: true, message: 'درخواست ارتباط تجاری رد شد' };
    }

    /** حذف تامین‌کنندهٔ فعال — مالک/مدیر */
    async removeSupplier(catalogId: string, memberId: string, actorId: string, note?: string) {
        const catalog = await this.getCatalogOrThrow(catalogId);
        await this.assertTeamManager(catalog, actorId);
        const row = await this.getMemberById(catalog.id, memberId);
        if (row.userId === catalog.ownerUserId) {
            throw new BadRequestException({ errorCode: 'CANNOT_REMOVE_OWNER', message: 'مالک کاتالوگ قابل حذف نیست' });
        }
        if (row.supplierStatus !== 'active') {
            throw new ConflictException({ errorCode: 'NOT_ACTIVE_SUPPLIER', message: 'این عضو تامین‌کنندهٔ فعال نیست' });
        }
        await this.prisma.catalogMember.update({
            where: { id: row.id },
            data: { supplierStatus: 'removed', supplierLeftAt: new Date() },
        });
        await this.syncOverallStatus(catalog.id, row.userId);
        await this.event(catalog.id, row.userId, 'supplier_removed', actorId, note || null);
        await this.bustUsersCache([row.userId, actorId]);
        return { success: true, message: 'از اعضا حذف شد' };
    }

    /** حذف عضوِ فروش — اونر/مدیر؛ مشتری‌هایش بی‌مسئول می‌شوند */
    async removeSeller(catalogId: string, memberId: string, actorId: string, note?: string) {
        const catalog = await this.getCatalogOrThrow(catalogId);
        await this.assertTeamManager(catalog, actorId);
        const row = await this.getMemberById(catalog.id, memberId);
        if (row.userId === catalog.ownerUserId) {
            throw new BadRequestException({ errorCode: 'CANNOT_REMOVE_OWNER', message: 'اونر کاتالوگ قابل حذف نیست' });
        }
        if (row.role === 'catalog_admin') {
            throw new BadRequestException({ errorCode: 'IS_ADMIN', message: 'ابتدا نقش ادمین این عضو را بگیرید' });
        }
        if (this.hasActiveSellerLane(row)) {
            await this.unassignCustomersOf(catalog.id, row.userId, actorId, 'عضوِ فروش از کاتالوگ حذف شد');
            await this.prisma.catalogMember.update({
                where: { id: row.id },
                data: { sellerStatus: 'removed', sellerLeftAt: new Date() },
            });
            await this.syncOverallStatus(catalog.id, row.userId);
            await this.event(catalog.id, row.userId, 'seller_removed', actorId, note || null);
            await this.bustUsersCache([row.userId, actorId]);
        }
        return { success: true, message: 'از اعضا حذف شد' };
    }

    /** خروج خودِ عضوِ فروش از کاتالوگ */
    async leaveAsSeller(catalogId: string, userId: string) {
        const catalog = await this.getCatalogOrThrow(catalogId);
        const row = await this.requireMemberRow(catalog.id, userId);
        if (this.isOwner(catalog, userId)) {
            throw new BadRequestException({ errorCode: 'OWNER_CANNOT_LEAVE', message: 'اونر کاتالوگ نمی‌تواند فروشندگی خودش را ترک کند' });
        }
        if (!this.hasActiveSellerLane(row)) {
            throw new ConflictException({ errorCode: 'NOT_ACTIVE_SELLER', message: 'شما عضوِ فروشِ فعال این کاتالوگ نیستید' });
        }
        await this.unassignCustomersOf(catalog.id, userId, userId, 'عضوِ فروش خودش از کاتالوگ خارج شد');
        await this.prisma.catalogMember.update({
            where: { id: row.id },
            data: { sellerStatus: 'removed', sellerLeftAt: new Date() },
        });
        await this.syncOverallStatus(catalog.id, userId);
        await this.event(catalog.id, userId, 'seller_left', userId);
        await this.bustUsersCache([userId]);
        return { success: true, message: 'شما از اعضای فروش این کاتالوگ خارج شدید' };
    }

    /** منطقهٔ فروش عضوِ فروش — اونر/مدیر یا خودِ عضو */
    async setSellerRegion(catalogId: string, memberId: string, region: string | undefined, actorId: string) {
        const catalog = await this.getCatalogOrThrow(catalogId);
        const row = await this.getMemberById(catalog.id, memberId);
        if (row.userId !== actorId) await this.assertTeamManager(catalog, actorId);
        if (row.sellerStatus !== 'active') {
            throw new ConflictException({ errorCode: 'NOT_ACTIVE_SELLER', message: 'این عضو فروشندهٔ فعال نیست' });
        }
        await this.prisma.catalogMember.update({ where: { id: row.id }, data: { sellerRegion: region?.trim() || null } });
        await this.event(catalog.id, row.userId, 'region_set', actorId, region?.trim() || null);
        await this.bustUsersCache([row.userId]);
        return { success: true, message: 'منطقهٔ فروش ثبت شد' };
    }

    /** تغییر نقش بیزینسی عضوِ فروش (فروشنده ↔ ویزیتور) — اونر/مدیر */
    async setSellerRole(catalogId: string, memberId: string, sellerRole: 'seller' | 'visitor', actorId: string) {
        const catalog = await this.getCatalogOrThrow(catalogId);
        await this.assertTeamManager(catalog, actorId);
        const row = await this.getMemberById(catalog.id, memberId);
        if (row.sellerStatus !== 'active') {
            throw new ConflictException({ errorCode: 'NOT_ACTIVE_SELLER', message: 'این عضو در لِین فروش فعال نیست' });
        }
        const nextRole = sellerRole === 'visitor' ? 'visitor' : 'seller';
        if ((row.sellerRole || 'seller') === nextRole) {
            return { success: true, sellerRole: nextRole, message: 'نقش بیزینسی از قبل همین بود' };
        }
        await this.prisma.catalogMember.update({ where: { id: row.id }, data: { sellerRole: nextRole } });
        await this.event(catalog.id, row.userId, 'seller_role_changed', actorId, nextRole === 'visitor' ? 'ویزیتور' : 'فروشنده');
        await this.bustUsersCache([row.userId, actorId]);
        return { success: true, sellerRole: nextRole, message: nextRole === 'visitor' ? 'نقش بیزینسی به «ویزیتور» تغییر کرد' : 'نقش بیزینسی به «فروشنده» تغییر کرد' };
    }

    /** مشتری‌های یک عضوِ فروش را بی‌مسئول می‌کند (با رویداد برای هر مشتری) */
    private async unassignCustomersOf(catalogId: string, sellerUserId: string, actorId: string, note: string) {
        const affected = await this.prisma.catalogMember.findMany({
            where: { catalogId, assignedSellerUserId: sellerUserId, customerStatus: 'active' },
            select: { id: true, userId: true },
        });
        if (!affected.length) return 0;
        await this.prisma.catalogMember.updateMany({
            where: { id: { in: affected.map((a) => a.id) } },
            data: { assignedSellerUserId: null, assignedAt: null },
        });
        for (const a of affected) {
            await this.event(catalogId, a.userId, 'customer_unassigned', actorId, note);
        }
        return affected.length;
    }

    // ════════════════════════════════════════════════════════════
    //  نقش ادمین کاتالوگ (سیستمی)
    // ════════════════════════════════════════════════════════════

    /** ارتقای عضو به ادمین کاتالوگ — فقط اونر */
    async promoteToAdmin(catalogId: string, memberId: string, actorId: string) {
        const catalog = await this.getCatalogOrThrow(catalogId);
        if (!this.isOwner(catalog, actorId)) {
            throw new ForbiddenException({ errorCode: 'ONLY_OWNER', message: 'فقط اونر کاتالوگ می‌تواند ادمین منصوب کند' });
        }
        const row = await this.getMemberById(catalog.id, memberId);
        if (row.role === 'catalog_owner') throw new BadRequestException({ errorCode: 'IS_OWNER', message: 'این رکورد مال اونر کاتالوگ است' });
        if (row.status !== 'active') throw new ConflictException({ errorCode: 'NOT_ACTIVE', message: 'عضو فعال نیست' });
        if (row.role === 'catalog_admin') throw new ConflictException({ errorCode: 'ALREADY_ADMIN', message: 'این عضو قبلاً ادمین شده است' });

        await this.prisma.catalogMember.update({ where: { id: row.id }, data: { role: 'catalog_admin' } });
        await this.event(catalog.id, row.userId, 'admin_promoted', actorId);
        await this.bustUsersCache([row.userId, actorId]);
        return { success: true, message: 'عضو به ادمین کاتالوگ ارتقا یافت' };
    }

    /** گرفتن نقش ادمین — فقط اونر */
    async demoteToMember(catalogId: string, memberId: string, actorId: string) {
        const catalog = await this.getCatalogOrThrow(catalogId);
        if (!this.isOwner(catalog, actorId)) {
            throw new ForbiddenException({ errorCode: 'ONLY_OWNER', message: 'فقط اونر کاتالوگ می‌تواند نقش ادمین را بگیرد' });
        }
        const row = await this.getMemberById(catalog.id, memberId);
        if (row.role !== 'catalog_admin') throw new ConflictException({ errorCode: 'NOT_ADMIN', message: 'این عضو ادمین نیست' });

        await this.prisma.catalogMember.update({ where: { id: row.id }, data: { role: 'catalog_member' } });
        await this.event(catalog.id, row.userId, 'admin_demoted', actorId);
        await this.bustUsersCache([row.userId, actorId]);
        return { success: true, message: 'نقش ادمین این عضو گرفته شد' };
    }

    // ════════════════════════════════════════════════════════════
    //  لِین خریدار (ثبت توسط مسئول فروش — مسیر Push)
    // ════════════════════════════════════════════════════════════

    /** جست‌وجوی کسب‌وکار برای افزودن مشتری — اونر/ادمین/فروشندهٔ فعال */
    async customerCandidates(catalogId: string, actorId: string, q?: string) {
        const catalog = await this.getCatalogOrThrow(catalogId);
        const myRow = await this.getMemberRow(catalog.id, actorId);
        const canManage = this.isOwner(catalog, actorId) || myRow?.status === 'active' && myRow.role === 'catalog_admin';
        if (!canManage && !this.hasActiveSellerLane(myRow)) {
            throw new ForbiddenException({ errorCode: 'NOT_TEAM_MEMBER', message: 'برای ثبت مشتری باید عضو تیم باشید' });
        }

        // کسانی که قبلاً مشتری/فروشندهٔ این کاتالوگ هستند — خارج از پیشنهادها
        const existing = await this.prisma.catalogMember.findMany({
            where: { catalogId: catalog.id, customerStatus: { in: ['active', 'pending'] } },
            select: { customerBusinessId: true },
        });
        const takenBizIds = Array.from(new Set(existing.map((e) => e.customerBusinessId).filter(Boolean))) as string[];

        const term = (q || '').trim();
        if (term.length < 2) return { items: [] };

        const items = await this.prisma.business.findMany({
            where: {
                status: 'active',
                id: { notIn: [...takenBizIds, catalog.businessId] },
                OR: [
                    { name: { contains: term } },
                    { phone: { contains: term } },
                    { owner: { phone: { contains: term } } },
                ],
            },
            select: {
                id: true, name: true, phone: true, city: true, logoUrl: true,
                owner: { select: { fullName: true, phone: true } },
            },
            take: 8,
            orderBy: { createdAt: 'desc' },
        });
        return { items };
    }

    /**
     * ثبت خریدار در کاتالوگ — توسط مسئول فروش/مدیر/مالک.
     * مشتریِ ثبت‌شده pending است تا صاحب کسب‌وکارش تایید کند.
     */
    async addCustomer(catalogId: string, actorId: string, dto: { businessId: string; sellerUserId?: string; note?: string }) {
        const catalog = await this.getCatalogOrThrow(catalogId);
        const myRow = await this.getMemberRow(catalog.id, actorId);
        const isOwner = this.isOwner(catalog, actorId);
        const isAdmin = myRow?.status === 'active' && myRow.role === 'catalog_admin';
        const isSeller = this.hasActiveSellerLane(myRow);
        if (!isOwner && !isAdmin && !isSeller) {
            throw new ForbiddenException({ errorCode: 'NOT_TEAM_MEMBER', message: 'برای ثبت مشتری باید عضو تیم باشید' });
        }

        const biz = await this.prisma.business.findUnique({
            where: { id: dto.businessId },
            select: { id: true, name: true, ownerUserId: true, creatorUserId: true, status: true },
        });
        if (!biz || biz.status !== 'active') {
            throw new NotFoundException({ errorCode: 'BUSINESS_NOT_FOUND', message: 'کسب‌وکار مشتری یافت نشد' });
        }
        const bizResponsible = this.responsibleUserId(biz);
        if (bizResponsible === actorId) {
            throw new BadRequestException({ errorCode: 'OWN_BUSINESS', message: 'نمی‌توانید کسب‌وکار خودتان را مشتری ثبت کنید' });
        }
        if (bizResponsible && bizResponsible === catalog.ownerUserId) {
            throw new BadRequestException({ errorCode: 'CATALOG_OWNER_BUSINESS', message: 'کسب‌وکارِ مالِ کاتالوگ فروشنده است — مشتری نیست' });
        }

        // انتساب: صریح → خود ثبت‌کننده (اگر فروشنده است) → مالکِ کاتالوگ
        let assignedSellerUserId = dto.sellerUserId || null;
        if (assignedSellerUserId) {
            const sellerRow = await this.getMemberRow(catalog.id, assignedSellerUserId);
            if (!this.hasActiveSellerLane(sellerRow)) {
                throw new BadRequestException({ errorCode: 'INVALID_SELLER', message: 'عضوِ فروشِ انتخابی فعال نیست' });
            }
        } else if (isSeller) {
            assignedSellerUserId = actorId;
        } else {
            assignedSellerUserId = catalog.ownerUserId; // مالکِ کاتالوگ همیشه فروشندهٔ فعال است
        }

        const dup = await this.prisma.catalogMember.findFirst({
            where: { catalogId: catalog.id, customerBusinessId: biz.id, customerStatus: { in: ['active', 'pending'] } },
        });
        if (dup) {
            throw new ConflictException({ errorCode: 'ALREADY_CUSTOMER', message: 'این کسب‌وکار قبلاً به‌عنوان مشتری ثبت شده است' });
        }

        // رکورد کاربرِ مسئولِ کسب‌وکارِ مشتری — ممکن است از قبل (مثلاً به‌عنوان عضوِ فروش) وجود داشته باشد
        if (!bizResponsible) {
            throw new BadRequestException({ errorCode: 'BUSINESS_NO_RESPONSIBLE', message: 'این کسب‌وکار مسئولِ ثبت‌شده‌ای ندارد' });
        }
        const existingRow = await this.getMemberRow(catalog.id, bizResponsible);
        let memberId: string;
        if (existingRow) {
            await this.prisma.catalogMember.update({
                where: { id: existingRow.id },
                data: {
                    customerBusinessId: biz.id,
                    customerStatus: 'pending',
                    customerVia: 'owner_add',
                    customerLeftAt: null,
                    customerAddedByUserId: actorId,
                    assignedSellerUserId,
                    assignedAt: new Date(),
                    status: 'active',
                    leftAt: null,
                },
            });
            memberId = existingRow.id;
        } else {
            const created = await this.prisma.catalogMember.create({
                data: {
                    catalogId: catalog.id,
                    userId: bizResponsible,
                    customerBusinessId: biz.id,
                    customerStatus: 'pending',
                    customerVia: 'owner_add',
                    customerAddedByUserId: actorId,
                    assignedSellerUserId,
                    assignedAt: new Date(),
                },
            });
            memberId = created.id;
        }

        await this.event(catalog.id, bizResponsible, 'customer_added', actorId, dto?.note || null, {
            businessId: biz.id,
            businessName: biz.name,
            assignedSellerUserId,
        });
        await this.bustUsersCache([bizResponsible, actorId]);
        return {
            success: true,
            memberId,
            message: 'مشتری ثبت شد — تا وقتی صاحب کسب‌وکار تایید کند، تماسش مسیریابی نمی‌شود',
        };
    }

    /** تایید مشتری‌بودن — فقط صاحبِ کسب‌وکارِ مشتری */
    async confirmCustomer(catalogId: string, memberId: string, actorId: string) {
        const catalog = await this.getCatalogOrThrow(catalogId);
        const row = await this.getMemberById(catalog.id, memberId, { customerBusiness: { select: { id: true, ownerUserId: true, creatorUserId: true, name: true } } });
        if (row.customerStatus !== 'pending') {
            throw new ConflictException({ errorCode: 'NOT_PENDING', message: 'چیزی برای تایید نیست' });
        }
        if (this.responsibleUserId(row.customerBusiness as any) !== actorId) {
            throw new ForbiddenException({ errorCode: 'NOT_BUSINESS_OWNER', message: 'فقط مسئول کسب‌وکار می‌تواند این ثبت را تایید کند' });
        }
        await this.prisma.catalogMember.update({
            where: { id: row.id },
            data: { customerStatus: 'active', customerJoinedAt: new Date(), customerLeftAt: null },
        });
        await this.event(catalog.id, row.userId, 'customer_confirmed', actorId, null, {
            businessId: (row.customerBusiness as any)?.id,
            assignedSellerUserId: row.assignedSellerUserId,
        });
        await this.bustUsersCache([row.userId, actorId, row.assignedSellerUserId]);
        return { success: true, message: 'عضویت مشتری تایید شد — تماس شما به مسئول فروش خودتان مسیریابی می‌شود' };
    }

    /** ردِ ثبت مشتری — صاحبِ کسب‌وکار (قبل از تایید) */
    async declineCustomer(catalogId: string, memberId: string, actorId: string, reason?: string) {
        const catalog = await this.getCatalogOrThrow(catalogId);
        const row = await this.getMemberById(catalog.id, memberId, { customerBusiness: { select: { ownerUserId: true, creatorUserId: true } } });
        if (row.customerStatus !== 'pending') {
            throw new ConflictException({ errorCode: 'NOT_PENDING', message: 'چیزی برای رد کردن نیست' });
        }
        if (this.responsibleUserId(row.customerBusiness as any) !== actorId) {
            throw new ForbiddenException({ errorCode: 'NOT_BUSINESS_OWNER', message: 'فقط مسئول کسب‌وکار می‌تواند این ثبت را رد کند' });
        }
        await this.prisma.catalogMember.update({
            where: { id: row.id },
            data: { customerStatus: 'removed', customerLeftAt: new Date(), assignedSellerUserId: null, assignedAt: null },
        });
        await this.syncOverallStatus(catalog.id, row.userId);
        await this.event(catalog.id, row.userId, 'customer_declined', actorId, reason || null);
        await this.bustUsersCache([row.userId, actorId, row.customerAddedByUserId]);
        return { success: true, message: 'ثبت مشتری رد شد' };
    }

    /** حذف مشتری — اونر/ادمین هرکسی؛ فروشنده فقط منتسب‌شده‌ها را */
    async removeCustomer(catalogId: string, memberId: string, actorId: string, note?: string) {
        const catalog = await this.getCatalogOrThrow(catalogId);
        const myRow = await this.getMemberRow(catalog.id, actorId);
        const isOwner = this.isOwner(catalog, actorId);
        const isAdmin = myRow?.status === 'active' && myRow.role === 'catalog_admin';
        const isSeller = this.hasActiveSellerLane(myRow);
        if (!isOwner && !isAdmin && !isSeller) {
            throw new ForbiddenException({ errorCode: 'NOT_TEAM_MEMBER', message: 'دسترسی ندارید' });
        }

        const row = await this.getMemberById(catalog.id, memberId, { customerBusiness: { select: { id: true, name: true } } });
        if (!row.customerStatus || row.customerStatus === 'removed') {
            throw new ConflictException({ errorCode: 'NOT_CUSTOMER', message: 'این عضو مشتری فعال نیست' });
        }
        if (!isOwner && !isAdmin && row.assignedSellerUserId !== actorId) {
            throw new ForbiddenException({ errorCode: 'NOT_YOUR_CUSTOMER', message: 'این مشتری به شما منتسب نیست' });
        }

        const previousSellerUserId = row.assignedSellerUserId;
        await this.prisma.catalogMember.update({
            where: { id: row.id },
            data: {
                customerStatus: 'removed',
                customerLeftAt: new Date(),
                assignedSellerUserId: null,
                assignedAt: null,
            },
        });
        await this.syncOverallStatus(catalog.id, row.userId);
        await this.event(catalog.id, row.userId, 'customer_removed', actorId, note || null, {
            businessId: (row.customerBusiness as any)?.id,
            previousSellerUserId,
        });
        await this.bustUsersCache([row.userId, actorId]);
        return { success: true, message: 'مشتری از کاتالوگ حذف شد' };
    }

    /** خروج خودِ مشتری از کاتالوگ */
    async leaveAsCustomer(catalogId: string, userId: string) {
        const catalog = await this.getCatalogOrThrow(catalogId);
        const row = await this.requireMemberRow(catalog.id, userId);
        if (!row.customerStatus || row.customerStatus === 'removed') {
            throw new ConflictException({ errorCode: 'NOT_CUSTOMER', message: 'شما مشتری این کاتالوگ نیستید' });
        }
        const previousSellerUserId = row.assignedSellerUserId;
        await this.prisma.catalogMember.update({
            where: { id: row.id },
            data: {
                customerStatus: 'removed',
                customerLeftAt: new Date(),
                assignedSellerUserId: null,
                assignedAt: null,
            },
        });
        await this.syncOverallStatus(catalog.id, userId);
        await this.event(catalog.id, userId, 'customer_left', userId, null, { previousSellerUserId });
        await this.bustUsersCache([userId, row.customerAddedByUserId, row.assignedSellerUserId]);
        return { success: true, message: 'عضویت مشتری شما در این کاتالوگ لغو شد' };
    }

    /** تغییر مسئول فروشِ مشتری — اونر/ادمین */
    async assignCustomer(catalogId: string, memberId: string, sellerUserId: string, actorId: string) {
        const catalog = await this.getCatalogOrThrow(catalogId);
        await this.assertTeamManager(catalog, actorId);
        const row = await this.getMemberById(catalog.id, memberId, { customerBusiness: { select: { name: true } } });
        if (row.customerStatus !== 'active' && row.customerStatus !== 'pending') {
            throw new ConflictException({ errorCode: 'NOT_CUSTOMER', message: 'این عضو مشتری نیست' });
        }
        const sellerRow = await this.getMemberRow(catalog.id, sellerUserId);
        if (!this.hasActiveSellerLane(sellerRow)) {
            throw new BadRequestException({ errorCode: 'INVALID_SELLER', message: 'مسئول فروشِ انتخابی فعال نیست' });
        }
        if (row.assignedSellerUserId === sellerUserId) {
            throw new ConflictException({ errorCode: 'SAME_ASSIGNEE', message: 'این مشتری قبلاً به همین مسئول فروش منتسب شده است' });
        }
        await this.prisma.catalogMember.update({
            where: { id: row.id },
            data: { assignedSellerUserId: sellerUserId, assignedAt: new Date() },
        });
        await this.event(catalog.id, row.userId, 'customer_reassigned', actorId, null, {
            from: row.assignedSellerUserId,
            to: sellerUserId,
        });
        await this.bustUsersCache([row.userId, actorId, sellerUserId, row.assignedSellerUserId]);
        return { success: true, message: 'مشتری به مسئول فروش جدید منتسب شد' };
    }

    // ════════════════════════════════════════════════════════════
    //  مسیریابی تماس — برای ad.service
    // ════════════════════════════════════════════════════════════

    /**
     * اگر تماس‌گیرنده مشتریِ فعالِ این کاتالوگ با مسئول فروشِ منتسب باشد،
     * مشخصات مسئول فروش (نام + شماره) برمی‌گردد — وگرنه null (مسیر عادی).
     */
    async resolveCallRoute(catalogId: string, callerUserId: string): Promise<{
        sellerUserId: string;
        sellerName: string | null;
        sellerBusinessName: string | null;
        sellerRegion: string | null;
        phone: string;
    } | null> {
        if (!catalogId || !callerUserId) return null;
        // ✅ کسب‌وکارهایی که caller در آنها مسئول یا عضوِ تیم است (کسب‌وکار مرجع مشترک است)
        const [ownedBizs, memberBizs] = await Promise.all([
            this.prisma.business.findMany({
                where: {
                    status: 'active',
                    OR: [{ ownerUserId: callerUserId }, { creatorUserId: callerUserId }],
                },
                select: { id: true },
            }),
            this.prisma.businessMember.findMany({
                where: { userId: callerUserId, status: 'active' },
                select: { businessId: true },
            }),
        ]);
        const bizIds = [...new Set([...ownedBizs.map((b) => b.id), ...memberBizs.map((m) => m.businessId)])];
        if (!bizIds.length) return null;

        const cm = await this.prisma.catalogMember.findFirst({
            where: {
                catalogId,
                customerBusinessId: { in: bizIds },
                customerStatus: 'active',
                status: 'active',
            },
            select: { id: true, assignedSellerUserId: true },
        });
        if (!cm?.assignedSellerUserId) return null;

        const seller = await this.prisma.catalogMember.findFirst({
            where: { catalogId, userId: cm.assignedSellerUserId, sellerStatus: 'active', status: 'active' },
            include: {
                user: { select: { id: true, fullName: true, phone: true } },
                sellerBusiness: { select: { name: true, phone: true } },
            },
        });
        const phone = (seller as any)?.sellerBusiness?.phone || (seller as any)?.user?.phone || null;
        if (!seller || !phone) return null;

        return {
            sellerUserId: seller.userId,
            sellerName: (seller as any).user?.fullName || null,
            sellerBusinessName: (seller as any).sellerBusiness?.name || null,
            sellerRegion: (seller as any).sellerRegion || null,
            phone,
        };
    }
}
