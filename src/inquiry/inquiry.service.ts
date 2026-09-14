// src/inquiry/inquiry.service.ts
// صفحه درخواست خرید (استعلام قیمت) — سرویس
import {
    Injectable, NotFoundException, ForbiddenException, BadRequestException, OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { CreateInquiryDto, UpdateInquiryDto, CreateOfferDto, UpdateOfferDto, InquiryItemDto, UpdateInquiryItemDto, InquiryUnitDto, AddInquiryMemberDto, RequestInquiryAccessDto } from './inquiry.dto';

const RESERVED_SLUGS = [
    'admin', 'api', 'login', 'logout', 'register', 'my-catalogs', 'my-inquiries',
    'inquiries', 'catalogs', 'business', 'profile', 'market', 'markets', 'home',
    'docs', 'assets', 'static', 'new', 'explore', 'saved-ads', 'notifications', 'credit',
];

const PUBLIC_LIST_SELECT = {
    id: true, title: true, description: true, slug: true, status: true,
    businessId: true, visibility: true, units: true,
    deadline: true, city: true, province: true, tags: true,
    viewCount: true, offerCount: true, createdAt: true,
    owner: { select: { id: true, fullName: true, avatarUrl: true } },
    business: { select: { id: true, name: true, logoUrl: true } },
    _count: { select: { items: true } },
};

@Injectable()
export class InquiryService implements OnModuleInit {
    constructor(
        private prisma: PrismaService,
        private notification: NotificationService,
    ) {}

    /**
     * مهاجرت داده‌های قدیمی (idempotent — در هر بوت اجرا می‌شود):
     * صفحه‌های خریدِ بدون businessId (ساخته‌شده قبل از قابلیت اتصال) که مالکشان دقیقاً یک کسب‌وکار دارد،
     * به همان کسب‌وکار وصل می‌شوند تا در پروفایل کسب‌وکار نمایش داده شوند.
     * مالک چند-کسب‌وکاری دست‌نخورده می‌ماند (اتصال مبهم است — از فرم ویرایش انتخاب می‌شود).
     */
    async onModuleInit() {
        // ─── مهاجرت ۱: کاتالوگ‌های بدون کسب‌وکار → اتصال به کسب‌وکار یگانهٔ مالک ───
        try {
            const orphans = await this.prisma.inquiry.findMany({
                where: { businessId: null },
                select: { id: true, ownerUserId: true },
            });
            if (orphans.length > 0) {
                const ownerIds = [...new Set(orphans.map((i) => i.ownerUserId))];
                const bizs = await this.prisma.business.findMany({
                    // ✅ مالک = ثبت‌کنندهٔ اول (creatorUserId) یا مالکِ قدیمی (ownerUserId)
                    where: { OR: [{ ownerUserId: { in: ownerIds } }, { creatorUserId: { in: ownerIds } }] },
                    select: { id: true, ownerUserId: true, creatorUserId: true },
                });
                // فقط مالکانی که دقیقاً یک کسب‌وکار دارند → MULTI برای بقیه
                const singleBizByOwner = new Map<string, string>();
                for (const b of bizs) {
                    const responsible = b.ownerUserId || b.creatorUserId;
                    if (!responsible) continue;
                    singleBizByOwner.set(
                        responsible,
                        singleBizByOwner.has(responsible) ? '__MULTI__' : b.id,
                    );
                }
                let attached = 0;
                for (const o of orphans) {
                    const bizId = singleBizByOwner.get(o.ownerUserId);
                    if (!bizId || bizId === '__MULTI__') continue;
                    await this.prisma.inquiry
                        .update({ where: { id: o.id }, data: { businessId: bizId } })
                        .catch(() => { /* noop */ });
                    attached++;
                }
                if (attached > 0) {
                    console.log(`[inquiry] ${attached} صفحه درخواست خریدِ بدون کسب‌وکار به کسب‌وکارِ یگانهٔ مالک وصل شد`);
                }
            }
        } catch (e: any) {
            console.warn('[inquiry] مهاجرت اتصال صفحه‌های خرید قدیمی انجام نشد:', e?.message);
        }

        // ─── مهاجرت «اعلام خرید» برای کاتالوگ‌های قدیمی ───
        // در مدل قدیمی کل لیست یک درخواست بود → همهٔ اقلام کاتالوگ‌های نه-مهاجرت‌شده
        // اعلام خرید فعال می‌گیرند (رفتار قبل حفظ می‌شود: همه‌چیز قیمت‌پذیر).
        // کاتالوگ‌های جدید از بدوِ ساخت فلگ legacyUrgentMigrated=true دارند و لمس نمی‌شوند.
        // ⚠️ نکتهٔ Prisma/Mongo: فیلتر { not: true } سندِ بدون-فیلد را نمی‌گیرد → واکشی کامل + فیلتر در کد
        try {
            const all = await this.prisma.inquiry.findMany({
                select: { id: true, legacyUrgentMigrated: true },
            });
            const legacy = all.filter((i) => i.legacyUrgentMigrated !== true);
            for (const ing of legacy) {
                await this.prisma.inquiryItem.updateMany({
                    where: { inquiryId: ing.id },
                    data: { urgent: true, urgentAt: new Date() },
                }).catch(() => { /* noop */ });
                await this.prisma.inquiry.update({
                    where: { id: ing.id },
                    data: { legacyUrgentMigrated: true },
                }).catch(() => { /* noop */ });
            }
            if (legacy.length > 0) {
                console.log(`[inquiry] اقلام ${legacy.length} صفحه درخواست خرید قدیمی «اعلام خرید فعال» گرفتند (رفتار قبل حفظ شد)`);
            }
        } catch (e: any) {
            console.warn('[inquiry] مهاجرت اعلام خرید اقلام قدیمی انجام نشد:', e?.message);
        }
    }

    private isValidObjectId(id?: string): boolean {
        return !!id && /^[0-9a-fA-F]{24}$/.test(id);
    }

    /** آیا این کاربر (با یکی از کاتالوگ‌های فروشش) تامین‌کنندهٔ تاییدشدهٔ این صفحه درخواست خرید است؟ */
    private async isActiveMember(inquiryId: string, userId: string): Promise<boolean> {
        if (!userId) return false;
        const cnt = await this.prisma.inquiryMember.count({
            where: { inquiryId, userId, status: 'active' },
        });
        return cnt > 0;
    }

    /** 🔔 اعلان «اعلام خرید فوری» به تامین‌کننده‌های تاییدشده — قلب شبکهٔ خرید↔فروش */
    private async notifyUrgentAnnounce(
        inquiry: { id: string; title: string; slug: string | null; ownerUserId: string },
        itemName: string,
    ) {
        try {
            const members = await this.prisma.inquiryMember.findMany({
                where: { inquiryId: inquiry.id, status: 'active' },
                select: { userId: true },
            });
            const targets = members.map((m) => m.userId).filter((id) => id !== inquiry.ownerUserId);
            if (!targets.length) return;
            void this.notification.notify({
                userIds: targets,
                type: 'inquiry_urgent_item',
                title: 'اعلام خرید فوری',
                body: `«${itemName}» — در صفحه درخواست خرید ${inquiry.title}`,
                actorUserId: inquiry.ownerUserId,
                href: `/inquiries/${inquiry.slug || inquiry.id}`,
            });
        } catch { /* اعلان هرگز جریان اصلی را نمی‌شکند */ }
    }

    private normalizeSlug(input: string): string {
        return (input ?? '')
            .replace(/\s+/g, '-')
            .replace(/[^\u0600-\u06FF\u0750-\u077F\w\-]/g, '')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .substring(0, 40);
    }

    /** اسلاگ خودکار از عنوان + پسوند کوتاه رندم (چون عنوان فارسی ممکن است نرمال‌سازی شود) */
    private async buildUniqueSlug(title: string, custom?: string): Promise<string> {
        let base = this.normalizeSlug(custom ?? '') || this.normalizeSlug(title) || 'kharid';
        if (RESERVED_SLUGS.includes(base.toLowerCase())) base = `${base}-kharid`;
        for (let i = 0; i < 6; i++) {
            const candidate = i === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
            const exists = await this.prisma.inquiry.findFirst({ where: { slug: candidate }, select: { id: true } });
            if (!exists) return candidate;
        }
        return `${base}-${Date.now().toString(36)}`;
    }

    private cleanItems(items?: InquiryItemDto[]) {
        return (items ?? [])
            .filter((i) => (i.name ?? '').trim().length > 0)
            .map((i, idx) => ({
                name: i.name.trim(),
                // ✅ اتصال به مرجع — کالای مرجع و واحدِ مرجع (با اعتبارسنجی فرمت؛ وجود در سرویس بررسی می‌شود)
                referenceItemId: this.isValidObjectId(i.referenceItemId) ? i.referenceItemId : undefined,
                unitId: this.isValidObjectId(i.unitId) ? i.unitId : undefined,
                quantity: typeof i.quantity === 'number' ? i.quantity : null,
                unit: i.unit?.trim() || null,
                brand: i.brand?.trim() || null,
                specs: Array.isArray(i.specs) && i.specs.length ? i.specs : undefined,
                imageUrl: i.imageUrl?.trim() || null,
                referenceUrl: i.referenceUrl?.trim() || null,
                note: i.note?.trim() || null,
                // ✅ اعلام خرید — undefined یعنی تماس‌گیرنده تصمیم می‌گیرد (legacy: کل لیست درخواست بود)
                urgent: typeof i.urgent === 'boolean' ? i.urgent : undefined,
                order: idx,
            }));
    }

    /** اعتبارسنجی واحدهای اختصاصی — فقط unitIdهای واقعاً موجود در مرجع واحد */
    private async cleanUnits(units?: InquiryUnitDto[]): Promise<any[] | undefined> {
        if (!Array.isArray(units)) return undefined;
        const ids = [...new Set(units.map((u) => u?.unitId).filter((id) => this.isValidObjectId(id)))];
        if (ids.length === 0) return [];
        const found = await this.prisma.unit.findMany({ where: { id: { in: ids } }, select: { id: true } });
        return found.map((u) => ({ unitId: u.id }));
    }

    /** بررسی وجود کالاهای مرجع ارسالی — حذفِ بی‌صدا موارد ناموجود */
    private async filterExistingReferenceIds(items: ReturnType<InquiryService['cleanItems']>) {
        const ids = [...new Set(items.map((i) => i.referenceItemId).filter(Boolean))] as string[];
        if (ids.length === 0) return items;
        const found = await this.prisma.productReference.findMany({ where: { id: { in: ids } }, select: { id: true } });
        const ok = new Set(found.map((p) => p.id));
        return items.map((i) => ({ ...i, referenceItemId: i.referenceItemId && ok.has(i.referenceItemId) ? i.referenceItemId : undefined }));
    }

    // ─── ساخت ───
    // ✅ مدل جدید: کاتالوگ خالی هم مجاز است (اقلام بعداً قلم‌به‌قلم از پنل اضافه می‌شود)
    async create(userId: string, dto: CreateInquiryDto) {
        if (dto.businessId && !this.isValidObjectId(dto.businessId)) {
            throw new BadRequestException({ errorCode: 'INVALID_BUSINESS', message: 'شناسه کسب‌وکار نامعتبر است' });
        }
        if (dto.businessId) {
            const biz = await this.prisma.business.findFirst({
                // ✅ مالک = ثبت‌کنندهٔ اول یا مالکِ قدیمی (هماهنگ با canEdit سرویس کسب‌وکار)
                where: { id: dto.businessId, OR: [{ creatorUserId: userId }, { ownerUserId: userId }] },
                select: { id: true },
            });
            if (!biz) throw new ForbiddenException({ errorCode: 'NOT_YOUR_BUSINESS', message: 'این کسب‌وکار متعلق به شما نیست' });
        }
        const items = await this.filterExistingReferenceIds(this.cleanItems(dto.items));
        const units = await this.cleanUnits(dto.units);
        const slug = await this.buildUniqueSlug(dto.title, dto.slug);
        const { items: _drop, slug: _s, units: _u, ...data } = dto;
        const inquiry = await this.prisma.inquiry.create({
            data: {
                ...data,
                units: units ?? undefined,
                deadline: dto.deadline ? new Date(dto.deadline) : null,
                ownerUserId: userId,
                slug,
                // ✅ کاتالوگ تازه‌ساخته از مهاجرت legacy معاف است (اقلامش urgent صریح دارند)
                legacyUrgentMigrated: true,
                items: {
                    create: items.map((c) => ({
                        ...c,
                        // مسیر legacy (ساخت با آرایهٔ اقلام): بدون urgent صریح، کل لیست درخواست بود
                        urgent: c.urgent ?? true,
                        urgentAt: (c.urgent ?? true) ? new Date() : null,
                    })),
                },
            },
            include: { items: { orderBy: { order: 'asc' } } },
        });
        return inquiry;
    }

    // ─── دیوار عمومی (فهرست صفحه‌های خرید باز) ───
    async publicList(opts: { q?: string; city?: string; tag?: string; page?: number; limit?: number }) {
        const page = Math.max(1, opts.page ?? 1);
        const limit = Math.min(50, Math.max(1, opts.limit ?? 20));
        const where: any = {
            status: 'open',
            visibility: 'public',
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        };
        if (opts.q?.trim()) {
            const q = opts.q.trim();
            where.OR.push({ title: { contains: q } }, { description: { contains: q } }, { tags: { contains: q } });
        }
        if (opts.city?.trim()) where.city = { contains: opts.city.trim() };
        if (opts.tag?.trim()) where.tags = { contains: opts.tag.trim() };

        const [items, total] = await Promise.all([
            this.prisma.inquiry.findMany({
                where, select: PUBLIC_LIST_SELECT,
                orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit,
            }),
            this.prisma.inquiry.count({ where }),
        ]);
        return { items, total, page, limit };
    }

    // ─── صفحه‌های خرید من ───
    async mine(userId: string) {
        return this.prisma.inquiry.findMany({
            where: { ownerUserId: userId, status: { not: 'archived' } },
            orderBy: { createdAt: 'desc' },
            select: {
                ...PUBLIC_LIST_SELECT,
                _count: { select: { items: true } },
            },
        });
    }

    // ─── جزئیات با شناسه یا اسلاگ (عمومی با لینک) ───
    async findByIdOrSlug(idOrSlug: string, userId?: string) {
        const isId = this.isValidObjectId(idOrSlug);
        const inquiry = await this.prisma.inquiry.findFirst({
            where: isId ? { id: idOrSlug } : { slug: idOrSlug },
            include: {
                items: { orderBy: { order: 'asc' } },
                owner: { select: { id: true, fullName: true, avatarUrl: true } },
                business: { select: { id: true, name: true, logoUrl: true, city: true } },
            },
        });
        if (!inquiry || inquiry.status === 'archived') {
            throw new NotFoundException({ errorCode: 'INQUIRY_NOT_FOUND', message: 'صفحه درخواست خرید پیدا نشد' });
        }
        const isOwner = !!userId && userId === inquiry.ownerUserId;

        // ✅ گیت کاتالوگ خصوصی — فقط تامین‌کننده‌های تاییدشده محتوایش را می‌بینند
        let isMember = false;
        if (!isOwner && inquiry.visibility === 'private') {
            isMember = await this.isActiveMember(inquiry.id, userId as string);
            if (!isMember) {
                return {
                    limited: true,
                    id: inquiry.id,
                    slug: inquiry.slug,
                    title: inquiry.title, // عنوان برای گویا بودن درخواست عضویت
                    visibility: 'private',
                    isOwner: false,
                    isMember: false,
                };
            }
        }

        // شمارش بازدید — fire & forget (بازدید مالک حساب نمی‌شود)
        if (!isOwner) {
            this.prisma.inquiry.update({ where: { id: inquiry.id }, data: { viewCount: { increment: 1 } } })
                .catch(() => { /* noop */ });
        }

        if (isOwner) {
            const offers = await this.prisma.inquiryOffer.findMany({
                where: { inquiryId: inquiry.id },
                orderBy: { createdAt: 'desc' },
                include: {
                    offerer: { select: { id: true, fullName: true, phone: true } },
                },
            });
            // نام کسب‌وکار پیشنهاددهنده‌ها
            const bizIds = offers.map((o) => o.businessId).filter(Boolean) as string[];
            const bizs = bizIds.length ? await this.prisma.business.findMany({
                where: { id: { in: bizIds } }, select: { id: true, name: true, logoUrl: true },
            }) : [];
            const bizMap = Object.fromEntries(bizs.map((b) => [b.id, b]));
            return { ...inquiry, isOwner, offers: offers.map((o) => ({ ...o, business: o.businessId ? bizMap[o.businessId] ?? null : null })) };
        }

        return { ...inquiry, isOwner: false, isMember };
    }

    // ─── ویرایش (مالک) ───
    async update(id: string, userId: string, dto: UpdateInquiryDto) {
        const inquiry = await this.prisma.inquiry.findUnique({ where: { id } });
        if (!inquiry) throw new NotFoundException({ errorCode: 'INQUIRY_NOT_FOUND', message: 'صفحه درخواست خرید پیدا نشد' });
        if (inquiry.ownerUserId !== userId) {
            throw new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'اجازهٔ ویرایش ندارید' });
        }
        if (dto.slug && dto.slug !== inquiry.slug) {
            const normalized = this.normalizeSlug(dto.slug);
            if (!normalized || RESERVED_SLUGS.includes(normalized.toLowerCase())) {
                throw new BadRequestException({ errorCode: 'INVALID_SLUG', message: 'این آدرس قابل انتخاب نیست' });
            }
            const taken = await this.prisma.inquiry.findFirst({ where: { slug: normalized, id: { not: id } } });
            if (taken) throw new BadRequestException({ errorCode: 'SLUG_TAKEN', message: 'این آدرس قبلاً گرفته شده' });
        }
        const { items, slug, deadline, businessId, units, ...rest } = dto;
        const data: any = { ...rest };
        if (slug) data.slug = this.normalizeSlug(slug);
        if (deadline !== undefined) data.deadline = deadline ? new Date(deadline) : null;
        // ✅ واحدهای اختصاصی — جایگزینی کامل (فقط unitIdهای موجود در مرجع)
        if (units !== undefined) {
            data.units = await this.cleanUnits(units);
        }
        // اتصال/تغییر/قطع اتصال کسب‌وکار (رشتهٔ خالی = قطع اتصال)
        if (businessId !== undefined) {
            if (businessId) {
                if (!this.isValidObjectId(businessId)) {
                    throw new BadRequestException({ errorCode: 'INVALID_BUSINESS', message: 'شناسه کسب‌وکار نامعتبر است' });
                }
                const biz = await this.prisma.business.findFirst({
                    where: { id: businessId, OR: [{ creatorUserId: userId }, { ownerUserId: userId }] },
                    select: { id: true },
                });
                if (!biz) throw new ForbiddenException({ errorCode: 'NOT_YOUR_BUSINESS', message: 'این کسب‌وکار متعلق به شما نیست' });
                data.businessId = businessId;
            } else {
                data.businessId = null;
            }
        }

        return this.prisma.$transaction(async (tx) => {
            // اگر اقلام ارسال شده → جایگزینی کامل (ساده و قطعی) — مسیر legacy: بدون urgent صریح، همه اعلام خرید فعال
            if (Array.isArray(items)) {
                const cleaned = await this.filterExistingReferenceIds(this.cleanItems(items));
                await tx.inquiryItem.deleteMany({ where: { inquiryId: id } });
                if (cleaned.length > 0) {
                    await tx.inquiryItem.createMany({
                        data: cleaned.map((c) => ({
                            ...c,
                            inquiryId: id,
                            urgent: c.urgent ?? true,
                            urgentAt: (c.urgent ?? true) ? new Date() : null,
                        })),
                    });
                }
                // اقلام صریح نوشته شدند → از مهاجرت legacy معاف
                data.legacyUrgentMigrated = true;
            }
            return tx.inquiry.update({
                where: { id },
                data,
                include: { items: { orderBy: { order: 'asc' } } },
            });
        });
    }

    // ─── حذف (مالک) ───
    async remove(id: string, userId: string) {
        const inquiry = await this.prisma.inquiry.findUnique({ where: { id } });
        if (!inquiry) throw new NotFoundException({ errorCode: 'INQUIRY_NOT_FOUND', message: 'صفحه درخواست خرید پیدا نشد' });
        if (inquiry.ownerUserId !== userId) {
            throw new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'اجازهٔ حذف ندارید' });
        }
        await this.prisma.inquiry.delete({ where: { id } });
        return { message: 'صفحه درخواست خرید حذف شد' };
    }

    // ═══ مدیریت قلم‌به‌قلم (پنل صفحه درخواست خرید) ═══

    private async assertOwner(id: string, userId: string) {
        const inquiry = await this.prisma.inquiry.findUnique({ where: { id }, select: { id: true, ownerUserId: true } });
        if (!inquiry) throw new NotFoundException({ errorCode: 'INQUIRY_NOT_FOUND', message: 'صفحه درخواست خرید پیدا نشد' });
        if (inquiry.ownerUserId !== userId) {
            throw new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'فقط صاحب صفحه درخواست خرید می‌تواند اقلام را مدیریت کند' });
        }
    }

    /** افزودن یک قلم — هر بار یک کالا (فرم سریع پنل) */
    async addItem(inquiryId: string, userId: string, dto: InquiryItemDto) {
        await this.assertOwner(inquiryId, userId);
        const [cleaned] = await this.filterExistingReferenceIds(this.cleanItems([{ ...dto, name: (dto.name ?? '').trim() }]));
        if (!cleaned) {
            throw new BadRequestException({ errorCode: 'EMPTY_ITEM', message: 'نام قلم الزامی است' });
        }
        const last = await this.prisma.inquiryItem.findFirst({
            where: { inquiryId }, orderBy: { order: 'desc' }, select: { order: true },
        });
        const urgent = dto.urgent === true;
        const item = await this.prisma.inquiryItem.create({
            data: {
                ...cleaned,
                inquiryId,
                order: (last?.order ?? -1) + 1,
                urgent,
                urgentAt: urgent ? new Date() : null,
            },
        });
        // 🔔 اعلام خرید فوری → اعلان به تامین‌کننده‌های تاییدشده
        if (urgent) {
            const ing = await this.prisma.inquiry.findUnique({
                where: { id: inquiryId },
                select: { id: true, title: true, slug: true, ownerUserId: true },
            });
            if (ing) void this.notifyUrgentAnnounce(ing, item.name);
        }
        return item;
    }

    /** ویرایش یک قلم — merge فیلدهای ارسال‌شده (تاگل اعلام خرید فقط urgent می‌فرستد) */
    async updateItem(inquiryId: string, itemId: string, userId: string, dto: UpdateInquiryItemDto) {
        await this.assertOwner(inquiryId, userId);
        const item = await this.prisma.inquiryItem.findFirst({ where: { id: itemId, inquiryId } });
        if (!item) throw new BadRequestException({ errorCode: 'INVALID_ITEM', message: 'قلم یافت نشد' });

        const data: any = {};
        if (dto.name !== undefined && dto.name.trim()) data.name = dto.name.trim();
        if (dto.quantity !== undefined) data.quantity = typeof dto.quantity === 'number' ? dto.quantity : null;
        if (dto.unit !== undefined) data.unit = dto.unit?.trim() || null;
        if (dto.brand !== undefined) data.brand = dto.brand?.trim() || null;
        if (dto.note !== undefined) data.note = dto.note?.trim() || null;
        if (dto.referenceUrl !== undefined) data.referenceUrl = dto.referenceUrl?.trim() || null;
        if (dto.imageUrl !== undefined) data.imageUrl = dto.imageUrl?.trim() || null;
        if (dto.specs !== undefined) data.specs = Array.isArray(dto.specs) && dto.specs.length ? dto.specs : [];
        if (dto.referenceItemId !== undefined) {
            data.referenceItemId = this.isValidObjectId(dto.referenceItemId) ? dto.referenceItemId : null;
            if (data.referenceItemId) {
                const exists = await this.prisma.productReference.findFirst({ where: { id: data.referenceItemId }, select: { id: true } });
                if (!exists) data.referenceItemId = null;
            }
        }
        if (dto.unitId !== undefined) {
            data.unitId = this.isValidObjectId(dto.unitId) ? dto.unitId : null;
        }
        if (typeof dto.urgent === 'boolean') {
            data.urgent = dto.urgent;
            data.urgentAt = dto.urgent ? (item.urgentAt ?? new Date()) : null;
        }
        if (Object.keys(data).length === 0) return item;
        const updated = await this.prisma.inquiryItem.update({ where: { id: itemId }, data });
        // 🔔 اعلام خرید تازه (خاموش→روشن) → اعلان به تامین‌کننده‌های تاییدشده
        if (typeof dto.urgent === 'boolean' && dto.urgent && !item.urgent) {
            const ing = await this.prisma.inquiry.findUnique({
                where: { id: inquiryId },
                select: { id: true, title: true, slug: true, ownerUserId: true },
            });
            if (ing) void this.notifyUrgentAnnounce(ing, updated.name);
        }
        return updated;
    }

    /** حذف یک قلم */
    async removeItem(inquiryId: string, itemId: string, userId: string) {
        await this.assertOwner(inquiryId, userId);
        const item = await this.prisma.inquiryItem.findFirst({ where: { id: itemId, inquiryId }, select: { id: true } });
        if (!item) throw new BadRequestException({ errorCode: 'INVALID_ITEM', message: 'قلم یافت نشد' });
        await this.prisma.inquiryItem.delete({ where: { id: itemId } });
        return { message: 'قلم حذف شد' };
    }

    // ─── ثبت پیشنهاد قیمت (تامین‌کننده) ───
    async addOffer(inquiryId: string, userId: string, dto: CreateOfferDto) {
        const inquiry = await this.prisma.inquiry.findUnique({ where: { id: inquiryId } });
        if (!inquiry || inquiry.status === 'archived') {
            throw new NotFoundException({ errorCode: 'INQUIRY_NOT_FOUND', message: 'صفحه درخواست خرید پیدا نشد' });
        }
        if (inquiry.status !== 'open') {
            throw new BadRequestException({ errorCode: 'INQUIRY_CLOSED', message: 'این استعلام بسته شده است' });
        }
        if (inquiry.deadline && inquiry.deadline < new Date()) {
            throw new BadRequestException({ errorCode: 'DEADLINE_PASSED', message: 'مهلت ارسال پیشنهاد گذشته است' });
        }
        if (inquiry.ownerUserId === userId) {
            throw new BadRequestException({ errorCode: 'OWN_INQUIRY', message: 'روی صفحه درخواست خرید خودتان نمی‌توانید پیشنهاد بدهید' });
        }
        // ✅ گیت کاتالوگ خصوصی — فقط تامین‌کننده‌های تاییدشده قیمت می‌دهند
        if (inquiry.visibility === 'private' && !(await this.isActiveMember(inquiryId, userId))) {
            throw new ForbiddenException({
                errorCode: 'PRIVATE_INQUIRY',
                message: 'این صفحه درخواست خرید خصوصی است — فقط تامین‌کننده‌های تاییدشده می‌توانند قیمت بدهند',
            });
        }
        if (dto.itemId && !this.isValidObjectId(dto.itemId)) {
            throw new BadRequestException({ errorCode: 'INVALID_ITEM', message: 'قلم نامعتبر است' });
        }
        let itemName: string | null = null;
        if (dto.itemId) {
            const item = await this.prisma.inquiryItem.findFirst({ where: { id: dto.itemId, inquiryId } });
            if (!item) throw new BadRequestException({ errorCode: 'INVALID_ITEM', message: 'قلم یافت نشد' });
            // ✅ گیت اعلام خرید: قلمِ بدون اعلام خرید فعال فقط وقتی باز است که خریدار
            //    «امکان ارسال قیمت برای خریدهای غیر فوری» را در تنظیمات روشن کرده باشد
            if (!item.urgent && inquiry.allowNonUrgentOffers !== true) {
                throw new BadRequestException({
                    errorCode: 'OFFERS_CLOSED_FOR_ITEM',
                    message: 'خریدار فعلاً برای این قلم قیمت نمی‌گیرد',
                });
            }
            itemName = item.name;
        } else {
            // پیشنهاد کل لیست — فقط وقتی باز است که همهٔ اقلام اعلام خرید فعال دارند
            // یا خریدار قیمت‌گیری غیرفوری را باز گذاشته باشد
            const its = await this.prisma.inquiryItem.findMany({ where: { inquiryId }, select: { urgent: true } });
            if (its.some((i) => !i.urgent) && inquiry.allowNonUrgentOffers !== true) {
                throw new BadRequestException({
                    errorCode: 'OFFERS_CLOSED_FOR_ITEM',
                    message: 'برای کل لیست نمی‌توانید قیمت بدهید — روی هر قلم جداگانه قیمت بدهید',
                });
            }
        }
        if (dto.businessId) {
            if (!this.isValidObjectId(dto.businessId)) {
                throw new BadRequestException({ errorCode: 'INVALID_BUSINESS', message: 'شناسه کسب‌وکار نامعتبر است' });
            }
            const biz = await this.prisma.business.findFirst({
                where: { id: dto.businessId, OR: [{ creatorUserId: userId }, { ownerUserId: userId }] },
                select: { id: true },
            });
            if (!biz) throw new ForbiddenException({ errorCode: 'NOT_YOUR_BUSINESS', message: 'این کسب‌وکار متعلق به شما نیست' });
        }
        const { itemId, ...rest } = dto;
        const offer = await this.prisma.inquiryOffer.create({
            data: { ...rest, inquiryId, itemId: itemId || null, itemName: itemName || null, offererUserId: userId },
        });
        await this.prisma.inquiry.update({ where: { id: inquiryId }, data: { offerCount: { increment: 1 } } });
        // 🔔 اعلان به خریدار — پیشنهاد جدید (بی‌صدا؛ هرگز جریان اصلی را نمی‌شکند)
        const offerer = await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
        void this.notification.notify({
            userIds: [inquiry.ownerUserId],
            type: 'inquiry_offer',
            title: 'پیشنهاد قیمت جدید',
            body: `${offerer?.fullName || 'تامین‌کننده'} برای «${itemName || inquiry.title}» قیمت پیشنهاد داد`,
            actorUserId: userId,
            href: `/inquiries/${inquiry.slug || inquiry.id}`,
            businessId: inquiry.businessId ?? null,
        });
        return offer;
    }

    // ─── پیشنهادهای یک استعلام (فقط مالک) ───
    async getOffers(inquiryId: string, userId: string) {
        const inquiry = await this.prisma.inquiry.findUnique({ where: { id: inquiryId } });
        if (!inquiry) throw new NotFoundException({ errorCode: 'INQUIRY_NOT_FOUND', message: 'صفحه درخواست خرید پیدا نشد' });
        if (inquiry.ownerUserId !== userId) {
            throw new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'فقط صاحب صفحه درخواست خرید پیشنهادها را می‌بیند' });
        }
        const offers = await this.prisma.inquiryOffer.findMany({
            where: { inquiryId, status: { not: 'withdrawn' } },
            orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
            include: { offerer: { select: { id: true, fullName: true, phone: true } } },
        });
        const bizIds = offers.map((o) => o.businessId).filter(Boolean) as string[];
        const bizs = bizIds.length ? await this.prisma.business.findMany({
            where: { id: { in: bizIds } }, select: { id: true, name: true, logoUrl: true, city: true },
        }) : [];
        const bizMap = Object.fromEntries(bizs.map((b) => [b.id, b]));
        return offers.map((o) => ({ ...o, business: o.businessId ? bizMap[o.businessId] ?? null : null }));
    }

    // ─── تغییر وضعیت پیشنهاد: مالک → accepted/rejected؛ پیشنهاددهنده → withdrawn ───
    async updateOffer(offerId: string, userId: string, dto: UpdateOfferDto) {
        const offer = await this.prisma.inquiryOffer.findUnique({ where: { id: offerId } });
        if (!offer) throw new NotFoundException({ errorCode: 'OFFER_NOT_FOUND', message: 'پیشنهاد پیدا نشد' });
        const inquiry = await this.prisma.inquiry.findUnique({ where: { id: offer.inquiryId } });

        if (dto.status === 'withdrawn') {
            if (offer.offererUserId !== userId) {
                throw new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'فقط پیشنهاددهنده می‌تواند انصراف بدهد' });
            }
        } else {
            if (!inquiry || inquiry.ownerUserId !== userId) {
                throw new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'فقط صاحب صفحه درخواست خرید می‌تواند تصمیم بگیرد' });
            }
        }
        const updated = await this.prisma.inquiryOffer.update({ where: { id: offerId }, data: { status: dto.status } });
        if (dto.status === 'withdrawn') {
            await this.prisma.inquiry.update({ where: { id: offer.inquiryId }, data: { offerCount: { decrement: 1 } } });
        } else if (inquiry) {
            // 🔔 اعلان به تامین‌کننده — نتیجهٔ پیشنهادش
            void this.notification.notify({
                userIds: [offer.offererUserId],
                type: 'inquiry_offer_status',
                title: dto.status === 'accepted' ? 'پیشنهادت پذیرفته شد' : 'پیشنهادت رد شد',
                body: inquiry.title ? `صفحه درخواست خرید «${inquiry.title}»` : undefined,
                actorUserId: userId,
                href: `/inquiries/${inquiry.slug || offer.inquiryId}`,
                businessId: inquiry.businessId ?? null,
            });
        }
        return updated;
    }

    // ─── پیشنهادهای من (سمت تامین‌کننده) ───
    async myOffers(userId: string) {
        const offers = await this.prisma.inquiryOffer.findMany({
            where: { offererUserId: userId },
            orderBy: { createdAt: 'desc' },
            include: {
                inquiry: {
                    select: { id: true, title: true, slug: true, status: true, city: true, deadline: true },
                },
            },
        });
        return offers;
    }

    // ═══════════════════════════════════════════════════════════════════
    // ✅ اعضای صفحه درخواست خرید — تامین‌کننده‌های تاییدشده (شبکهٔ خرید↔فروش)
    //    همهٔ ارتباطات کاتالوگ‌به‌کاتالوگ می‌شود: خریدار از روی صفحه درخواست خریدش
    //    تامین‌کننده اضافه می‌کند؛ تامین‌کننده اعلام خریدهای فوری را در
    //    پنل کاتالوگ فروشش می‌بیند و قیمت می‌دهد.
    // ═══════════════════════════════════════════════════════════════════

    /** فهرست تامین‌کننده‌های این صفحه درخواست خرید (مالک — تب «تامین‌کنندگان» پنل خرید) */
    async getMembers(inquiryId: string, userId: string) {
        await this.assertOwner(inquiryId, userId);
        return this.prisma.inquiryMember.findMany({
            where: { inquiryId },
            orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
            include: {
                catalog: { select: { id: true, name: true, slug: true, logoUrl: true, city: true } },
                user: { select: { id: true, fullName: true, avatarUrl: true } },
            },
        });
    }

    /** جست‌وجوی کاتالوگ فروش برای دعوت — فعال‌ها، بدون عضویت قبلی */
    async supplierCandidates(inquiryId: string, userId: string, q?: string) {
        await this.assertOwner(inquiryId, userId);
        const members = await this.prisma.inquiryMember.findMany({
            where: { inquiryId },
            select: { catalogId: true },
        });
        const where: any = { status: 'active', id: { notIn: members.map((m) => m.catalogId) } };
        if (q?.trim()) where.name = { contains: q.trim() };
        const items = await this.prisma.catalog.findMany({
            where,
            select: { id: true, name: true, slug: true, logoUrl: true, city: true },
            orderBy: { createdAt: 'desc' },
            take: 20,
        });
        return { items };
    }

    /** دعوت تامین‌کننده توسط خریدار (buyer_add) — تایید نهایی با تامین‌کننده */
    async addMember(inquiryId: string, userId: string, dto: AddInquiryMemberDto) {
        await this.assertOwner(inquiryId, userId);
        if (!this.isValidObjectId(dto.catalogId)) {
            throw new BadRequestException({ errorCode: 'INVALID_CATALOG', message: 'کاتالوگ نامعتبر است' });
        }
        const catalog = await this.prisma.catalog.findUnique({
            where: { id: dto.catalogId },
            select: {
                id: true, name: true, status: true,
                business: { select: { ownerUserId: true, creatorUserId: true } },
            },
        });
        if (!catalog || catalog.status !== 'active') {
            throw new BadRequestException({ errorCode: 'CATALOG_NOT_FOUND', message: 'کاتالوگ تامین‌کننده پیدا نشد' });
        }
        const supplierUserId = catalog.business.ownerUserId || catalog.business.creatorUserId || null;
        if (supplierUserId === userId) {
            throw new BadRequestException({ errorCode: 'OWN_CATALOG', message: 'کاتالوگ فروش خودتان را نمی‌توانید تامین‌کننده کنید' });
        }
        const inquiry = await this.prisma.inquiry.findUnique({
            where: { id: inquiryId },
            select: { id: true, title: true, businessId: true, ownerUserId: true },
        });
        if (!inquiry) throw new NotFoundException({ errorCode: 'INQUIRY_NOT_FOUND', message: 'صفحه درخواست خرید پیدا نشد' });

        const existing = await this.prisma.inquiryMember.findUnique({
            where: { inquiryId_catalogId: { inquiryId, catalogId: dto.catalogId } },
        });
        let member;
        if (existing) {
            if (existing.status === 'active') {
                throw new BadRequestException({ errorCode: 'ALREADY_MEMBER', message: 'این تامین‌کننده قبلاً عضو شده' });
            }
            if (existing.status === 'pending') {
                throw new BadRequestException({ errorCode: 'PENDING', message: 'وضعیت این تامین‌کننده هنوز در انتظار است' });
            }
            // declined/removed → دعوت دوباره
            member = await this.prisma.inquiryMember.update({
                where: { id: existing.id },
                data: { status: 'pending', via: 'buyer_add', userId: supplierUserId ?? existing.userId, note: dto.note ?? null },
            });
        } else {
            member = await this.prisma.inquiryMember.create({
                data: {
                    inquiryId,
                    catalogId: dto.catalogId,
                    userId: supplierUserId!,
                    status: 'pending',
                    via: 'buyer_add',
                    note: dto.note ?? null,
                },
            });
        }
        // 🔔 به تامین‌کننده — دعوت به تامین‌کنندگی
        void this.notification.notify({
            userIds: [member.userId],
            type: 'inquiry_member_invite',
            title: 'دعوت به تامین‌کنندگی',
            body: `صفحه درخواست خرید «${inquiry.title}» تو را به‌عنوان تامین‌کننده دعوت کرده`,
            actorUserId: userId,
            href: '/my-catalogs?tab=leads',
            businessId: inquiry.businessId ?? null,
        });
        return member;
    }

    /** درخواست عضویت تامین‌کننده (از گیت صفحهٔ عمومی کاتالوگ خصوصی) — تایید با خریدار */
    async requestAccess(inquiryId: string, userId: string, dto: RequestInquiryAccessDto) {
        const inquiry = await this.prisma.inquiry.findUnique({ where: { id: inquiryId } });
        if (!inquiry || inquiry.status === 'archived') {
            throw new NotFoundException({ errorCode: 'INQUIRY_NOT_FOUND', message: 'صفحه درخواست خرید پیدا نشد' });
        }
        if (inquiry.ownerUserId === userId) {
            throw new BadRequestException({ errorCode: 'OWN_INQUIRY', message: 'این صفحه درخواست خرید مال خودتان است' });
        }
        if (!this.isValidObjectId(dto.catalogId)) {
            throw new BadRequestException({ errorCode: 'INVALID_CATALOG', message: 'کاتالوگ نامعتبر است' });
        }
        const catalog = await this.prisma.catalog.findFirst({
            where: {
                id: dto.catalogId,
                OR: [{ business: { ownerUserId: userId } }, { business: { creatorUserId: userId } }],
            },
            select: { id: true, name: true, status: true },
        });
        if (!catalog || catalog.status !== 'active') {
            throw new ForbiddenException({ errorCode: 'NOT_YOUR_CATALOG', message: 'این کاتالوگ فروش متعلق به شما نیست' });
        }
        const existing = await this.prisma.inquiryMember.findUnique({
            where: { inquiryId_catalogId: { inquiryId, catalogId: catalog.id } },
        });
        if (existing && (existing.status === 'active' || existing.status === 'pending')) {
            return existing; // عضو یا در انتظار — همان را برگردان
        }
        const member = existing
            ? await this.prisma.inquiryMember.update({
                  where: { id: existing.id },
                  data: { status: 'pending', via: 'supplier_request', userId, note: dto.note ?? null },
              })
            : await this.prisma.inquiryMember.create({
                  data: { inquiryId, catalogId: catalog.id, userId, status: 'pending', via: 'supplier_request', note: dto.note ?? null },
              });
        // 🔔 به خریدار — درخواست تامین‌کنندگی
        void this.notification.notify({
            userIds: [inquiry.ownerUserId],
            type: 'inquiry_member_request',
            title: 'درخواست تامین‌کنندگی',
            body: `«${catalog.name}» درخواست عضویت در صفحه درخواست خرید «${inquiry.title}» را دارد`,
            actorUserId: userId,
            href: '/my-inquiries?tab=members',
            businessId: inquiry.businessId ?? null,
        });
        return member;
    }

    /** تایید/رد/حذف عضو — بسته به مسیر: تایید دعوت با تامین‌کننده، تایید درخواست با خریدار؛ رد/حذف با هر دو */
    async decideMember(inquiryId: string, memberId: string, userId: string, status: 'active' | 'declined' | 'removed') {
        const member = await this.prisma.inquiryMember.findFirst({ where: { id: memberId, inquiryId } });
        if (!member) throw new NotFoundException({ errorCode: 'MEMBER_NOT_FOUND', message: 'عضو پیدا نشد' });
        const inquiry = await this.prisma.inquiry.findUnique({
            where: { id: inquiryId },
            select: { id: true, title: true, slug: true, ownerUserId: true, businessId: true },
        });
        if (!inquiry) throw new NotFoundException({ errorCode: 'INQUIRY_NOT_FOUND', message: 'صفحه درخواست خرید پیدا نشد' });

        const isBuyer = inquiry.ownerUserId === userId;
        const isSupplier = member.userId === userId;
        if (!isBuyer && !isSupplier) {
            throw new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'اجازهٔ این کار را ندارید' });
        }

        // رد / حذف — هر دو طرف مجاز
        if (status !== 'active') {
            return this.prisma.inquiryMember.update({
                where: { id: member.id },
                data: { status: status === 'removed' ? 'removed' : 'declined' },
            });
        }

        // تایید — فقط مسیر درستش
        if (member.via === 'buyer_add' && !isSupplier) {
            throw new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'تایید دعوت با تامین‌کننده است' });
        }
        if (member.via === 'supplier_request' && !isBuyer) {
            throw new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'تایید درخواست با خریدار است' });
        }
        const updated = await this.prisma.inquiryMember.update({
            where: { id: member.id },
            data: { status: 'active' },
        });
        // 🔔 به طرف مقابل
        if (member.via === 'supplier_request') {
            void this.notification.notify({
                userIds: [member.userId],
                type: 'inquiry_member_approved',
                title: 'تامین‌کنندهٔ تایید شدید',
                body: `در صفحه درخواست خرید «${inquiry.title}» تایید شدید — اعلام خریدهایش را می‌بینید`,
                actorUserId: userId,
                href: '/my-catalogs?tab=leads',
                businessId: inquiry.businessId ?? null,
            });
        } else {
            void this.notification.notify({
                userIds: [inquiry.ownerUserId],
                type: 'inquiry_member_confirmed',
                title: 'تامین‌کنندهٔ جدید',
                body: `تامین‌کننده دعوت شما را برای «${inquiry.title}» پذیرفت`,
                actorUserId: userId,
                href: '/my-inquiries?tab=members',
                businessId: inquiry.businessId ?? null,
            });
        }
        return updated;
    }

    /**
     * ✅ فرصت‌های فروش تامین‌کننده — سمت کاتالوگ فروش:
     *    دعوت‌های در انتظار (buyer_add) + درخواست‌های من در انتظار خریدار (supplier_request)
     *    + اعلام خریدهای فوریِ صفحه‌های خریدی که تامین‌کنندهٔ تاییدشده‌شانم (تب «درخواست خریدها»)
     */
    async opportunities(userId: string) {
        const myCatalogs = await this.prisma.catalog.findMany({
            where: {
                status: 'active',
                business: { OR: [{ ownerUserId: userId }, { creatorUserId: userId }] },
            },
            select: { id: true, name: true, slug: true, logoUrl: true },
        });
        const catalogIds = myCatalogs.map((c) => c.id);
        if (catalogIds.length === 0) {
            return { catalogs: [], invitations: [], requests: [], leads: [] };
        }

        const memberships = await this.prisma.inquiryMember.findMany({
            where: { catalogId: { in: catalogIds }, status: { in: ['pending', 'active'] } },
            include: {
                inquiry: {
                    select: {
                        id: true, title: true, slug: true, visibility: true, status: true,
                        city: true, deliveryNote: true, paymentTerms: true, deadline: true,
                        business: { select: { id: true, name: true, logoUrl: true, city: true } },
                        items: { where: { urgent: true }, orderBy: { urgentAt: 'desc' } },
                    },
                },
                user: { select: { id: true, fullName: true } },
            },
        });

        const invitations = memberships
            .filter((m) => m.status === 'pending' && m.via === 'buyer_add' && m.inquiry.status !== 'archived')
            .map((m) => ({
                memberId: m.id,
                inquiry: {
                    id: m.inquiry.id, title: m.inquiry.title, slug: m.inquiry.slug, city: m.inquiry.city,
                    urgentCount: m.inquiry.items.length,
                },
                buyer: m.inquiry.business,
                ownerName: m.user?.fullName || null,
                note: m.note,
                createdAt: m.createdAt,
            }));

        const requests = memberships
            .filter((m) => m.status === 'pending' && m.via === 'supplier_request')
            .map((m) => ({
                memberId: m.id,
                inquiry: { id: m.inquiry.id, title: m.inquiry.title, slug: m.inquiry.slug },
                createdAt: m.createdAt,
            }));

        const leads = memberships
            .filter((m) => m.status === 'active' && m.inquiry.status !== 'archived' && m.inquiry.items.length > 0)
            .map((m) => ({
                memberId: m.id,
                inquiry: {
                    id: m.inquiry.id, title: m.inquiry.title, slug: m.inquiry.slug, city: m.inquiry.city,
                    deliveryNote: m.inquiry.deliveryNote, paymentTerms: m.inquiry.paymentTerms,
                    deadline: m.inquiry.deadline,
                },
                buyer: m.inquiry.business,
                items: m.inquiry.items,
            }));

        return { catalogs: myCatalogs, invitations, requests, leads };
    }
}
