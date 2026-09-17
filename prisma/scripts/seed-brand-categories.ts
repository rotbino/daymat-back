// prisma/scripts/seed-brand-categories.ts
// ✅ سید دسته‌بندی‌های برند — تاکسونومی ثابت و سطح‌بالای برندها (۲۲ دسته، سقف ۳۰)
// اجرا: npx tsx prisma/scripts/seed-brand-categories.ts
// idempotent — با slug upsert می‌شود؛ اجرای تکراری مشکلی ندارد

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ✅ لیست نهایی — ترتیب = ترتیب نمایش در فرم ثبت برند
const BRAND_CATEGORIES: { name: string; slug: string }[] = [
    { name: 'مواد غذایی و نوشیدنی', slug: 'food-drinks' },
    { name: 'پوشاک و مد', slug: 'fashion' },
    { name: 'نساجی، چرم و کفش', slug: 'textile-leather' },
    { name: 'آرایشی و بهداشتی', slug: 'beauty-hygiene' },
    { name: 'خانه و لوازم خانگی', slug: 'home-appliances' },
    { name: 'دیجیتال و الکترونیک', slug: 'digital-electronics' },
    { name: 'خودرو و حمل‌ونقل', slug: 'auto-transport' },
    { name: 'ساختمان و مصالح', slug: 'building-materials' },
    { name: 'ابزار و تجهیزات', slug: 'tools-equipment' },
    { name: 'ماشین‌آلات و صنایع', slug: 'machinery-industry' },
    { name: 'برق و تأسیسات', slug: 'electrical-installations' },
    { name: 'کشاورزی و دامپروری', slug: 'agriculture-livestock' },
    { name: 'پزشکی و سلامت', slug: 'medical-health' },
    { name: 'مبلمان و دکوراسیون', slug: 'furniture-decor' },
    { name: 'اداری و فروشگاهی', slug: 'office-store' },
    { name: 'کودک و اسباب‌بازی', slug: 'kids-toys' },
    { name: 'ورزش و سرگرمی', slug: 'sports-entertainment' },
    { name: 'فرهنگی و هنری', slug: 'culture-art' },
    { name: 'شیمیایی و مواد اولیه', slug: 'chemicals-raw' },
    { name: 'بسته‌بندی و چاپ', slug: 'packaging-printing' },
    { name: 'طلا، جواهر و اکسسوری', slug: 'jewelry-accessories' },
    { name: 'سایر', slug: 'other' },
];

async function main() {
    let created = 0;
    let updated = 0;

    for (let i = 0; i < BRAND_CATEGORIES.length; i++) {
        const cat = BRAND_CATEGORIES[i];
        const order = i + 1;

        const existing = await prisma.brandCategory.findUnique({ where: { slug: cat.slug } });
        if (existing) {
            if (existing.name !== cat.name || existing.order !== order || !existing.isActive) {
                await prisma.brandCategory.update({
                    where: { id: existing.id },
                    data: { name: cat.name, order, isActive: true },
                });
                updated++;
            }
        } else {
            await prisma.brandCategory.create({
                data: { name: cat.name, slug: cat.slug, order },
            });
            created++;
        }
    }

    const total = await prisma.brandCategory.count();
    console.log(`✅ دسته‌بندی برند — کل: ${total} | جدید: ${created} | به‌روزرسانی: ${updated}`);
    if (total > 30) {
        console.warn(`⚠️ تعداد دسته‌ها از سقف ۳۰ گذشت (${total}) — لیست را جمع کن!`);
    }
}

main()
    .catch((e) => {
        console.error('❌ seed-brand-categories failed:', e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
