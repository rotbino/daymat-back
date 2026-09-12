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
 * تیم کاتالوگ — عضویت کاربران در تیمِ یک کاتالوگ (سناریوی بازار پخش سوپرمارکتی):
 *
 *   نقش سیستمی:  اونر (= مالکِ کسب‌وکارِ کاتالوگ — مشتق، بالاترین دسترسی)
 *                ادمین (منصوبِ اونر — سهیم در مدیریت) | ممبر
 *   لِین بیزینسی: فروشندهٔ کاتالوگ (بازاریاب — با منطقهٔ فروش)
 *                خریدار کاتالوگ (سوپرمارکت — منتسب به یک بازاریاب برای مسیریابی تماس)
 *
 *   جریان‌ها:
 *   - بازاریاب: درخواست عضویت فروشندگی → تایید اونر/ادمین → فعال
 *   - مشتری: بازاریاب ثبتش می‌کند (pending) → صاحب سوپرمارکت تایید می‌کند → فعال
 *   - تماس از آگهی: مشتریِ فعال با بازاریابِ منتسب → شمارهٔ همان بازاریاب (resolveCallRoute)
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
    //  resolve helpers
    // ════════════════════════════════════════════════════════════

    private async getCatalogOrThrow(catalogId: string) {
        if (!catalogId || !/^[a-f\d]{24}$/i.test(catalogId)) {
            throw new BadRequestException({ errorCode: 'INVALID_CATALOG_ID', message: 'شناسه کاتالوگ نامعتبر است' });
        }
        const catalog = await this.prisma.catalog.findUnique({
            where: { id: catalogId },
            select: {
                id: true, name: true, slug: true, status: true, businessId: true,
                business: { select: { id: true, name: true, ownerUserId: true, phone: true } },
            },
        });
        if (!catalog || catalog.status === 'closed') {
            throw new NotFoundException({ errorCode: 'CATALOG_NOT_FOUND', message: 'کاتالوگ یافت نشد' });
        }
        return catalog as any;
    }

    /** اونر = مالکِ کسب‌وکارِ کاتالوگ (ملاک واقعی) */
    private isOwner(catalog: any, userId: string): boolean {
        return catalog.business.ownerUserId === userId;
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
        return row.status === 'active' || row.sellerStatus === 'active' || row.customerStatus === 'active';
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

    private memberCard(row: any) {
        return {
            id: row.id,
            userId: row.userId,
            fullName: row.user?.fullName || null,
            phone: row.user?.phone || null,
            avatarUrl: row.user?.avatarUrl || null,
            business: row.sellerBusiness
                ? { id: row.sellerBusiness.id, name: row.sellerBusiness.name, phone: row.sellerBusiness.phone }
                : row.customerBusiness
                    ? { id: row.customerBusiness.id, name: row.customerBusiness.name, phone: row.customerBusiness.phone }
                    : null,
            role: row.role,
            position: row.position || null,
            sellerStatus: row.sellerStatus || null,
            sellerRegion: row.sellerRegion || null,
            sellerBusiness: row.sellerBusiness
                ? { id: row.sellerBusiness.id, name: row.sellerBusiness.name, phone: row.sellerBusiness.phone }
                : null,
            sellerJoinedAt: row.sellerJoinedAt || null,
            customerStatus: row.customerStatus || null,
            customerBusiness: row.customerBusiness
                ? { id: row.customerBusiness.id, name: row.customerBusiness.name, phone: row.customerBusiness.phone, city: row.customerBusiness.city || null }
                : null,
            customerJoinedAt: row.customerJoinedAt || null,
            assignedSellerUserId: row.assignedSellerUserId || null,
            assignedAt: row.assignedAt || null,
            joinedAt: row.joinedAt,
        };
    }

    private readonly MEMBER_INCLUDE = {
        user: { select: { id: true, fullName: true, phone: true, avatarUrl: true } },
        sellerBusiness: { select: { id: true, name: true, phone: true } },
        customerBusiness: { select: { id: true, name: true, phone: true, city: true } },
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

        if (!isOwner && !isAdmin && !isSeller && !isPendingSeller) {
            throw new ForbiddenException({ errorCode: 'NOT_TEAM_MEMBER', message: 'شما عضو تیم این کاتالوگ نیستید' });
        }

        const canManage = isOwner || isAdmin;

        const rows = await this.prisma.catalogMember.findMany({
            where: {
                catalogId: catalog.id,
                OR: [
                    { sellerStatus: { in: ['active', 'pending'] } },
                    { customerStatus: { in: ['active', 'pending'] } },
                    { role: 'catalog_admin', status: 'active' },
                ],
            },
            include: this.MEMBER_INCLUDE,
            orderBy: { createdAt: 'asc' },
        });

        // شمارش مشتری‌های هر بازاریاب
        const customerCounts = new Map<string, number>();
        for (const r of rows) {
            if (r.customerStatus === 'active' && r.assignedSellerUserId) {
                customerCounts.set(r.assignedSellerUserId, (customerCounts.get(r.assignedSellerUserId) || 0) + 1);
            }
        }

        const ownerUserId = catalog.business.ownerUserId;

        const sellers = rows
            .filter((r) => r.sellerStatus === 'active')
            .map((r) => ({
                ...this.memberCard(r),
                isOwner: r.userId === ownerUserId,
                isAdmin: r.role === 'catalog_admin',
                customersCount: customerCounts.get(r.userId) || 0,
            }));

        const pendingSellers = canManage
            ? rows.filter((r) => r.sellerStatus === 'pending').map((r) => ({ ...this.memberCard(r), note: null }))
            : [];

        let customers = rows
            .filter((r) => r.customerStatus === 'active' || r.customerStatus === 'pending')
            .map((r) => ({
                ...this.memberCard(r),
                sellerName: null as string | null,
            }));

        // نام بازاریابِ منتسب — با یک کوئری دیگر
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

        // فروشندهٔ عادی فقط مشتری‌های خودش را می‌بیند
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
            sellers: scopedSellers,
            pendingSellers,
            customers: scopedCustomers,
            events,
            stats: {
                sellers: sellers.length,
                pendingSellers: canManage ? pendingSellers.length : undefined,
                activeCustomers: customers.filter((c) => c.customerStatus === 'active').length,
                pendingCustomers: customers.filter((c) => c.customerStatus === 'pending').length,
            },
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

    /** همهٔ عضویت‌های تیمی من در سراسر کاتالوگ‌ها — پروفایل و سوییچر */
    async getMyMemberships(userId: string) {
        const rows = await this.prisma.catalogMember.findMany({
            where: {
                userId,
                status: 'active',
                OR: [
                    { sellerStatus: { in: ['active', 'pending'] } },
                    { customerStatus: { in: ['active', 'pending'] } },
                    { role: 'catalog_admin' },
                ],
            },
            include: {
                ...this.MEMBER_INCLUDE,
                catalog: { select: { id: true, name: true, slug: true, logoUrl: true, status: true } },
            },
            orderBy: { createdAt: 'desc' },
        });

        // نام/شمارهٔ بازاریابِ منتسب برای لِین خریدار
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
                assignedSeller: seller
                    ? { userId: r.assignedSellerUserId, fullName: seller.fullName, businessName: seller.businessName, phone: seller.phone }
                    : null,
            };
        });
    }

    // ════════════════════════════════════════════════════════════
    //  لِین فروشنده (بازاریاب)
    // ════════════════════════════════════════════════════════════

    /** درخواست عضویت فروشندگی در کاتالوگ — بازاریابِ شرکت */
    async joinAsSeller(catalogId: string, userId: string, dto: { sellerBusinessId?: string; note?: string }) {
        const catalog = await this.getCatalogOrThrow(catalogId);
        if (this.isOwner(catalog, userId)) {
            throw new ConflictException({ errorCode: 'IS_CATALOG_OWNER', message: 'اونر کاتالوگ به‌طور پیش‌فرض فروشنده است — نیازی به درخواست نیست' });
        }

        // کسب‌وکار فروشنده — پیش‌فرض: اولین کسب‌وکار فعال
        let businessId = dto?.sellerBusinessId;
        if (businessId) {
            const biz = await this.prisma.business.findUnique({ where: { id: businessId }, select: { id: true, ownerUserId: true, status: true } });
            if (!biz || biz.ownerUserId !== userId || biz.status !== 'active') {
                throw new BadRequestException({ errorCode: 'INVALID_BUSINESS', message: 'کسب‌وکار انتخابی معتبر نیست' });
            }
        } else {
            const mine = await this.prisma.business.findFirst({
                where: { ownerUserId: userId, status: 'active' },
                orderBy: { createdAt: 'asc' },
                select: { id: true },
            });
            if (!mine) throw new BadRequestException({ errorCode: 'NO_BUSINESS', message: 'ابتدا یک کسب‌وکار بسازید' });
            businessId = mine.id;
        }

        const existing = await this.getMemberRow(catalog.id, userId);
        if (existing && (existing.sellerStatus === 'active' || existing.sellerStatus === 'pending')) {
            throw new ConflictException({ errorCode: 'ALREADY_SELLER', message: 'درخواست فروشندگی شما قبلاً ثبت شده است' });
        }

        const data = {
            sellerBusinessId: businessId,
            sellerStatus: 'pending' as const,
            sellerJoinedAt: null as Date | null,
            sellerLeftAt: null as Date | null,
            status: 'active' as const,
            leftAt: null as Date | null,
        };

        if (existing) {
            await this.prisma.catalogMember.update({ where: { id: existing.id }, data });
        } else {
            await this.prisma.catalogMember.create({ data: { catalogId: catalog.id, userId, ...data } });
        }

        await this.event(catalog.id, userId, 'seller_requested', userId, dto?.note || null, { businessId });
        await this.bustUsersCache([userId]);
        return { success: true, message: 'درخواست فروشندگی شما ثبت شد — در انتظار تایید اونر کاتالوگ' };
    }

    /** تایید درخواست فروشندگی — اونر/ادمین */
    async approveSeller(catalogId: string, memberId: string, actorId: string) {
        const catalog = await this.getCatalogOrThrow(catalogId);
        await this.assertTeamManager(catalog, actorId);
        const row = await this.getMemberById(catalog.id, memberId, { user: { select: { id: true, fullName: true } } });
        if (row.sellerStatus !== 'pending') {
            throw new ConflictException({ errorCode: 'NOT_PENDING', message: 'این درخواست در انتظار تایید نیست' });
        }
        await this.prisma.catalogMember.update({
            where: { id: row.id },
            data: { sellerStatus: 'active', sellerJoinedAt: new Date(), sellerLeftAt: null },
        });
        await this.event(catalog.id, row.userId, 'seller_approved', actorId);
        await this.bustUsersCache([row.userId, actorId]);
        return { success: true, message: 'بازاریاب به تیم کاتالوگ اضافه شد' };
    }

    /** رد درخواست فروشندگی — اونر/ادمین */
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
        return { success: true, message: 'درخواست فروشندگی رد شد' };
    }

    /** حذف بازاریاب از تیم — اونر/ادمین؛ مشتری‌هایش بی‌مسئول می‌شوند */
    async removeSeller(catalogId: string, memberId: string, actorId: string, note?: string) {
        const catalog = await this.getCatalogOrThrow(catalogId);
        await this.assertTeamManager(catalog, actorId);
        const row = await this.getMemberById(catalog.id, memberId);
        if (row.userId === catalog.business.ownerUserId) {
            throw new BadRequestException({ errorCode: 'CANNOT_REMOVE_OWNER', message: 'اونر کاتالوگ قابل حذف نیست' });
        }
        if (row.role === 'catalog_admin') {
            throw new BadRequestException({ errorCode: 'IS_ADMIN', message: 'ابتدا نقش ادمین این عضو را بگیرید' });
        }
        if (this.hasActiveSellerLane(row)) {
            await this.unassignCustomersOf(catalog.id, row.userId, actorId, 'بازاریاب از تیم حذف شد');
            await this.prisma.catalogMember.update({
                where: { id: row.id },
                data: { sellerStatus: 'removed', sellerLeftAt: new Date() },
            });
            await this.syncOverallStatus(catalog.id, row.userId);
            await this.event(catalog.id, row.userId, 'seller_removed', actorId, note || null);
            await this.bustUsersCache([row.userId, actorId]);
        }
        return { success: true, message: 'بازاریاب از تیم کاتالوگ حذف شد' };
    }

    /** خروج خودِ بازاریاب از تیم فروش */
    async leaveAsSeller(catalogId: string, userId: string) {
        const catalog = await this.getCatalogOrThrow(catalogId);
        const row = await this.requireMemberRow(catalog.id, userId);
        if (this.isOwner(catalog, userId)) {
            throw new BadRequestException({ errorCode: 'OWNER_CANNOT_LEAVE', message: 'اونر کاتالوگ نمی‌تواند فروشندگی خودش را ترک کند' });
        }
        if (!this.hasActiveSellerLane(row)) {
            throw new ConflictException({ errorCode: 'NOT_ACTIVE_SELLER', message: 'شما فروشندهٔ فعال این کاتالوگ نیستید' });
        }
        await this.unassignCustomersOf(catalog.id, userId, userId, 'بازاریاب خودش از تیم خارج شد');
        await this.prisma.catalogMember.update({
            where: { id: row.id },
            data: { sellerStatus: 'removed', sellerLeftAt: new Date() },
        });
        await this.syncOverallStatus(catalog.id, userId);
        await this.event(catalog.id, userId, 'seller_left', userId);
        await this.bustUsersCache([userId]);
        return { success: true, message: 'شما از تیم فروش این کاتالوگ خارج شدید' };
    }

    /** منطقهٔ فروش بازاریاب — اونر/ادمین یا خودِ بازاریاب */
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

    /** مشتری‌های یک بازاریاب را بی‌مسئول می‌کند (با رویداد برای هر مشتری) */
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
    //  لِین خریدار (مشتری — سوپرمارکت)
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
                ownerUserId: { not: catalog.business.ownerUserId },
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
     * ثبت مشتری (سوپرمارکت) در کاتالوگ — توسط بازاریاب/ادمین/اونر.
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
            select: { id: true, name: true, ownerUserId: true, status: true },
        });
        if (!biz || biz.status !== 'active') {
            throw new NotFoundException({ errorCode: 'BUSINESS_NOT_FOUND', message: 'کسب‌وکار مشتری یافت نشد' });
        }
        if (biz.ownerUserId === actorId) {
            throw new BadRequestException({ errorCode: 'OWN_BUSINESS', message: 'نمی‌توانید کسب‌وکار خودتان را مشتری ثبت کنید' });
        }
        if (biz.ownerUserId === catalog.business.ownerUserId) {
            throw new BadRequestException({ errorCode: 'CATALOG_OWNER_BUSINESS', message: 'کسب‌وکار اونر کاتالوگ فروشنده است — مشتری نیست' });
        }

        // انتساب: صریح → خود ثبت‌کننده (اگر فروشنده است) → اونر
        let assignedSellerUserId = dto.sellerUserId || null;
        if (assignedSellerUserId) {
            const sellerRow = await this.getMemberRow(catalog.id, assignedSellerUserId);
            if (!this.hasActiveSellerLane(sellerRow)) {
                throw new BadRequestException({ errorCode: 'INVALID_SELLER', message: 'بازاریابِ انتخابی فعال نیست' });
            }
        } else if (isSeller) {
            assignedSellerUserId = actorId;
        } else {
            assignedSellerUserId = catalog.business.ownerUserId; // اونر همیشه فروشندهٔ فعال است
        }

        const dup = await this.prisma.catalogMember.findFirst({
            where: { catalogId: catalog.id, customerBusinessId: biz.id, customerStatus: { in: ['active', 'pending'] } },
        });
        if (dup) {
            throw new ConflictException({ errorCode: 'ALREADY_CUSTOMER', message: 'این کسب‌وکار قبلاً به‌عنوان مشتری ثبت شده است' });
        }

        // رکورد کاربرِ صاحب کسب‌وکار — ممکن است از قبل (مثلاً به‌عنوان بازاریاب) وجود داشته باشد
        const existingRow = await this.getMemberRow(catalog.id, biz.ownerUserId);
        let memberId: string;
        if (existingRow) {
            await this.prisma.catalogMember.update({
                where: { id: existingRow.id },
                data: {
                    customerBusinessId: biz.id,
                    customerStatus: 'pending',
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
                    userId: biz.ownerUserId,
                    customerBusinessId: biz.id,
                    customerStatus: 'pending',
                    customerAddedByUserId: actorId,
                    assignedSellerUserId,
                    assignedAt: new Date(),
                },
            });
            memberId = created.id;
        }

        await this.event(catalog.id, biz.ownerUserId, 'customer_added', actorId, dto?.note || null, {
            businessId: biz.id,
            businessName: biz.name,
            assignedSellerUserId,
        });
        await this.bustUsersCache([biz.ownerUserId, actorId]);
        return {
            success: true,
            memberId,
            message: 'مشتری ثبت شد — تا وقتی صاحب کسب‌وکار تایید کند، تماسش مسیریابی نمی‌شود',
        };
    }

    /** تایید مشتری‌بودن — فقط صاحبِ کسب‌وکارِ مشتری */
    async confirmCustomer(catalogId: string, memberId: string, actorId: string) {
        const catalog = await this.getCatalogOrThrow(catalogId);
        const row = await this.getMemberById(catalog.id, memberId, { customerBusiness: { select: { id: true, ownerUserId: true, name: true } } });
        if (row.customerStatus !== 'pending') {
            throw new ConflictException({ errorCode: 'NOT_PENDING', message: 'چیزی برای تایید نیست' });
        }
        if ((row.customerBusiness as any)?.ownerUserId !== actorId) {
            throw new ForbiddenException({ errorCode: 'NOT_BUSINESS_OWNER', message: 'فقط صاحب کسب‌وکار می‌تواند این ثبت را تایید کند' });
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
        return { success: true, message: 'عضویت مشتری تایید شد — تماس شما به بازاریاب خودتان مسیریابی می‌شود' };
    }

    /** ردِ ثبت مشتری — صاحبِ کسب‌وکار (قبل از تایید) */
    async declineCustomer(catalogId: string, memberId: string, actorId: string, reason?: string) {
        const catalog = await this.getCatalogOrThrow(catalogId);
        const row = await this.getMemberById(catalog.id, memberId, { customerBusiness: { select: { ownerUserId: true } } });
        if (row.customerStatus !== 'pending') {
            throw new ConflictException({ errorCode: 'NOT_PENDING', message: 'چیزی برای رد کردن نیست' });
        }
        if ((row.customerBusiness as any)?.ownerUserId !== actorId) {
            throw new ForbiddenException({ errorCode: 'NOT_BUSINESS_OWNER', message: 'فقط صاحب کسب‌وکار می‌تواند این ثبت را رد کند' });
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

    /** تغییر بازاریابِ مشتری — اونر/ادمین */
    async assignCustomer(catalogId: string, memberId: string, sellerUserId: string, actorId: string) {
        const catalog = await this.getCatalogOrThrow(catalogId);
        await this.assertTeamManager(catalog, actorId);
        const row = await this.getMemberById(catalog.id, memberId, { customerBusiness: { select: { name: true } } });
        if (row.customerStatus !== 'active' && row.customerStatus !== 'pending') {
            throw new ConflictException({ errorCode: 'NOT_CUSTOMER', message: 'این عضو مشتری نیست' });
        }
        const sellerRow = await this.getMemberRow(catalog.id, sellerUserId);
        if (!this.hasActiveSellerLane(sellerRow)) {
            throw new BadRequestException({ errorCode: 'INVALID_SELLER', message: 'بازاریابِ انتخابی فعال نیست' });
        }
        if (row.assignedSellerUserId === sellerUserId) {
            throw new ConflictException({ errorCode: 'SAME_ASSIGNEE', message: 'این مشتری قبلاً به همین بازاریاب منتسب شده است' });
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
        return { success: true, message: 'مشتری به بازاریاب جدید منتسب شد' };
    }

    // ════════════════════════════════════════════════════════════
    //  مسیریابی تماس — برای ad.service
    // ════════════════════════════════════════════════════════════

    /**
     * اگر تماس‌گیرنده مشتریِ فعالِ این کاتالوگ با بازاریابِ منتسب باشد،
     * مشخصات بازاریاب (نام + شماره) برمی‌گردد — وگرنه null (مسیر عادی).
     */
    async resolveCallRoute(catalogId: string, callerUserId: string): Promise<{
        sellerUserId: string;
        sellerName: string | null;
        sellerBusinessName: string | null;
        sellerRegion: string | null;
        phone: string;
    } | null> {
        if (!catalogId || !callerUserId) return null;
        const bizIds = (
            await this.prisma.business.findMany({
                where: { ownerUserId: callerUserId, status: 'active' },
                select: { id: true },
            })
        ).map((b) => b.id);
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
