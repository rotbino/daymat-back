// scripts/match_e2e_run.cjs — تست E2E کامل مچینگ دوطرفه با توکن واقعی هر طرف + پاکسازی لاگ تست
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');

const prisma = new PrismaClient();
const JWT_SECRET = 'daymat-local-build-secret';
const BASE = 'http://localhost:3011';

async function api(method, path, token, body) {
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
}

(async () => {
    try {
        const catalog = await prisma.catalog.findFirst({
            where: { status: 'active', ads: { some: { productReferenceId: { not: null } } } },
            include: { owner: { select: { id: true, tokenVersion: true, phone: true, fullName: true } }, business: { select: { name: true, phone: true } }, ads: { where: { productReferenceId: { not: null } } } },
        });
        const inquiry = await prisma.inquiry.findFirst({
            where: { status: 'open', items: { some: { urgent: true } } },
            include: { owner: { select: { id: true, tokenVersion: true, phone: true, fullName: true } }, business: { select: { name: true, phone: true } }, items: { where: { urgent: true } } },
        });
        if (!catalog || !inquiry) throw new Error('MISSING DATA');

        const sellerToken = jwt.sign({ sub: catalog.ownerUserId, tv: catalog.owner.tokenVersion ?? 0 }, JWT_SECRET);
        const buyerToken = jwt.sign({ sub: inquiry.ownerUserId, tv: inquiry.owner.tokenVersion ?? 0 }, JWT_SECRET);

        const shared = inquiry.items.find((i) => i.referenceItemId === catalog.ads.find((a) => a.productReferenceId === i.referenceItemId)?.id);
        const sharedRefId = inquiry.items.map((i) => i.referenceItemId).find((r) => catalog.ads.some((a) => a.productReferenceId === r));
        const sharedAd = catalog.ads.find((a) => a.productReferenceId === sharedRefId);
        const sharedItem = inquiry.items.find((i) => i.referenceItemId === sharedRefId);
        console.log('== دادهٔ تست ==');
        console.log('seller:', catalog.owner.fullName || catalog.ownerUserId, '| catalog:', catalog.id, '| ad:', sharedAd?.id, 'price:', sharedAd?.unitPrice);
        console.log('buyer :', inquiry.owner.fullName || inquiry.ownerUserId, '| inquiry:', inquiry.id, '| item:', sharedItem?.id, 'qty:', sharedItem?.quantity);

        // ۱) شمارش خریداران برای فروشنده
        const counts = await api('GET', `/match/catalog/${catalog.id}/buyer-counts`, sellerToken);
        console.log('\n1) buyer-counts:', counts.status, JSON.stringify(counts.json));

        // ۲) خریدارانِ کالا
        const buyers = await api('GET', `/match/ad/${sharedAd.id}/buyers`, sellerToken);
        console.log('\n2) ad-buyers:', buyers.status, JSON.stringify(buyers.json, null, 1).slice(0, 700));

        // ۳) افشای شمارهٔ خریدار برای فروشنده (رایگان — enforce خاموش)
        const revBuyer = await api('POST', '/match/reveal', sellerToken, {
            side: 'buyer', inquiryId: inquiry.id, adId: sharedAd.id, itemId: sharedItem?.id, productReferenceId: sharedRefId,
        });
        console.log('\n3) reveal buyer->seller:', revBuyer.status, JSON.stringify(revBuyer.json));
        console.log('   انتظار شماره:', inquiry.owner.phone || inquiry.business?.phone);

        // ۴) افشای شمارهٔ فروشنده برای خریدار (همیشه رایگان)
        const revSeller = await api('POST', '/match/reveal', buyerToken, { side: 'seller', catalogId: catalog.id });
        console.log('\n4) reveal seller->buyer:', revSeller.status, JSON.stringify(revSeller.json));
        console.log('   انتظار شماره:', catalog.phone || catalog.owner.phone);

        // ۵) گاردها: خریدار اجازه شمارشِ بازوی فروش خودش را ندارد؛ مالک دیگری هم نه
        const forbidden = await api('GET', `/match/catalog/${catalog.id}/buyer-counts`, buyerToken);
        console.log('\n5) buyer-counts با توکن غیرمدیر:', forbidden.status, '(انتظار 403)');

        // ۶) لاگ‌های ثبت‌شده + پاکسازی ردیف‌های تست
        const logs = await prisma.matchRevealLog.findMany({ where: { userId: { in: [catalog.ownerUserId, inquiry.ownerUserId] } }, orderBy: { createdAt: 'desc' }, take: 5 });
        console.log('\n6) matchRevealLog rows:', logs.length, logs.map((l) => `${l.side}/free=${l.isFree}/cost=${l.creditCost}/val=${l.estimatedValue}`));
        const del = await prisma.matchRevealLog.deleteMany({ where: { userId: { in: [catalog.ownerUserId, inquiry.ownerUserId] } } });
        console.log('   پاکسازی:', del.count, 'ردیف تست حذف شد');

        await prisma.$disconnect();
    } catch (e) {
        console.error('ERR', e);
        await prisma.$disconnect();
        process.exit(1);
    }
})();
