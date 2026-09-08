// prisma/seed/seed-industries.ts
import { PrismaClient } from '@prisma/client';
import { Industries } from '../data/Industry';

const prisma = new PrismaClient();

async function createTree(
    nodes: any[],
    parentId: string | null = null,
    parentPath: string = '',
    slugMap: Map<string, number> = new Map() // اضافه کردن Map برای پیگیری اسلاگ‌ها
) {
    for (const node of nodes) {
        let slug = node.slug;
        const originalSlug = slug;

        // اگر slug تکراری بود، یک عدد به انتهای آن اضافه کن
        if (slugMap.has(slug)) {
            let counter = slugMap.get(slug)! + 1;
            slug = `${originalSlug}-${counter}`;
            while (slugMap.has(slug)) {
                counter++;
                slug = `${originalSlug}-${counter}`;
            }
            slugMap.set(originalSlug, counter);
        } else {
            slugMap.set(slug, 1);
        }

        const path = parentPath ? `${parentPath}.${slug}` : slug;
        const level = parentPath ? parentPath.split('.').length : 0;

        const created = await prisma.industry.create({
            data: {
                title: node.title,
                slug,
                parentId,
                path,
                level,
                isActive: true,
            },
        });

        if (node.children && node.children.length > 0) {
            // برای هر سطح از فرزندان یک Map جدید یا همان Map را ارسال کنید
            await createTree(node.children, created.id, path, slugMap);
        }
    }
}

async function main() {
    const roots = Industries.categories;

    console.log('🌱 شروع سید صنوف...');
    console.log(`📊 تعداد ریشه‌ها: ${roots.length}`);

    console.log('🗑️ حذف صنوف قبلی...');
    await prisma.industry.updateMany({ data: { parentId: null } });
    await prisma.industry.deleteMany({});
    console.log('✅ صنوف قبلی حذف شدند.');

    // نقشه اسلاگ‌ها برای یکتاسازی
    const slugMap = new Map<string, number>();
    await createTree(roots, null, '', slugMap);

    console.log('✅ سید صنوف با موفقیت انجام شد!');
}

main()
    .catch((e) => {
        console.error('❌ خطا:', e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());