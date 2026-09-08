// prisma/seed/seed-brands.ts
// ✅ Seed برندهای پایه‌ی مواد غذایی (و چند تا از دسته‌های دیگر)
// اجرا: npx tsx prisma/seed/seed-brands.ts

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ✅ برندهای پایه — مواد غذایی + نوشیدنی + شوینده + نانوایی
const SEED_BRANDS = [
    // ─── مواد غذایی ───
    { title: 'مکنزی', category: 'food', keywords: ['mackenzie', 'کنسرو'] },
    { title: 'کاله', category: 'food', keywords: ['kalleh', 'لبنیات', 'پنیر'] },
    { title: 'پاک', category: 'food', keywords: ['pak', 'لبنیات', 'شیر'] },
    { title: 'دوشه', category: 'food', keywords: ['dasht', 'کنسرو', 'لوبیا'] },
    { title: 'نامک', category: 'food', keywords: ['namak', 'کنسرو'] },
    { title: 'میهن', category: 'food', keywords: ['mihan', 'لبنیات', 'شیر', 'ماست'] },
    { title: 'هاریا', category: 'food', keywords: ['hariya', 'تن ماهی'] },
    { title: 'شیلتون', category: 'food', keywords: ['shilton', 'تن ماهی'] },
    { title: 'عالیس', category: 'food', keywords: ['aliss', 'تن ماهی'] },
    { title: 'طبخ', category: 'food', keywords: ['tabkh', 'کنسرو'] },
    { title: 'گلستان', category: 'food', keywords: ['golestan', 'چای', 'برنج', 'روغن'] },
    { title: 'مهرام', category: 'food', keywords: ['mahram', 'سس', 'رب'] },
    { title: 'کمیجان', category: 'food', keywords: ['komijan', 'رب'] },
    { title: 'بهرام', category: 'food', keywords: ['bahram', 'سس'] },
    { title: 'ناز', category: 'food', keywords: ['naz', 'بیسکویت', 'شکلات'] },
    { title: 'ایلی', category: 'food', keywords: ['aylin', 'بیسکویت'] },
    { title: 'چوبی', category: 'food', keywords: ['choubi', 'بیسکویت'] },
    { title: 'مینو', category: 'food', keywords: ['mino', 'روغن'] },
    { title: 'برنک', category: 'food', keywords: ['bornak', 'روغن'] },
    { title: 'لادن', category: 'food', keywords: ['ladan', 'روغن'] },
    { title: 'غذای مهر', category: 'food', keywords: ['مهر', 'کنسرو کودک'] },

    // ─── نوشیدنی ───
    { title: 'سن‌ایچ', category: 'beverage', keywords: ['sunich', 'آبمیوه'] },
    { title: 'ماه‌بر', category: 'beverage', keywords: ['mabar', 'آبمیوه'] },
    { title: 'ایزی‌سی', category: 'beverage', keywords: ['ac', 'آبمیوه'] },
    { title: 'نی‌سا', category: 'beverage', keywords: ['nisa', 'آبمیوه'] },
    { title: 'کولا', category: 'beverage', keywords: ['cola'] },
    { title: 'البرز', category: 'beverage', keywords: ['alborz', 'چای'] },
    { title: 'گلستان', category: 'beverage', keywords: ['golestan', 'چای'] },

    // ─── شوینده ───
    { title: 'تای', category: 'cleaning', keywords: ['taye', 'مایع ظرفشویی'] },
    { title: 'گلی', category: 'cleaning', keywords: ['goli', 'مایع ظرفشویی'] },
    { title: 'سفید', category: 'cleaning', keywords: ['sefid', 'پودر لباسشویی'] },
    { title: 'کریق', category: 'cleaning', keywords: ['krec', 'پودر'] },
    { title: 'ساحل', category: 'cleaning', keywords: ['sahel', 'پودر'] },
    { title: 'فروش', category: 'cleaning', keywords: ['foroush', 'شوینده'] },

    // ─── نان و نانوایی ───
    { title: 'سپاس', category: 'bakery', keywords: ['sepas', 'نان'] },
    { title: 'تافتون', category: 'bakery', keywords: ['taftoon', 'نان'] },

    // ─── پروتئینی ───
    { title: 'مرغو', category: 'protein', keywords: ['morgho', 'مرغ'] },
    { title: 'فکوس', category: 'protein', keywords: ['fokos', 'مرغ'] },
    { title: 'زر', category: 'protein', keywords: ['zar', 'مرغ'] },

    // ─── برنج ───
    { title: 'زرقان', category: 'rice', keywords: ['zarqan', 'برنج'] },
    { title: 'هفت‌بهاران', category: 'rice', keywords: ['haftbeharan', 'برنج'] },
    { title: 'نمرود', category: 'rice', keywords: ['namrod', 'برنج'] },

    // ─── قند و شکر ───
    { title: 'هگمتانه', category: 'sugar', keywords: ['hagmatane', 'قند'] },
    { title: 'نوبهار', category: 'sugar', keywords: ['nobahar', 'قند'] },

    // ─── خواربار ───
    { title: 'افق کوروش', category: 'food', keywords: ['okc', 'زنجیره‌ای'] },
    { title: 'فامیلی', category: 'food', keywords: ['family', 'زنجیره‌ای'] },
];

async function main() {
    console.log('🌱 Seeding brands...');

    let created = 0;
    let skipped = 0;

    for (const brand of SEED_BRANDS) {
        // ✅ بررسی تکراری نبودن (case-insensitive)
        const existing = await prisma.brand.findFirst({
            where: { title: { equals: brand.title, mode: 'insensitive' } },
            select: { id: true },
        });
        if (existing) {
            skipped++;
            continue;
        }

        const slug = brand.title
            .trim()
            .replace(/\s+/g, '-')
            .replace(/[^\u0600-\u06FF\w\-]/g, '')
            .toLowerCase();

        // ✅ slug یکتا
        let finalSlug = slug;
        let suffix = 1;
        while (await prisma.brand.findUnique({ where: { slug: finalSlug }, select: { id: true } })) {
            finalSlug = `${slug}-${suffix++}`;
        }

        await prisma.brand.create({
            data: {
                title: brand.title,
                slug: finalSlug,
                category: brand.category,
                keywords: brand.keywords,
                confirmed: true,  // ✅ seeded brands are confirmed
                isActive: true,
            },
        });
        created++;
    }

    console.log(`✅ Created: ${created}`);
    console.log(`⏭️  Skipped (already exists): ${skipped}`);
    console.log(`📊 Total in DB: ${await prisma.brand.count()}`);
}

main()
    .catch(e => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
