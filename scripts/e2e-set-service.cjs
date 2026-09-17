// ابزار E2E — ست کردن salesType=service روی بازوی فروش تستی (چون فرم بازوی فروش خدماتی هنوز نیست)
const { PrismaClient } = require('@prisma/client');
const slug = process.argv[2];
if (!slug) { console.error('usage: node e2e-set-service.cjs <slug-prefix>'); process.exit(1); }
const prisma = new PrismaClient();
prisma.catalog.updateMany({ where: { slug }, data: { salesType: 'service' } })
    .then((res) => { console.log('updated:', res.count); })
    .catch((e) => { console.error(e.message); process.exit(1); })
    .finally(() => prisma.$disconnect());
