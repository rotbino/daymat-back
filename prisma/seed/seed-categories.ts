// prisma/seed/seed-categories.ts
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

function toSlug(text: string, id?: number): string {
    let slug = text.trim().replace(/\s+/g, '-').replace(/[^آ-یa-zA-Z0-9\-]/g, '').toLowerCase();
    if (id !== undefined) slug = `${slug}-${id}`;
    return slug;
}

// ============================================================
// استخراج همه واحدها از کل درخت (unit + available_units)
// ============================================================
function extractAllUnits(data: any[]): Set<string> {
    const units = new Set<string>();
    function walk(items: any[]) {
        for (const item of items) {
            if (item.unit) units.add(item.unit);
            if (item.available_units) {
                item.available_units.forEach((u: string) => units.add(u));
            }
            if (item.subcategories) walk(Object.values(item.subcategories));
        }
    }
    walk(data);
    return units;
}

// ============================================================
// upsert CategoryUnitMapping
// ============================================================
async function upsertMapping(categoryId: string, unitId: string, isDefault: boolean) {
    await prisma.categoryUnitMapping.upsert({
        where: { categoryId_unitId: { categoryId, unitId } },
        update: { isDefault },
        create: { categoryId, unitId, isDefault },
    });
}

// ============================================================
// ایجاد دسته‌بندی‌ها
// ============================================================
async function createCategories(
    items: any[],
    parentId: string | null = null,
    parentPath: string = '',
    parentLevel: number = -1,
    unitMap: Map<string, string>,
    parentUnitIds: string[] = [],
    parentUnitTitle: string = 'تن',
): Promise<void> {
    for (const item of items) {
        const slug = toSlug(item.category_name, item.id);
        const level = parentLevel + 1;
        const path = parentPath ? `${parentPath}.${slug}` : slug;

        // واحد اصلی: مال خودش یا ارث از والد
        const unitTitle = item.unit || parentUnitTitle || 'تن';
        const unitId = unitMap.get(unitTitle) || null;

        // ایجاد دسته‌بندی
        const category = await prisma.productCategory.upsert({
            where: { slug },
            update: {
                title: item.category_name,
                example: item.example || null,
                defaultMinQuantity: item.min || null,
                score: item.score || 0,
                isActive: true,
            },
            create: {
                title: item.category_name,
                slug,
                parentId,
                level,
                path,
                example: item.example || null,
                defaultMinQuantity: item.min || null,
                score: item.score || 0,
                isActive: true,
            },
        });

        // ═══════════════ CategoryUnitMapping ═══════════════
        if (item.available_units) {
            // خودش لیست واحد داره → مپ کن
            const unitIds = item.available_units
                .map((u: string) => unitMap.get(u))
                .filter(Boolean) as string[];

            for (const uid of unitIds) {
                await upsertMapping(category.id, uid, uid === unitId);
            }
            // console.log(`   📐 ${item.available_units.length} واحد برای ${item.category_name}`);
        } else if (parentUnitIds.length > 0) {
            // از والد ارث می‌بره → مپ کن
            for (const puid of parentUnitIds) {
                await upsertMapping(category.id, puid, puid === unitId);
            }
            // console.log(`   📐 ارث‌بری ${parentUnitIds.length} واحد از والد برای ${item.category_name}`);
        } else if (unitId) {
            // هیچی نداره، فقط واحد خودش
            await upsertMapping(category.id, unitId, true);
        }

        // واحدهای قابل ارث‌بری برای فرزندان
        const childUnitIds = item.available_units
            ? item.available_units.map((u: string) => unitMap.get(u)).filter(Boolean) as string[]
            : parentUnitIds;

        const childUnitTitle = item.unit || parentUnitTitle;

        // زیرمجموعه‌ها
        if (item.subcategories) {
            await createCategories(
                Object.values(item.subcategories),
                category.id,
                path,
                level,
                unitMap,
                childUnitIds,
                childUnitTitle,
            );
        }
    }
}

// ============================================================
// تابع اصلی
// ============================================================
async function main() {
    console.log('🌱 شروع سید دسته‌بندی‌ها با واحدهای ارث‌بری...\n');

    // ۰. پاکسازی
    console.log('🗑️ پاکسازی داده‌های قبلی...');
    await prisma.categoryUnitMapping.deleteMany();
    console.log(`   ✅ categoryUnitMapping پاک شد`);
    await prisma.productCategory.deleteMany();
    console.log(`   ✅ productCategory پاک شد`);
    await prisma.unit.deleteMany();
    console.log(`   ✅ unit پاک شد\n`);

    // ۱. خواندن فایل
    const dataPath = path.join(__dirname, '../data/productCategory.json');
    if (!fs.existsSync(dataPath)) {
        console.error(`❌ فایل ${dataPath} پیدا نشد!`);
        process.exit(1);
    }
    const categoriesData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    console.log(`📄 فایل خوانده شد: ${categoriesData.length} ریشه\n`);

    // ۲. استخراج و ایجاد همه واحدها
    console.log('📦 ایجاد واحدها...');
    const unitsSet = extractAllUnits(categoriesData);
    const unitMap = new Map<string, string>(); // title -> id
    let unitCount = 0;

    for (const unitTitle of unitsSet) {
        const shortCode = unitTitle.replace(/\s+/g, '').replace(/[^آ-یa-zA-Z0-9]/g, '').substring(0, 15).toLowerCase();
        const unit = await prisma.unit.upsert({
            where: { shortCode },
            update: { title: unitTitle },
            create: { title: unitTitle, shortCode, isDefault: false },
        });
        unitMap.set(unitTitle, unit.id);
        unitCount++;
    }
    console.log(`   ✅ ${unitCount} واحد ایجاد/به‌روزرسانی شد\n`);

    // ۳. ایجاد درخت دسته‌بندی با ارث‌بری واحدها
    console.log('🌿 ایجاد دسته‌بندی‌ها...');
    await createCategories(categoriesData, null, '', -1, unitMap);

    // ۴. آمار نهایی
    const catCount = await prisma.productCategory.count();
    const mappingCount = await prisma.categoryUnitMapping.count();
    console.log(`\n✅ سید کامل شد!`);
    console.log(`📊 ${unitCount} واحد`);
    console.log(`📊 ${catCount} دسته‌بندی`);
    console.log(`📊 ${mappingCount} CategoryUnitMapping`);
}

main()
    .catch((e) => { console.error('❌', e); process.exit(1); })
    .finally(() => prisma.$disconnect());