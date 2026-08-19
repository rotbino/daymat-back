// prisma/seed/seed-industries-flat.ts
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

function toSlug(text: string): string {
    return text
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^آ-یa-zA-Z0-9\-]/g, '')
        .toLowerCase();
}

async function main() {
    console.log('🌱 شروع سید صنوف (فایل تخت) – پاکسازی و درج...');

    // ۱. قطع رابطه‌های والد و پاکسازی
    await prisma.industry.updateMany({ data: { parentId: null } });
    const { count: deletedCount } = await prisma.industry.deleteMany();
    console.log(`🧹 ${deletedCount} رکورد قبلی حذف شد.`);

    // ۲. خواندن فایل
    const filePath = path.join(__dirname, '..', 'data', 'industryFlatList.txt');
    const content = fs.readFileSync(filePath, 'utf-8');
    const titles = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

    console.log(`📄 تعداد صنوف در فایل: ${titles.length}`);

    // ۳. آماده‌سازی داده‌ها و حذف اسلاگ‌های تکراری
    const slugMap = new Map<string, number>();
    const uniqueData: any[] = [];
    const seenSlugs = new Set<string>();

    for (const title of titles) {
        const baseSlug = toSlug(title);
        let slug = baseSlug;
        const count = slugMap.get(baseSlug) || 0;
        if (count > 0) {
            slug = `${baseSlug}-${count}`;
        }
        slugMap.set(baseSlug, count + 1);

        // اطمینان از یکتایی slug
        if (!seenSlugs.has(slug)) {
            seenSlugs.add(slug);
            uniqueData.push({
                title,
                slug,
                parentId: null,
                level: 0,
                path: slug,
                code: null,
                isActive: true,
            });
        }
    }

    console.log(`🔍 ${titles.length - uniqueData.length} رکورد تکراری حذف شد.`);

    // ۴. درج با createMany (بدون skipDuplicates)
    const BATCH_SIZE = 500;
    let inserted = 0;

    for (let i = 0; i < uniqueData.length; i += BATCH_SIZE) {
        const batch = uniqueData.slice(i, i + BATCH_SIZE);
        await prisma.industry.createMany({ data: batch });
        inserted += batch.length;
        console.log(`📦 دسته ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(uniqueData.length / BATCH_SIZE)} درج شد.`);
    }

    console.log(`✅ سید صنوف کامل شد! ${inserted} رکورد جدید درج شد.`);
}

main()
    .catch((e) => {
        console.error('❌ خطا:', e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());