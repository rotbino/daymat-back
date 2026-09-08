// prisma/seed/seed-units.ts
// ۱۰۹ واحد در ۱۴ دسته‌بندی
// اجرا: npx tsx prisma/seed/seed-units.ts

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface UnitDef {
    title: string;
    shortCode: string;
    isDefault?: boolean;
    containsQty?: number | null;
    qtyIsFixed?: boolean;
    category?: string;
}

const units: UnitDef[] = [
    // base
    { title: 'عدد', shortCode: 'pc', isDefault: true, containsQty: null, qtyIsFixed: false, category: 'base' },
    { title: 'جعبه', shortCode: 'box', containsQty: null, qtyIsFixed: false, category: 'base' },
    { title: 'بسته', shortCode: 'pack', containsQty: null, qtyIsFixed: false, category: 'base' },
    { title: 'کیسه', shortCode: 'bag', containsQty: null, qtyIsFixed: false, category: 'base' },
    { title: 'قوطی', shortCode: 'can', containsQty: null, qtyIsFixed: false, category: 'base' },
    { title: 'بطری', shortCode: 'btl', containsQty: null, qtyIsFixed: false, category: 'base' },
    { title: 'گالن', shortCode: 'gal', containsQty: null, qtyIsFixed: false, category: 'base' },
    { title: 'بشکه', shortCode: 'bbl', containsQty: null, qtyIsFixed: false, category: 'base' },
    { title: 'خاکچه', shortCode: 'sack', containsQty: null, qtyIsFixed: false, category: 'base' },
    { title: 'پاکت', shortCode: 'pkt', containsQty: null, qtyIsFixed: false, category: 'base' },
    { title: 'رول', shortCode: 'roll', containsQty: null, qtyIsFixed: false, category: 'base' },
    { title: 'شیت', shortCode: 'sht', containsQty: null, qtyIsFixed: false, category: 'base' },
    { title: 'جین', shortCode: 'dz', containsQty: null, qtyIsFixed: false, category: 'base' },
    { title: 'ست', shortCode: 'set', containsQty: null, qtyIsFixed: false, category: 'base' },
    { title: 'جفت', shortCode: 'pr', containsQty: null, qtyIsFixed: false, category: 'base' },
    { title: 'دست', shortCode: 'hand', containsQty: null, qtyIsFixed: false, category: 'base' },
    // weight
    { title: 'گرم', shortCode: 'g', containsQty: null, qtyIsFixed: false, category: 'weight' },
    { title: 'کیلوگرم', shortCode: 'kg', containsQty: null, qtyIsFixed: false, category: 'weight' },
    { title: 'تن', shortCode: 't', containsQty: null, qtyIsFixed: false, category: 'weight' },
    { title: 'پوند', shortCode: 'lb', containsQty: null, qtyIsFixed: false, category: 'weight' },
    { title: 'مثقال', shortCode: 'mth', containsQty: null, qtyIsFixed: false, category: 'weight' },
    { title: 'من', shortCode: 'mn', containsQty: null, qtyIsFixed: false, category: 'weight' },
    // volume
    { title: 'میلی‌لیتر', shortCode: 'ml', containsQty: null, qtyIsFixed: false, category: 'volume' },
    { title: 'لیتر', shortCode: 'l', containsQty: null, qtyIsFixed: false, category: 'volume' },
    { title: 'مترمکعب', shortCode: 'm3', containsQty: null, qtyIsFixed: false, category: 'volume' },
    { title: 'فوت مکعب', shortCode: 'ft3', containsQty: null, qtyIsFixed: false, category: 'volume' },
    { title: 'بشکه نفت', shortCode: 'oil-bbl', containsQty: null, qtyIsFixed: false, category: 'volume' },
    // length
    { title: 'میلیمتر', shortCode: 'mm', containsQty: null, qtyIsFixed: false, category: 'length' },
    { title: 'سانتی‌متر', shortCode: 'cm', containsQty: null, qtyIsFixed: false, category: 'length' },
    { title: 'متر', shortCode: 'm', containsQty: null, qtyIsFixed: false, category: 'length' },
    { title: 'کیلومتر', shortCode: 'km', containsQty: null, qtyIsFixed: false, category: 'length' },
    { title: 'اینچ', shortCode: 'in', containsQty: null, qtyIsFixed: false, category: 'length' },
    { title: 'فوت', shortCode: 'ft', containsQty: null, qtyIsFixed: false, category: 'length' },
    { title: 'یارد', shortCode: 'yd', containsQty: null, qtyIsFixed: false, category: 'length' },
    // area
    { title: 'مترمربع', shortCode: 'm2', containsQty: null, qtyIsFixed: false, category: 'area' },
    { title: 'فوت مربع', shortCode: 'ft2', containsQty: null, qtyIsFixed: false, category: 'area' },
    { title: 'هکتار', shortCode: 'ha', containsQty: null, qtyIsFixed: false, category: 'area' },
    { title: 'آکر', shortCode: 'ac', containsQty: null, qtyIsFixed: false, category: 'area' },
    // food-pack
    { title: 'کارتن کوچک', shortCode: 'ctn-s', containsQty: 6, qtyIsFixed: false, category: 'food-pack' },
    { title: 'کارتن', shortCode: 'ctn', containsQty: 12, qtyIsFixed: false, category: 'food-pack' },
    { title: 'کارتن بزرگ', shortCode: 'ctn-l', containsQty: 24, qtyIsFixed: false, category: 'food-pack' },
    { title: 'کارتن فوق بزرگ', shortCode: 'ctn-xl', containsQty: 48, qtyIsFixed: false, category: 'food-pack' },
    { title: 'شانه', shortCode: 'tray', containsQty: 6, qtyIsFixed: false, category: 'food-pack' },
    { title: 'شانه بزرگ', shortCode: 'tray-l', containsQty: 12, qtyIsFixed: false, category: 'food-pack' },
    { title: 'بسته ۶تایی', shortCode: 'pk-6', containsQty: 6, qtyIsFixed: true, category: 'food-pack' },
    { title: 'بسته ۱۲تایی', shortCode: 'pk-12', containsQty: 12, qtyIsFixed: true, category: 'food-pack' },
    { title: 'بسته ۲۴تایی', shortCode: 'pk-24', containsQty: 24, qtyIsFixed: true, category: 'food-pack' },
    { title: 'بسته ۳۰تایی', shortCode: 'pk-30', containsQty: 30, qtyIsFixed: true, category: 'food-pack' },
    { title: 'جعبه ۶تایی', shortCode: 'bx-6', containsQty: 6, qtyIsFixed: true, category: 'food-pack' },
    { title: 'جعبه ۱۲تایی', shortCode: 'bx-12', containsQty: 12, qtyIsFixed: true, category: 'food-pack' },
    { title: 'کیسه ۵کیلویی', shortCode: 'bag-5kg', containsQty: 5, qtyIsFixed: true, category: 'food-pack' },
    { title: 'کیسه ۱۰کیلویی', shortCode: 'bag-10kg', containsQty: 10, qtyIsFixed: true, category: 'food-pack' },
    { title: 'کیسه ۲۵کیلویی', shortCode: 'bag-25kg', containsQty: 25, qtyIsFixed: true, category: 'food-pack' },
    { title: 'کیسه ۵۰کیلویی', shortCode: 'bag-50kg', containsQty: 50, qtyIsFixed: true, category: 'food-pack' },
    { title: 'خاکچه ۵۰کیلویی', shortCode: 'sack-50', containsQty: 50, qtyIsFixed: true, category: 'food-pack' },
    // beverage
    { title: 'بطری ۲۵۰میلی', shortCode: 'btl-250', containsQty: 250, qtyIsFixed: true, category: 'beverage' },
    { title: 'بطری ۵۰۰میلی', shortCode: 'btl-500', containsQty: 500, qtyIsFixed: true, category: 'beverage' },
    { title: 'بطری ۱لیتری', shortCode: 'btl-1l', containsQty: 1, qtyIsFixed: true, category: 'beverage' },
    { title: 'بطری ۱.۵لیتری', shortCode: 'btl-1.5l', containsQty: 1, qtyIsFixed: true, category: 'beverage' },
    { title: 'بطری ۲لیتری', shortCode: 'btl-2l', containsQty: 2, qtyIsFixed: true, category: 'beverage' },
    { title: 'بطری ۵لیتری', shortCode: 'btl-5l', containsQty: 5, qtyIsFixed: true, category: 'beverage' },
    { title: 'بطری ۲۰لیتری', shortCode: 'btl-20l', containsQty: 20, qtyIsFixed: true, category: 'beverage' },
    { title: 'شیشه', shortCode: 'jar', containsQty: null, qtyIsFixed: false, category: 'beverage' },
    { title: 'شیشه ۲۰۰میلی', shortCode: 'jar-200', containsQty: 200, qtyIsFixed: true, category: 'beverage' },
    { title: 'شیشه ۵۰۰گری', shortCode: 'jar-500g', containsQty: 500, qtyIsFixed: true, category: 'beverage' },
    { title: 'شیشه ۱کیلویی', shortCode: 'jar-1kg', containsQty: 1, qtyIsFixed: true, category: 'beverage' },
    { title: 'قوطی ۶تایی', shortCode: 'can-6', containsQty: 6, qtyIsFixed: true, category: 'beverage' },
    { title: 'قوطی ۱۲تایی', shortCode: 'can-12', containsQty: 12, qtyIsFixed: true, category: 'beverage' },
    { title: 'قوطی ۲۴تایی', shortCode: 'can-24', containsQty: 24, qtyIsFixed: true, category: 'beverage' },
    // construction
    { title: 'کیسه سیمان', shortCode: 'cem-bag', containsQty: 50, qtyIsFixed: true, category: 'construction' },
    { title: 'پالت', shortCode: 'plt', containsQty: null, qtyIsFixed: false, category: 'construction' },
    { title: 'پالت کوچک', shortCode: 'plt-s', containsQty: 50, qtyIsFixed: false, category: 'construction' },
    { title: 'پالت بزرگ', shortCode: 'plt-l', containsQty: 100, qtyIsFixed: false, category: 'construction' },
    { title: 'بندیل', shortCode: 'bdl', containsQty: null, qtyIsFixed: false, category: 'construction' },
    { title: 'بندیل ۱۰تایی', shortCode: 'bdl-10', containsQty: 10, qtyIsFixed: true, category: 'construction' },
    { title: 'بندیل ۲۰تایی', shortCode: 'bdl-20', containsQty: 20, qtyIsFixed: true, category: 'construction' },
    { title: 'شاخه', shortCode: 'br', containsQty: null, qtyIsFixed: false, category: 'construction' },
    { title: 'ورق', shortCode: 'sht-m', containsQty: null, qtyIsFixed: false, category: 'construction' },
    { title: 'کلاف', shortCode: 'coil', containsQty: null, qtyIsFixed: false, category: 'construction' },
    { title: 'بلوک', shortCode: 'blk', containsQty: null, qtyIsFixed: false, category: 'construction' },
    { title: 'آجر', shortCode: 'brk', containsQty: null, qtyIsFixed: false, category: 'construction' },
    { title: 'شاخه میلگرد', shortCode: 'rb', containsQty: null, qtyIsFixed: false, category: 'construction' },
    { title: 'بیلت', shortCode: 'blt', containsQty: null, qtyIsFixed: false, category: 'construction' },
    // agriculture
    { title: 'خوشه', shortCode: 'bunch', containsQty: null, qtyIsFixed: false, category: 'agriculture' },
    { title: 'دسته', shortCode: 'bunch-s', containsQty: null, qtyIsFixed: false, category: 'agriculture' },
    { title: 'جعبه میوه', shortCode: 'fruit-bx', containsQty: null, qtyIsFixed: false, category: 'agriculture' },
    { title: 'صندوق', shortCode: 'cr', containsQty: null, qtyIsFixed: false, category: 'agriculture' },
    { title: 'صندوق ۱۰کیلویی', shortCode: 'cr-10', containsQty: 10, qtyIsFixed: true, category: 'agriculture' },
    { title: 'صندوق ۲۰کیلویی', shortCode: 'cr-20', containsQty: 20, qtyIsFixed: true, category: 'agriculture' },
    { title: 'باله', shortCode: 'bale', containsQty: null, qtyIsFixed: false, category: 'agriculture' },
    { title: 'باله پنبه', shortCode: 'bale-c', containsQty: 200, qtyIsFixed: true, category: 'agriculture' },
    // shipping
    { title: 'کانتینر ۲۰فوت', shortCode: 'cn20', containsQty: null, qtyIsFixed: false, category: 'shipping' },
    { title: 'کانتینر ۴۰فوت', shortCode: 'cn40', containsQty: null, qtyIsFixed: false, category: 'shipping' },
    { title: 'پالت صادراتی', shortCode: 'plt-exp', containsQty: null, qtyIsFixed: false, category: 'shipping' },
    // apparel
    { title: 'تعداد لباس', shortCode: 'cl-pc', containsQty: null, qtyIsFixed: false, category: 'apparel' },
    { title: 'کارتن لباس', shortCode: 'cl-ctn', containsQty: 30, qtyIsFixed: false, category: 'apparel' },
    { title: 'بسته لباس', shortCode: 'cl-pk', containsQty: 12, qtyIsFixed: false, category: 'apparel' },
    // electronics
    { title: 'کارتن الکترونیک', shortCode: 'el-ctn', containsQty: null, qtyIsFixed: false, category: 'electronics' },
    { title: 'پالت الکترونیک', shortCode: 'el-plt', containsQty: null, qtyIsFixed: false, category: 'electronics' },
    { title: 'مستر کارتن', shortCode: 'ms-ctn', containsQty: null, qtyIsFixed: false, category: 'electronics' },
    // pharma
    { title: 'استریپ', shortCode: 'strip', containsQty: 10, qtyIsFixed: true, category: 'pharma' },
    { title: 'بلیستر', shortCode: 'blstr', containsQty: 10, qtyIsFixed: false, category: 'pharma' },
    { title: 'جعبه دارو', shortCode: 'med-bx', containsQty: null, qtyIsFixed: false, category: 'pharma' },
    { title: 'کارتن دارو', shortCode: 'med-ctn', containsQty: 100, qtyIsFixed: false, category: 'pharma' },
    { title: 'بسته بهداشتی', shortCode: 'hyg-pk', containsQty: null, qtyIsFixed: false, category: 'pharma' },
    // misc
    { title: 'سرویس', shortCode: 'svc', containsQty: null, qtyIsFixed: false, category: 'misc' },
    { title: 'دستگاه', shortCode: 'unit-m', containsQty: null, qtyIsFixed: false, category: 'misc' },
    { title: 'قپ', shortCode: 'qab', containsQty: null, qtyIsFixed: false, category: 'misc' },
    { title: 'واحد', shortCode: 'u', containsQty: null, qtyIsFixed: false, category: 'misc' },
];

async function main() {
    console.log('🌱 شروع سید واحدها...\n');

    const adsUsingUnits = await prisma.ad.count();
    if (adsUsingUnits === 0) {
        const deleted = await prisma.unit.deleteMany({});
        console.log(`🗑️  ${deleted.count} واحد قبلی حذف شد\n`);
    } else {
        console.log('⚠️  آگهی موجود است — از حذف واحدها صرف‌نظر شد (upsert استفاده می‌شود)\n');
    }

    const byCategory = new Map<string, number>();
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const u of units) {
        try {
            const before = await prisma.unit.findUnique({
                where: { title: u.title },
                select: { id: true },
            });

            await prisma.unit.upsert({
                where: { title: u.title },
                update: {
                    shortCode: u.shortCode,
                    isDefault: u.isDefault ?? false,
                    containsQty: u.containsQty ?? null,
                    qtyIsFixed: u.qtyIsFixed ?? false,
                },
                create: {
                    title: u.title,
                    shortCode: u.shortCode,
                    isDefault: u.isDefault ?? false,
                    containsQty: u.containsQty ?? null,
                    qtyIsFixed: u.qtyIsFixed ?? false,
                },
            });

            if (before) updated++;
            else created++;

            const cat = u.category || 'misc';
            byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1);
        } catch (err: any) {
            console.log(`   ❌ ${u.title} (${u.shortCode}): ${err.message}`);
            skipped++;
        }
    }

    const defaults = await prisma.unit.findMany({ where: { isDefault: true } });
    if (defaults.length > 1) {
        await prisma.unit.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
        await prisma.unit.update({ where: { title: 'عدد' }, data: { isDefault: true } });
        console.log(`\n🔧 ${defaults.length} واحد پیش‌فرض بود — فقط «عدد» به‌عنوان پیش‌فرض نگه داشته شد`);
    } else if (defaults.length === 0) {
        await prisma.unit.update({ where: { title: 'عدد' }, data: { isDefault: true } });
        console.log('\n🔧 هیچ واحدی پیش‌فرض نبود — «عدد» به‌عنوان پیش‌فرض تنظیم شد');
    }

    console.log('\n✅ سید واحدها با موفقیت انجام شد');
    console.log(`   - ایجاد شده: ${created}`);
    console.log(`   - آپدیت شده: ${updated}`);
    console.log(`   - رد شده:    ${skipped}`);
    console.log(`   - مجموع:     ${units.length}`);
    console.log('\n📊 تفکیک دسته‌بندی:');
    for (const [cat, count] of byCategory) {
        console.log(`   - ${cat.padEnd(15)} ${count}`);
    }

    const total = await prisma.unit.count();
    console.log(`\n📦 مجموع واحدهای دیتابیس: ${total}`);
}

main()
    .catch((e) => {
        console.error('❌ خطا در سید:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
