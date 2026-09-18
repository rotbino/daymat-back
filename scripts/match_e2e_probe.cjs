// scripts/match_e2e_probe.cjs — تست دودیِ مچینگ دوطرفه روی دیتای واقعی (بدون ساخت دادهٔ ساختگی اگر نبود)
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');

const prisma = new PrismaClient();
const JWT_SECRET = 'daymat-local-build-secret';

(async () => {
    try {
        // ۱) یک کاربر صاحب بازوی فروش با کالای مرجع‌دار پیدا کن
        const catalog = await prisma.catalog.findFirst({
            where: { status: 'active', ads: { some: { productReferenceId: { not: null } } } },
            select: { id: true, name: true, ownerUserId: true, phone: true, ads: { where: { productReferenceId: { not: null } }, select: { id: true, productReferenceId: true, unitPrice: true }, take: 3 } },
        });
        console.log('CATALOG:', catalog ? `${catalog.id} ${catalog.name} ads=${catalog.ads.length}` : 'NONE');

        const inquiry = await prisma.inquiry.findFirst({
            where: { status: 'open', items: { some: { urgent: true } } },
            select: { id: true, title: true, ownerUserId: true, items: { where: { urgent: true }, select: { id: true, referenceItemId: true, quantity: true }, take: 3 } },
        });
        console.log('INQUIRY:', inquiry ? `${inquiry.id} ${inquiry.title} urgentItems=${inquiry.items.length}` : 'NONE');

        const user = await prisma.user.findFirst({ where: { status: 'member' }, select: { id: true, tokenVersion: true } });
        if (!user) throw new Error('NO USER');
        const token = jwt.sign({ sub: user.id, tv: user.tokenVersion ?? 0 }, JWT_SECRET);
        require('fs').writeFileSync('/tmp/match-test-token.txt', token);
        console.log('TOKEN_SAVED user=', user.id);

        // ۲) کالای مرجع مشترک بین آگهی‌ها و اقلام فعال — برای سناریوی مچ
        const refId = catalog?.ads?.[0]?.productReferenceId;
        if (refId && inquiry) {
            const shared = inquiry.items.find((i) => i.referenceItemId === refId);
            console.log('SHARED_REF:', shared ? `YES itemId=${shared.id} qty=${shared.quantity}` : `NO (refAds=${refId})`);
        }
        await prisma.$disconnect();
    } catch (e) {
        console.error('ERR', e.message);
        await prisma.$disconnect();
        process.exit(1);
    }
})();
