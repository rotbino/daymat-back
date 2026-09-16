// src/contact/contact.service.ts
// 📱 دفترچهٔ مخاطبین کاربر — کشف ارتباطات + اشتراک‌گذاری مستقیم
//    • sync: نرمال‌سازی شماره‌ها → حذف تکراری → تطبیق با کاربران ثبت‌نام‌شدهٔ دیمت → ذخیره
//    • list: جستجو با نام/شماره + اطلاعات کاربرِ تطبیق‌یافته (آواتار/نام در دیمت)
//    • کشف ارتباطات: matchedUserId نشان می‌دهد این شماره در دیمت عضو است —
//      خوراکِ آیندهٔ پیشنهادها (مثلاً «۳ نفر از مخاطبینت در دیمت هستند»)
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessService } from '../business/business.service';
import { SyncContactsDto } from './contact.dto';

const MAX_CONTACTS_PER_USER = 2000;
const MAX_MATCH_BATCH = 500; // شماره در هر کوئری تطبیق — سقف امن $in

function chunk<T>(arr: T[], n: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
}

@Injectable()
export class ContactService {
    private readonly logger = new Logger(ContactService.name);

    constructor(private prisma: PrismaService) {}

    /**
     * همگام‌سازی مخاطبین گوشی کاربر — هر بار که کاربر اجازه بدهد مخاطبین خوانده شود
     * Idempotent است: هم‌نام‌ها آپدیت، تکراری‌ها نادیده، شمارهٔ نامعتبر دور ریخته می‌شود
     */
    async sync(userId: string, dto: SyncContactsDto) {
        const raw = (dto?.contacts || []).filter((c) => c && typeof c.phone === 'string');
        if (!raw.length) {
            return { saved: 0, created: 0, updated: 0, invalid: 0, matched: 0, total: await this.countOwned(userId) };
        }

        // ۱) نرمال‌سازی + حذف تکراری داخل دسته — اولین نامِ غیرخالی برنده است
        const byPhone = new Map<string, string | null>();
        let invalid = 0;
        for (const item of raw) {
            const phone = BusinessService.normalizePhone(item.phone);
            if (!phone) { invalid++; continue; }
            const name = (item.name || '').trim().slice(0, 120) || null;
            if (!byPhone.has(phone)) byPhone.set(phone, name);
            else if (!byPhone.get(phone) && name) byPhone.set(phone, name);
        }

        // ۲) سقف دفترچه — اگر جا نبود، فقط به اندازهٔ جا می‌گیریم (اولویت با شماره‌های جدید)
        const existingTotal = await this.countOwned(userId);
        const room = Math.max(0, MAX_CONTACTS_PER_USER - existingTotal);
        let phones = Array.from(byPhone.keys());
        const skippedByCap = Math.max(0, phones.length - room);
        if (skippedByCap > 0) phones = phones.slice(0, room);

        if (!phones.length) {
            return { saved: 0, created: 0, updated: 0, invalid, matched: await this.countMatched(userId), total: existingTotal, skippedByCap };
        }

        // ۳) تطبیق با کاربران دیمت — کشف ارتباطات (دسته‌بندی‌شده برای کوئری‌های $in بزرگ)
        const matchMap = new Map<string, string>();
        for (const grp of chunk(phones, MAX_MATCH_BATCH)) {
            const users = await this.prisma.user.findMany({
                where: { phone: { in: grp } },
                select: { id: true, phone: true },
            });
            for (const u of users) matchMap.set(u.phone, u.id);
        }

        // ۴) ردیف‌های موجودِ همین شماره‌ها
        const existingRows = await this.prisma.userContact.findMany({
            where: { ownerId: userId, phone: { in: phones } },
            select: { id: true, phone: true, name: true, matchedUserId: true },
        });
        const existingMap = new Map(existingRows.map((r) => [r.phone, r]));

        const toCreate = phones.filter((p) => !existingMap.has(p));
        const toUpdate = phones.filter((p) => existingMap.has(p));

        // ۵) ساخت دسته‌ای جدیدها
        for (const grp of chunk(toCreate, 100)) {
            await this.prisma.userContact.createMany({
                data: grp.map((phone) => ({
                    ownerId: userId,
                    phone,
                    name: byPhone.get(phone) || null,
                    matchedUserId: matchMap.get(phone) || null,
                })),
            });
        }

        // ۶) آپدیت نام/تطبیقِ قبلی‌ها — فقط اگر واقعاً عوض شده (تطبیقِ دیرهنگامِ تازه‌ثبت‌نام‌کرده‌ها هم همین‌جا جور می‌شود)
        let updated = 0;
        for (const grp of chunk(toUpdate, 40)) {
            await Promise.all(grp.map(async (phone) => {
                const row = existingMap.get(phone)!;
                const newName = byPhone.get(phone);
                const newMatch = matchMap.get(phone) || null;
                const data: { name?: string; matchedUserId?: string | null; updatedAt?: Date } = {};
                if (newName && newName !== row.name) data.name = newName;
                if (newMatch && newMatch !== row.matchedUserId) data.matchedUserId = newMatch;
                if (!Object.keys(data).length) return;
                await this.prisma.userContact.updateMany({ where: { id: row.id, ownerId: userId }, data });
                updated++;
            }));
        }

        return {
            saved: toCreate.length + updated,
            created: toCreate.length,
            updated,
            invalid,
            skippedByCap,
            matched: await this.countMatched(userId),
            total: await this.countOwned(userId),
        };
    }

    /** دفترچهٔ من — جستجو با نام یا شماره + اطلاعاتِ دیمتِ مخاطب‌های تطبیق‌یافته */
    async list(userId: string, q?: string, limit = 500, offset = 0) {
        const where: { ownerId: string; OR?: object[] } = { ownerId: userId };
        const term = (q || '').trim();
        if (term) {
            const normPhone = BusinessService.normalizePhone(term);
            const digits = term.replace(/[^۰-۹٠-٩\d]/g, '');
            const or: object[] = [{ name: { contains: term } }];
            if (normPhone) or.push({ phone: { contains: normPhone } });
            else if (digits) {
                // جستجوی شمارهٔ نیمه — اعداد فارسی/عربی هم لاتین می‌شوند
                const latin = digits
                    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
                    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
                if (latin) or.push({ phone: { contains: latin } });
            }
            where.OR = or;
        }

        const [items, total, matchedCount] = await Promise.all([
            this.prisma.userContact.findMany({
                where,
                orderBy: [{ createdAt: 'desc' }],
                take: Math.min(Math.max(Number(limit) || 500, 1), 500),
                skip: Math.max(Number(offset) || 0, 0),
                select: {
                    id: true, name: true, phone: true, matchedUserId: true, createdAt: true,
                    matchedUser: {
                        select: {
                            id: true, fullName: true, avatarUrl: true,
                            // ✅ همهٔ کسب‌وکارهای فعالِ عضو — مخاطب ممکن است عضو چند کسب‌وکار باشد
                            //    (مالک ده تا کسب‌وکار بی‌ربط می‌تواند داشته باشد — هر کدام خریدار جداگانه‌اند)
                            teamMemberships: {
                                where: { status: 'active' },
                                select: {
                                    position: true,
                                    business: {
                                        select: { id: true, name: true, logoUrl: true, city: true, ownerUserId: true, creatorUserId: true },
                                    },
                                },
                            },
                            // کاتالوگِ فعالِ عضو — مقصدِ «درخواست تامین» در بازوی خرید
                            catalogsOwned: {
                                where: { status: 'active' },
                                select: { id: true, name: true, slug: true, logoUrl: true, city: true, salesType: true },
                                orderBy: { createdAt: 'desc' },
                                take: 1,
                            },
                        },
                    },
                },
            }),
            this.prisma.userContact.count({ where }),
            this.countMatched(userId),
        ]);

        // ✅ بازوهای خریدِ کسب‌وکارها (Inquiry.businessId) — یک کوئری دسته‌ای برای همهٔ مخاطبین
        const bizIds = Array.from(new Set(items.flatMap((it) =>
            (it.matchedUser?.teamMemberships || []).map((m: any) => m.business?.id).filter(Boolean),
        ))) as string[];
        const armsByBiz = new Map<string, { id: string; title: string; status: string }[]>();
        if (bizIds.length) {
            const arms = await this.prisma.inquiry.findMany({
                where: { businessId: { in: bizIds }, status: { not: 'archived' } },
                select: { id: true, title: true, businessId: true, status: true },
                orderBy: { createdAt: 'desc' },
            });
            for (const a of arms) {
                if (!a.businessId) continue;
                const list = armsByBiz.get(a.businessId) ?? [];
                list.push({ id: a.id, title: a.title, status: a.status });
                armsByBiz.set(a.businessId, list);
            }
        }

        // تخت‌سازی: business/businesses/catalog مستقیم روی matchedUser می‌نشینند تا فرانت ساده بخواند
        const flat = items.map((it) => {
            if (it.matchedUser) {
                const mu: any = { ...it.matchedUser };
                const memberships = (mu.teamMemberships || []) as any[];
                mu.businesses = memberships
                    .filter((m) => m.business)
                    .map((m) => ({
                        id: m.business.id,
                        name: m.business.name,
                        logoUrl: m.business.logoUrl || null,
                        city: m.business.city || null,
                        // نقشِ مخاطب در این کسب‌وکار — مالک (سازنده/دارنده) یا عضو با پستِ نمایشی
                        isOwner: m.business.ownerUserId === mu.id || m.business.creatorUserId === mu.id,
                        position: m.position || null,
                        arms: armsByBiz.get(m.business.id) || [],
                    }));
                mu.business = mu.businesses[0] ?? null;
                mu.catalog = mu.catalogsOwned?.[0] ?? null;
                delete mu.teamMemberships;
                delete mu.catalogsOwned;
                return { ...it, matchedUser: mu };
            }
            return it;
        });

        return { items: flat, total, matchedCount };
    }

    /** خلاصهٔ دفترچه — برای بج/هدر پنل مخاطبین */
    async stats(userId: string) {
        const [total, matched] = await Promise.all([this.countOwned(userId), this.countMatched(userId)]);
        return { total, matched };
    }

    /** حذف یک مخاطب از دفترچهٔ من — حریم خصوصی: فقط صاحب دفترچه */
    async remove(userId: string, id: string) {
        const res = await this.prisma.userContact.deleteMany({ where: { id, ownerId: userId } });
        return { success: true, deleted: res.count };
    }

    private countOwned(userId: string) {
        return this.prisma.userContact.count({ where: { ownerId: userId } });
    }

    private countMatched(userId: string) {
        return this.prisma.userContact.count({ where: { ownerId: userId, matchedUserId: { not: null } } });
    }
}
