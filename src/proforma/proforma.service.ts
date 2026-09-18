// src/proforma/proforma.service.ts
// 🧾 پیش‌فاکتور — مُهرِ سبک معامله داخل دیمت
//    فروشنده می‌فرستد ← خریدار داخل پلتفرم تایید/رد می‌کند.
//    تایید = پیشنهادِ مبدأ «فروش نهایی شد» می‌شود + پایهٔ شمارش «معامله‌های موفق» اعتماد.
//    هیچ پرداختی در کار نیست — فقط یک سند مشترک که معامله را داخل دیمت ثبت می‌کند.
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { CreateProformaDto } from './proforma.dto';

const PROFORMA_SELECT = {
    id: true,
    number: true,
    sellerUserId: true,
    buyerUserId: true,
    sellerCatalogId: true,
    sellerName: true,
    buyerName: true,
    inquiryId: true,
    inquiryTitle: true,
    offerId: true,
    items: true,
    totalAmount: true,
    currency: true,
    deliveryDays: true,
    notes: true,
    status: true,
    decidedAt: true,
    createdAt: true,
} as const;

@Injectable()
export class ProformaService {
    private readonly logger = new Logger(ProformaService.name);

    constructor(
        private prisma: PrismaService,
        private notification: NotificationService,
    ) {}

    /** شمارهٔ خوانا و قابل ارجاع: PF-YYMM-XXXX */
    private buildNumber(): string {
        const now = new Date();
        const yy = String(now.getFullYear()).slice(2);
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const rand = randomBytes(2).toString('hex').toUpperCase();
        return `PF-${yy}${mm}-${rand}`;
    }

    /** جمع کل از اقلام — هرگز به عددِ کلاینت اعتماد نمی‌کنیم */
    private computeTotal(items: { quantity?: number; unitPrice: number }[]): number {
        return items.reduce((sum, it) => sum + (it.quantity ?? 1) * it.unitPrice, 0);
    }

    async create(userId: string, dto: CreateProformaDto) {
        // ── مبدأ را اول حل کن تا خریدار از روی آن قفل شود ──
        let inquiryId: string | null = dto.inquiryId || null;
        let inquiryTitle: string | null = null;
        let offerId: string | null = null;
        let offerStatus: string | null = null;
        let buyerUserId: string | null = dto.buyerUserId || null;

        if (dto.offerId) {
            const offer = await this.prisma.inquiryOffer.findUnique({
                where: { id: dto.offerId },
                select: { id: true, inquiryId: true, offererUserId: true, status: true, inquiry: { select: { id: true, title: true, ownerUserId: true } } },
            });
            if (!offer) throw new NotFoundException({ errorCode: 'OFFER_NOT_FOUND', message: 'پیشنهاد مبدأ یافت نشد' });
            if (offer.offererUserId !== userId) {
                throw new ForbiddenException({ errorCode: 'NOT_YOUR_OFFER', message: 'فقط فرستندهٔ پیشنهاد می‌تواند برایش پیش‌فاکتور بفرستد' });
            }
            if (offer.status !== 'accepted') {
                throw new BadRequestException({ errorCode: 'OFFER_NOT_ACCEPTED', message: 'پیش‌فاکتور فقط برای پیشنهادِ پذیرفته‌شده معنا دارد' });
            }
            offerId = offer.id;
            offerStatus = offer.status;
            inquiryId = offer.inquiryId;
            inquiryTitle = offer.inquiry?.title ?? null;
            // خریدار = صاحب بازوی خریدِ همان پیشنهاد — کلاینت هیچ‌وقت تصمیم‌گیر نیست
            if (offer.inquiry?.ownerUserId) buyerUserId = offer.inquiry.ownerUserId;
        } else if (inquiryId) {
            const inquiry = await this.prisma.inquiry.findUnique({
                where: { id: inquiryId },
                select: { id: true, title: true, ownerUserId: true },
            });
            if (!inquiry) throw new NotFoundException({ errorCode: 'INQUIRY_NOT_FOUND', message: 'بازوی خرید یافت نشد' });
            inquiryTitle = inquiry.title;
            if (inquiry.ownerUserId) buyerUserId = inquiry.ownerUserId;
        }

        if (!buyerUserId) {
            throw new BadRequestException({ errorCode: 'INVALID_BUYER', message: 'خریدار پیش‌فاکتور مشخص نیست' });
        }
        if (buyerUserId === userId) {
            throw new BadRequestException({ errorCode: 'INVALID_BUYER', message: 'خریدار پیش‌فاکتور نمی‌تواند خودت باشی' });
        }

        const buyer = await this.prisma.user.findUnique({
            where: { id: buyerUserId },
            select: { id: true, fullName: true },
        });
        if (!buyer) throw new BadRequestException({ errorCode: 'INVALID_BUYER', message: 'خریدار یافت نشد' });

        // نام نمایشی خریدار — کسب‌وکارِ اصلی اگر داشت، وگرنه نام خودش
        const buyerBusiness = await this.prisma.business.findFirst({
            where: { OR: [{ ownerUserId: buyerUserId }, { creatorUserId: buyerUserId }] },
            orderBy: { createdAt: 'asc' },
            select: { name: true },
        });
        const buyerName = buyerBusiness?.name || buyer.fullName || 'خریدار';

        // ── بازوی فروشِ صادرکننده — اولین بازوی فروشِ فعالِ فرستنده ──
        const sellerCatalog = await this.prisma.catalog.findFirst({
            where: { ownerUserId: userId, status: 'active' },
            orderBy: { createdAt: 'asc' },
            select: { id: true, name: true },
        });

        if (!inquiryId && !offerId) {
            throw new BadRequestException({ errorCode: 'PROFORMA_SOURCE_REQUIRED', message: 'پیش‌فاکتور باید به یک پیشنهاد یا بازوی خرید وصل باشد' });
        }

        const items = (dto.items || []).map((it) => ({
            name: it.name.trim(),
            quantity: it.quantity ?? 1,
            unit: it.unit?.trim() || null,
            unitPrice: it.unitPrice,
        }));
        const totalAmount = this.computeTotal(items);

        // شمارهٔ یکتا — در برخورد تصادفی چند بار تلاش می‌کنیم
        let number = this.buildNumber();
        for (let i = 0; i < 5; i++) {
            const clash = await this.prisma.proforma.findUnique({ where: { number }, select: { id: true } });
            if (!clash) break;
            number = this.buildNumber();
        }

        const proforma = await this.prisma.proforma.create({
            data: {
                number,
                sellerUserId: userId,
                buyerUserId,
                sellerCatalogId: sellerCatalog?.id ?? null,
                sellerName: sellerCatalog?.name || 'تامین‌کننده',
                buyerName,
                inquiryId,
                inquiryTitle,
                offerId,
                items,
                totalAmount,
                currency: 'IRT',
                deliveryDays: dto.deliveryDays ?? null,
                notes: dto.notes?.trim() || null,
                status: 'sent',
            },
            select: PROFORMA_SELECT,
        });

        // 🔔 خبر به خریدار — با href مستقیم به پیشنهادهای همان بازوی خرید
        // ⚠️ قالب لینک عمیقِ پنل بازوی خرید «?catalog=<id>» است، نه مسیر /my-inquiries/<id>
        const href = inquiryId ? `/my-inquiries?catalog=${inquiryId}&tab=offers` : '/my-inquiries';
        await this.notification.notify({
            userIds: [buyerUserId],
            type: 'proforma_received',
            title: `پیش‌فاکتور ${number} از «${proforma.sellerName}» رسید`,
            body: 'قیمت‌ها و اقلام را ببین و اگر موافقی داخل دیمت تاییدش کن',
            actorUserId: userId,
            href,
        });

        return proforma;
    }

    /** پیش‌فاکتورهای صادرشدهٔ من (فروشنده) */
    async sent(userId: string) {
        return this.prisma.proforma.findMany({
            where: { sellerUserId: userId },
            orderBy: { createdAt: 'desc' },
            take: 100,
            select: PROFORMA_SELECT,
        });
    }

    /** پیش‌فاکتورهای دریافتی من (خریدار) */
    async received(userId: string) {
        return this.prisma.proforma.findMany({
            where: { buyerUserId: userId },
            orderBy: { createdAt: 'desc' },
            take: 100,
            select: PROFORMA_SELECT,
        });
    }

    async getOne(userId: string, id: string) {
        const proforma = await this.prisma.proforma.findUnique({ where: { id }, select: PROFORMA_SELECT });
        if (!proforma) throw new NotFoundException({ errorCode: 'PROFORMA_NOT_FOUND', message: 'پیش‌فاکتور یافت نشد' });
        if (proforma.sellerUserId !== userId && proforma.buyerUserId !== userId) {
            throw new ForbiddenException({ errorCode: 'NOT_PARTY', message: 'این پیش‌فاکتور مال تو نیست' });
        }
        return proforma;
    }

    /** تایید خریدار — معامله داخل دیمت مُهر می‌شود */
    async confirm(userId: string, id: string) {
        const proforma = await this.prisma.proforma.findUnique({ where: { id } });
        if (!proforma) throw new NotFoundException({ errorCode: 'PROFORMA_NOT_FOUND', message: 'پیش‌فاکتور یافت نشد' });
        if (proforma.buyerUserId !== userId) throw new ForbiddenException({ errorCode: 'NOT_BUYER', message: 'فقط خریدار می‌تواند پیش‌فاکتور را تایید کند' });
        if (proforma.status !== 'sent') {
            throw new BadRequestException({ errorCode: 'PROFORMA_DECIDED', message: 'این پیش‌فاکتور قبلاً تکلیفش روشن شده' });
        }

        const updated = await this.prisma.proforma.update({
            where: { id },
            data: { status: 'confirmed', decidedAt: new Date() },
            select: PROFORMA_SELECT,
        });

        // ✅ نتیجهٔ فروشِ پیشنهادِ مبدأ هم خودکار «sold» می‌شود — دیگر لازم نیست فروشنده دستی بزند
        if (proforma.offerId) {
            try {
                await this.prisma.inquiryOffer.updateMany({
                    where: { id: proforma.offerId },
                    data: { saleStatus: 'sold', saleStatusAt: new Date() },
                });
            } catch (err) {
                this.logger.warn(`proforma.confirm offer sync failed: ${err?.message}`);
            }
        }

        await this.notification.notify({
            userIds: [proforma.sellerUserId],
            type: 'proforma_confirmed',
            title: `پیش‌فاکتور ${proforma.number} تایید شد ✅`,
            body: `«${proforma.buyerName}» معامله را داخل دیمت تایید کرد — برای هماهنگی ارسال تماس بگیر`,
            actorUserId: userId,
            // خریدارِ بازوی خرید مالکِ اعلام خرید است؛ مقصد درستِ فروشنده = سرنخ‌های بازوی فروش خودش
            href: proforma.sellerCatalogId
                ? `/my-catalogs?catalog=${proforma.sellerCatalogId}&tab=leads`
                : '/my-catalogs?tab=leads',
        });

        return updated;
    }

    /** رد خریدار */
    async reject(userId: string, id: string) {
        const proforma = await this.prisma.proforma.findUnique({ where: { id } });
        if (!proforma) throw new NotFoundException({ errorCode: 'PROFORMA_NOT_FOUND', message: 'پیش‌فاکتور یافت نشد' });
        if (proforma.buyerUserId !== userId) throw new ForbiddenException({ errorCode: 'NOT_BUYER', message: 'فقط خریدار می‌تواند پیش‌فاکتور را رد کند' });
        if (proforma.status !== 'sent') {
            throw new BadRequestException({ errorCode: 'PROFORMA_DECIDED', message: 'این پیش‌فاکتور قبلاً تکلیفش روشن شده' });
        }

        const updated = await this.prisma.proforma.update({
            where: { id },
            data: { status: 'rejected', decidedAt: new Date() },
            select: PROFORMA_SELECT,
        });

        await this.notification.notify({
            userIds: [proforma.sellerUserId],
            type: 'proforma_rejected',
            title: `پیش‌فاکتور ${proforma.number} تایید نشد`,
            body: 'خریدار این پیش‌فاکتور را نپذیرفت — می‌توانی پیشنهاد جدیدی بدهی',
            actorUserId: userId,
            // مقصد درستِ فروشنده = سرنخ‌های بازوی فروش خودش (اعلام خرید متعلق به خریدار است)
            href: proforma.sellerCatalogId
                ? `/my-catalogs?catalog=${proforma.sellerCatalogId}&tab=leads`
                : '/my-catalogs?tab=leads',
        });

        return updated;
    }

    /** لغو توسط فروشنده — فقط وقتی خریدار هنوز تصمیم نگرفته */
    async cancel(userId: string, id: string) {
        const proforma = await this.prisma.proforma.findUnique({ where: { id } });
        if (!proforma) throw new NotFoundException({ errorCode: 'PROFORMA_NOT_FOUND', message: 'پیش‌فاکتور یافت نشد' });
        if (proforma.sellerUserId !== userId) throw new ForbiddenException({ errorCode: 'NOT_SELLER', message: 'فقط صادرکننده می‌تواند پیش‌فاکتور را لغو کند' });
        if (proforma.status !== 'sent') {
            throw new BadRequestException({ errorCode: 'PROFORMA_DECIDED', message: 'این پیش‌فاکتور قابل لغو نیست' });
        }
        return this.prisma.proforma.update({
            where: { id },
            data: { status: 'canceled', decidedAt: new Date() },
            select: PROFORMA_SELECT,
        });
    }

    /** شمارش «معامله‌های موفق» یک بازوی فروش — مبنای سیگنال اعتماد در پروفایل عمومی */
    async successCountForCatalogs(catalogIds: string[]): Promise<Map<string, number>> {
        if (!catalogIds.length) return new Map();
        const rows = await this.prisma.proforma.groupBy({
            by: ['sellerCatalogId'],
            where: { sellerCatalogId: { in: catalogIds }, status: 'confirmed' },
            _count: { _all: true },
        });
        return new Map(rows.map((r) => [r.sellerCatalogId as string, r._count?._all ?? 0]));
    }
}
