// src/inquiry/inquiry.service.ts
// کاتالوگ خرید (استعلام قیمت) — سرویس
import {
    Injectable, NotFoundException, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInquiryDto, UpdateInquiryDto, CreateOfferDto, UpdateOfferDto, InquiryItemDto } from './inquiry.dto';

const RESERVED_SLUGS = [
    'admin', 'api', 'login', 'logout', 'register', 'my-catalogs', 'my-inquiries',
    'inquiries', 'catalogs', 'business', 'profile', 'market', 'markets', 'home',
    'docs', 'assets', 'static', 'new', 'explore', 'saved-ads', 'notifications', 'credit',
];

const PUBLIC_LIST_SELECT = {
    id: true, title: true, description: true, slug: true, status: true,
    deadline: true, city: true, province: true, tags: true,
    viewCount: true, offerCount: true, createdAt: true,
    owner: { select: { id: true, fullName: true, avatarUrl: true } },
    business: { select: { id: true, name: true, logoUrl: true } },
    _count: { select: { items: true } },
};

@Injectable()
export class InquiryService {
    constructor(private prisma: PrismaService) {}

    private isValidObjectId(id?: string): boolean {
        return !!id && /^[0-9a-fA-F]{24}$/.test(id);
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
                quantity: typeof i.quantity === 'number' ? i.quantity : null,
                unit: i.unit?.trim() || null,
                brand: i.brand?.trim() || null,
                specs: Array.isArray(i.specs) && i.specs.length ? i.specs : undefined,
                imageUrl: i.imageUrl?.trim() || null,
                referenceUrl: i.referenceUrl?.trim() || null,
                note: i.note?.trim() || null,
                order: idx,
            }));
    }

    // ─── ساخت ───
    async create(userId: string, dto: CreateInquiryDto) {
        if (dto.businessId && !this.isValidObjectId(dto.businessId)) {
            throw new BadRequestException({ errorCode: 'INVALID_BUSINESS', message: 'شناسه کسب‌وکار نامعتبر است' });
        }
        if (dto.businessId) {
            const biz = await this.prisma.business.findFirst({
                where: { id: dto.businessId, ownerUserId: userId }, select: { id: true },
            });
            if (!biz) throw new ForbiddenException({ errorCode: 'NOT_YOUR_BUSINESS', message: 'این کسب‌وکار متعلق به شما نیست' });
        }
        const items = this.cleanItems(dto.items);
        if (items.length === 0) {
            throw new BadRequestException({ errorCode: 'EMPTY_ITEMS', message: 'حداقل یک قلم خرید لازم است' });
        }
        const slug = await this.buildUniqueSlug(dto.title, dto.slug);
        const { items: _drop, slug: _s, ...data } = dto;
        const inquiry = await this.prisma.inquiry.create({
            data: {
                ...data,
                deadline: dto.deadline ? new Date(dto.deadline) : null,
                ownerUserId: userId,
                slug,
                items: { create: items },
            },
            include: { items: { orderBy: { order: 'asc' } } },
        });
        return inquiry;
    }

    // ─── دیوار عمومی (فهرست کاتالوگ‌های خرید باز) ───
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

    // ─── کاتالوگ‌های خرید من ───
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
            throw new NotFoundException({ errorCode: 'INQUIRY_NOT_FOUND', message: 'کاتالوگ خرید پیدا نشد' });
        }
        const isOwner = !!userId && userId === inquiry.ownerUserId;

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

        return { ...inquiry, isOwner: false };
    }

    // ─── ویرایش (مالک) ───
    async update(id: string, userId: string, dto: UpdateInquiryDto) {
        const inquiry = await this.prisma.inquiry.findUnique({ where: { id } });
        if (!inquiry) throw new NotFoundException({ errorCode: 'INQUIRY_NOT_FOUND', message: 'کاتالوگ خرید پیدا نشد' });
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
        const { items, slug, deadline, ...rest } = dto;
        const data: any = { ...rest };
        if (slug) data.slug = this.normalizeSlug(slug);
        if (deadline !== undefined) data.deadline = deadline ? new Date(deadline) : null;

        return this.prisma.$transaction(async (tx) => {
            // اگر اقلام ارسال شده → جایگزینی کامل (ساده و قطعی)
            if (Array.isArray(items)) {
                const cleaned = this.cleanItems(items);
                if (cleaned.length === 0) {
                    throw new BadRequestException({ errorCode: 'EMPTY_ITEMS', message: 'حداقل یک قلم خرید لازم است' });
                }
                await tx.inquiryItem.deleteMany({ where: { inquiryId: id } });
                await tx.inquiryItem.createMany({ data: cleaned.map((c) => ({ ...c, inquiryId: id })) });
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
        if (!inquiry) throw new NotFoundException({ errorCode: 'INQUIRY_NOT_FOUND', message: 'کاتالوگ خرید پیدا نشد' });
        if (inquiry.ownerUserId !== userId) {
            throw new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'اجازهٔ حذف ندارید' });
        }
        await this.prisma.inquiry.delete({ where: { id } });
        return { message: 'کاتالوگ خرید حذف شد' };
    }

    // ─── ثبت پیشنهاد قیمت (تامین‌کننده) ───
    async addOffer(inquiryId: string, userId: string, dto: CreateOfferDto) {
        const inquiry = await this.prisma.inquiry.findUnique({ where: { id: inquiryId } });
        if (!inquiry || inquiry.status === 'archived') {
            throw new NotFoundException({ errorCode: 'INQUIRY_NOT_FOUND', message: 'کاتالوگ خرید پیدا نشد' });
        }
        if (inquiry.status !== 'open') {
            throw new BadRequestException({ errorCode: 'INQUIRY_CLOSED', message: 'این استعلام بسته شده است' });
        }
        if (inquiry.deadline && inquiry.deadline < new Date()) {
            throw new BadRequestException({ errorCode: 'DEADLINE_PASSED', message: 'مهلت ارسال پیشنهاد گذشته است' });
        }
        if (inquiry.ownerUserId === userId) {
            throw new BadRequestException({ errorCode: 'OWN_INQUIRY', message: 'روی کاتالوگ خرید خودتان نمی‌توانید پیشنهاد بدهید' });
        }
        if (dto.itemId && !this.isValidObjectId(dto.itemId)) {
            throw new BadRequestException({ errorCode: 'INVALID_ITEM', message: 'قلم نامعتبر است' });
        }
        if (dto.itemId) {
            const item = await this.prisma.inquiryItem.findFirst({ where: { id: dto.itemId, inquiryId } });
            if (!item) throw new BadRequestException({ errorCode: 'INVALID_ITEM', message: 'قلم یافت نشد' });
        }
        if (dto.businessId) {
            if (!this.isValidObjectId(dto.businessId)) {
                throw new BadRequestException({ errorCode: 'INVALID_BUSINESS', message: 'شناسه کسب‌وکار نامعتبر است' });
            }
            const biz = await this.prisma.business.findFirst({
                where: { id: dto.businessId, ownerUserId: userId }, select: { id: true },
            });
            if (!biz) throw new ForbiddenException({ errorCode: 'NOT_YOUR_BUSINESS', message: 'این کسب‌وکار متعلق به شما نیست' });
        }
        const { itemId, ...rest } = dto;
        const offer = await this.prisma.inquiryOffer.create({
            data: { ...rest, inquiryId, itemId: itemId || null, offererUserId: userId },
        });
        await this.prisma.inquiry.update({ where: { id: inquiryId }, data: { offerCount: { increment: 1 } } });
        return offer;
    }

    // ─── پیشنهادهای یک استعلام (فقط مالک) ───
    async getOffers(inquiryId: string, userId: string) {
        const inquiry = await this.prisma.inquiry.findUnique({ where: { id: inquiryId } });
        if (!inquiry) throw new NotFoundException({ errorCode: 'INQUIRY_NOT_FOUND', message: 'کاتالوگ خرید پیدا نشد' });
        if (inquiry.ownerUserId !== userId) {
            throw new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'فقط صاحب کاتالوگ خرید پیشنهادها را می‌بیند' });
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
                throw new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'فقط صاحب کاتالوگ خرید می‌تواند تصمیم بگیرد' });
            }
        }
        const updated = await this.prisma.inquiryOffer.update({ where: { id: offerId }, data: { status: dto.status } });
        if (dto.status === 'withdrawn') {
            await this.prisma.inquiry.update({ where: { id: offer.inquiryId }, data: { offerCount: { decrement: 1 } } });
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
}
