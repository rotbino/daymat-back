// src/match/match.service.ts
// ============================================================
// مچینگ دوطرفهٔ خریدار↔تامین‌کننده — قلبِ «آی‌مچ» دی مچ
//
//   سمت خریدار (بازوی خرید): «فروشندگان این کالا» — کدام بازوهای فروش همین کالا
//   را با قیمت فعال می‌فروشند (تکمیلِ همان منطق supplier-suggestions).
//
//   سمت تامین‌کننده (بازوی فروش): «خریداران این کالا» — کدام بازوهای خرید همین
//   کالا را فعالانه برای قیمت‌گیری خواسته‌اند. ترتیب: هم‌شهری اول، بعد سفارشِ
//   بزرگ‌تر. برآورد ارزش هر سفارش = قیمتِ خودِ فروشنده × حجمِ خریدِ خریدار —
//   همین «حدسِ نادقیق» (به تعبیر مالک) مبنای سطحِ زنجیرهٔ تامین و مصرف اعتبارِ
//   آینده است: سفارشِ بزرگ‌تر = دیده‌شدنِ گران‌تر.
//
//   حریم شماره: هیچ لیستی شماره برنمی‌گرداند؛ شماره فقط با revealContact و با
//   ثبت در دفتر MatchRevealLog داده می‌شود. قانونِ مرجع: موبایلِ ثبت‌نامِ مالک
//   اول، تلفنِ کسب‌وکار مکمل. تا وقتی arms.enforceMatchLimits خاموش است هیچ
//   کاربری محدود نمی‌شود — فقط مصرف ثبت می‌شود تا درآمدزایی بعداً با یک کلید
//   روشن شود و کاربر فعلاً هیچ چیزی از مالی نداند.
// ============================================================
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogAccessService } from '../common/services/catalog-access.service';
import { SettingsService } from '../settings/settings.service';
import { CreditService } from '../credit/credit.service';
import { RevealContactDto } from './match.dto';

/** آستانه‌های سطح سفارش (تومان) — خریدارِ سوپرمارکتی ↔ بنکدار/کارخانه‌ای */
export const TIER_WHOLESALE_MIN = 10_000_000;   // از این به بالا «عمده»
export const TIER_BULK_MIN = 150_000_000;       // از این به بالا «بنکداری/صنعتی»

export function dealTier(value?: number | null): 'retail' | 'wholesale' | 'bulk' | null {
    if (!value || value <= 0) return null;
    if (value >= TIER_BULK_MIN) return 'bulk';
    if (value >= TIER_WHOLESALE_MIN) return 'wholesale';
    return 'retail';
}

/** اعتبارِ مصرفی هر افشا از روی ارزش برآوردی سفارش — سقف ۲۰، کف ۱ */
export function creditsForValue(value?: number | null): number {
    if (!value || value <= 0) return 1;
    return Math.max(1, Math.min(20, Math.round(value / TIER_BULK_MIN)));
}

@Injectable()
export class MatchService {
    constructor(
        private prisma: PrismaService,
        private catalogAccess: CatalogAccessService,
        private settings: SettingsService,
        private credit: CreditService,
    ) {}

    // ────────────────────────────────────────────────────────────
    // ۱) شمارش خریدارانِ هر کالای یک بازوی فروش — برای چیپِ «خریداران این کالا (n)»
    //    یک کوئری برای همهٔ کالاهای بازوی فروش؛ اگر n=۰ بود لینک اصلا دیده نمی‌شود.
    // ────────────────────────────────────────────────────────────
    async buyerCountsForCatalog(catalogId: string, userId: string) {
        await this.catalogAccess.assertCanManageCatalog(catalogId, userId, {
            errorCode: 'CATALOG_FORBIDDEN',
            message: 'شما اجازه مدیریت این بازوی فروش را ندارید',
        });

        // کالاهای بازوی فروشِ مدیر — فقط کالاهایی که به کالای مرجع وصل‌اند قابل مچ‌اند
        const ads = await this.prisma.ad.findMany({
            where: { catalogId, productReferenceId: { not: null } },
            select: { id: true, productReferenceId: true },
        });
        if (!ads.length) return { counts: {}, total: 0 };

        const refIds = Array.from(new Set(ads.map((a) => a.productReferenceId!)));

        // قلم‌های فعالِ قیمت‌گیری که کالای مرجعشان یکی از این‌هاست — بازوی خریدِ بازِ دیگران
        const items = await this.prisma.inquiryItem.findMany({
            where: {
                urgent: true,
                referenceItemId: { in: refIds },
                inquiry: { status: 'open', ownerUserId: { not: userId } },
            },
            select: { referenceItemId: true },
            take: 5000,
        });

        const countByRef = new Map<string, number>();
        for (const it of items) {
            if (!it.referenceItemId) continue;
            countByRef.set(it.referenceItemId, (countByRef.get(it.referenceItemId) ?? 0) + 1);
        }

        const counts: Record<string, number> = {};
        let total = 0;
        for (const ad of ads) {
            const n = countByRef.get(ad.productReferenceId!) ?? 0;
            if (n > 0) {
                counts[ad.id] = n;
                total += n;
            }
        }
        return { counts, total };
    }

    // ────────────────────────────────────────────────────────────
    // ۲) خریدارانِ یک کالای بازوی فروش — مدالِ «خریداران این کالا»
    //    هم‌شهری‌ها اول، بعد سفارشِ بزرگ‌تر (برآورد ارزش = قیمتِ خودِ فروشنده × حجم خریدار)
    // ────────────────────────────────────────────────────────────
    async buyersForAd(adId: string, userId: string) {
        const ad = await this.prisma.ad.findUnique({
            where: { id: adId },
            select: {
                id: true, catalogId: true, productReferenceId: true, unitPrice: true,
                title: true, productType: true, cityCode: true, city: true,
                unit: { select: { title: true, shortCode: true } },
            },
        });
        if (!ad) throw new NotFoundException({ errorCode: 'AD_NOT_FOUND', message: 'کالا یافت نشد' });

        await this.catalogAccess.assertCanManageCatalog(ad.catalogId, userId, {
            errorCode: 'CATALOG_FORBIDDEN',
            message: 'شما اجازه مدیریت این بازوی فروش را ندارید',
        });

        if (!ad.productReferenceId) {
            return { ad: { id: ad.id, title: ad.productType || ad.title }, buyers: [], buyersCount: 0 };
        }

        // قلم‌های در حال قیمت‌گیریِ همین کالای مرجع + بازوی خریدِ بازِ صاحبشان
        const items = await this.prisma.inquiryItem.findMany({
            where: {
                urgent: true,
                referenceItemId: ad.productReferenceId,
                inquiry: { status: 'open', ownerUserId: { not: userId } },
            },
            orderBy: { urgentAt: 'desc' },
            take: 40,
            select: {
                id: true, quantity: true, unit: true, urgentAt: true,
                inquiry: {
                    select: {
                        id: true, title: true, city: true, cityCode: true,
                        showContactPhone: true,
                        owner: { select: { fullName: true } },
                        business: { select: { name: true } },
                    },
                },
            },
        });
        if (!items.length) {
            return { ad: { id: ad.id, title: ad.productType || ad.title }, buyers: [], buyersCount: 0 };
        }

        // عضویتِ موجود این بازوی فروش در آن بازوهای خرید — تکرارِ آشنا برای کاربر شلوغی است
        const inquiryIds = Array.from(new Set(items.map((i) => i.inquiry.id)));
        const memberships = await this.prisma.inquiryMember.findMany({
            where: { inquiryId: { in: inquiryIds }, catalogId: ad.catalogId, status: { in: ['pending', 'active'] } },
            select: { inquiryId: true, status: true },
        });
        const memberByInquiry = new Map(memberships.map((m) => [m.inquiryId, m.status]));

        const buyers = items
            .map((it) => {
                const estimatedValue =
                    ad.unitPrice && it.quantity ? ad.unitPrice * it.quantity : null;
                const inquiry = it.inquiry;
                return {
                    inquiryId: inquiry.id,
                    itemId: it.id,
                    inquiryTitle: inquiry.title,
                    buyerName: inquiry.owner?.fullName ?? null,
                    businessName: inquiry.business?.name ?? null,
                    city: inquiry.city ?? null,
                    sameCity: !!(ad.cityCode && inquiry.cityCode && ad.cityCode === inquiry.cityCode),
                    quantity: it.quantity ?? null,
                    unitTitle: it.unit ?? ad.unit?.title ?? null,
                    estimatedValue,
                    tier: dealTier(estimatedValue),
                    memberStatus: memberByInquiry.get(inquiry.id) ?? null,
                    // حریم خریدار: اگر تماسِ مستقیم را بسته باشد، دکمهٔ تماس اصلا رندر نمی‌شود
                    contactAllowed: inquiry.showContactPhone !== false,
                    urgentAt: it.urgentAt ?? null,
                };
            })
            .sort((a, b) =>
                (b.sameCity ? 1 : 0) - (a.sameCity ? 1 : 0) ||
                (b.estimatedValue ?? 0) - (a.estimatedValue ?? 0),
            )
            .slice(0, 20);

        return { ad: { id: ad.id, title: ad.productType || ad.title }, buyers, buyersCount: buyers.length };
    }

    // ────────────────────────────────────────────────────────────
    // ۳) افشای شمارهٔ تماس با ثبت در دفتر MatchRevealLog
    //    درآمدزایی هر دو از جیب تامین‌کننده است (خواستهٔ مالک):
    //    - شمارهٔ فروشنده برای خریدار: همیشه رایگان
    //    - شمارهٔ خریدار برای تامین‌کننده: ۳ برداشتِ رایگانِ روزانه، بعد اعتبار —
    //      اما فقط وقتی ادمین enforceMatchLimits را روشن کرده باشد.
    // ────────────────────────────────────────────────────────────
    async revealContact(userId: string, dto: RevealContactDto) {
        const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);

        let phone: string | null = null;
        let estimatedValue: number | null = null;
        let metered = false; // آیا این سمت مشمول سهمیه/اعتبار است؟ (فقط سمتِ خریدار برای تامین‌کننده)

        if (dto.side === 'seller') {
            // خریدار شمارهٔ بازوی فروش را برمی‌دارد
            if (!dto.catalogId) throw new BadRequestException({ errorCode: 'CATALOG_REQUIRED', message: 'بازوی فروش مقصد مشخص نیست' });
            const catalog = await this.prisma.catalog.findUnique({
                where: { id: dto.catalogId },
                select: { id: true, status: true, phone: true, owner: { select: { phone: true } } },
            });
            if (!catalog || catalog.status !== 'active') {
                throw new NotFoundException({ errorCode: 'CATALOG_NOT_FOUND', message: 'بازوی فروش یافت نشد' });
            }
            // قانون مرجع تماس: تلفن بازوی فروش، در نبودش موبایلِ ثبت‌نامِ مالک
            phone = catalog.phone || catalog.owner?.phone || null;
        } else {
            // تامین‌کننده شمارهٔ صاحب بازوی خرید را برمی‌دارد
            if (!dto.inquiryId) throw new BadRequestException({ errorCode: 'INQUIRY_REQUIRED', message: 'بازوی خرید مقصد مشخص نیست' });
            const inquiry = await this.prisma.inquiry.findUnique({
                where: { id: dto.inquiryId },
                select: {
                    id: true, status: true, showContactPhone: true,
                    owner: { select: { phone: true } },
                    business: { select: { phone: true } },
                },
            });
            if (!inquiry || inquiry.status !== 'open') {
                throw new NotFoundException({ errorCode: 'INQUIRY_NOT_FOUND', message: 'بازوی خرید یافت نشد' });
            }
            if (inquiry.showContactPhone === false) {
                throw new ForbiddenException({ errorCode: 'CONTACT_HIDDEN', message: 'این خریدار تماس مستقیم را بسته — پیشنهادتان را از طریق درخواست تامین ثبت کنید' });
            }
            // قانون مرجع تماسِ خریدار: موبایلِ ثبت‌نامِ مالک اول، تلفن کسب‌وکار مکمل
            phone = inquiry.owner?.phone || inquiry.business?.phone || null;
            metered = true;
        }

        if (!phone) throw new NotFoundException({ errorCode: 'PHONE_NOT_FOUND', message: 'شمارهٔ تماسی برای این کاربر ثبت نشده' });

        // برآورد ارزش معامله — برای مصرفِ اعتبارِ پلکانیِ آینده
        if (dto.adId && dto.itemId) {
            const [adRow, itemRow] = await Promise.all([
                this.prisma.ad.findUnique({ where: { id: dto.adId }, select: { unitPrice: true } }),
                this.prisma.inquiryItem.findUnique({ where: { id: dto.itemId }, select: { quantity: true } }),
            ]);
            if (adRow?.unitPrice && itemRow?.quantity) estimatedValue = adRow.unitPrice * itemRow.quantity;
        }

        // سهمیهٔ روزانه + اعتبار — تا وقتی enforce خاموش است فقط شمارشِ بی‌صدا
        const enforce = (await this.settings.get('arms.enforceMatchLimits', { defaultValue: false })) === true;
        const freeDaily = (await this.settings.get('arms.matchFreeRevealsDaily', { defaultValue: 3 })) as number;
        const maxDaily = (await this.settings.get('arms.matchMaxRevealsDaily', { defaultValue: 10 })) as number;

        const usedToday = await this.prisma.matchRevealLog.count({ where: { userId, createdAt: { gte: startOfDay } } });

        let isFree = true;
        let creditCost = 0;

        if (enforce && metered) {
            if (usedToday >= maxDaily) {
                throw new BadRequestException({
                    errorCode: 'DAILY_LIMIT_REACHED',
                    message: `سقف روزانه (${maxDaily}) پر شده — فردا دوباره می‌توانید ادامه دهید`,
                });
            }
            if (usedToday >= freeDaily) {
                creditCost = creditsForValue(estimatedValue);
                isFree = false;
                await this.credit.spendCredit(
                    userId, undefined, creditCost, 'match_reveal',
                    'معرفی خریدار از مچینگ کالا',
                    dto.inquiryId, 'inquiry',
                );
            }
        }

        await this.prisma.matchRevealLog.create({
            data: {
                userId,
                side: dto.side,
                catalogId: dto.catalogId ?? null,
                inquiryId: dto.inquiryId ?? null,
                adId: dto.adId ?? null,
                itemId: dto.itemId ?? null,
                productReferenceId: dto.productReferenceId ?? null,
                estimatedValue,
                isFree,
                creditCost,
            },
        });

        return {
            phone,
            isFree,
            creditCost,
            usedToday: usedToday + 1,
            freeDaily,
            maxDaily,
        };
    }
}
