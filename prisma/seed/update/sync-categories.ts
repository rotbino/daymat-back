// prisma/seed/sync-categories.ts
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
// upsert CategoryUnitMapping (فقط اضافه یا به‌روزرسانی، بدون حذف)
// ============================================================
async function syncMapping(categoryId: string, unitId: string, isDefault: boolean) {
    await prisma.categoryUnitMapping.upsert({
        where: { categoryId_unitId: { categoryId, unitId } },
        update: { isDefault },
        create: { categoryId, unitId, isDefault },
    });
}

// ============================================================
// همگام‌سازی دسته‌بندی‌ها (بدون حذف چیزهای موجود)
// ============================================================
async function syncCategories(
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

        // بررسی وجود دسته‌بندی
        const existing = await prisma.productCategory.findUnique({
            where: { slug },
            select: { id: true },
        });

        let categoryId: string;
        if (existing) {
            // به‌روزرسانی فقط فیلدهای غیرساختاری
            await prisma.productCategory.update({
                where: { id: existing.id },
                data: {
                    title: item.category_name,
                    example: item.example || null,
                    defaultMinQuantity: item.min || null,
                    score: item.score || 0,
                    isActive: true,
                },
            });
            categoryId = existing.id;
            console.log(`   🔄 به‌روزرسانی: ${item.category_name}`);
        } else {
            // ایجاد جدید
            const created = await prisma.productCategory.create({
                data: {
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
            categoryId = created.id;
            console.log(`   ➕ افزودن: ${item.category_name}`);
        }

        // ─── واحدها و mappings ───
        const unitIdsToMap = item.available_units
            ? item.available_units.map((u: string) => unitMap.get(u)).filter(Boolean) as string[]
            : parentUnitIds.length > 0
                ? parentUnitIds
                : unitId
                    ? [unitId]
                    : [];

        for (const uid of unitIdsToMap) {
            await syncMapping(categoryId, uid, uid === unitId);
        }

        // برای فرزندان ارث‌بری
        const childUnitIds = item.available_units
            ? item.available_units.map((u: string) => unitMap.get(u)).filter(Boolean) as string[]
            : parentUnitIds;
        const childUnitTitle = item.unit || parentUnitTitle;

        // زیرمجموعه‌ها
        if (item.subcategories) {
            await syncCategories(
                Object.values(item.subcategories),
                categoryId,
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
    console.log('🌱 شروع همگام‌سازی دسته‌بندی‌ها و واحدها (بدون حذف داده‌های قبلی)...\n');

    // ۱. خواندن فایل
    const dataPath = path.join(__dirname, '../data/productCategory.json');
    if (!fs.existsSync(dataPath)) {
        console.error(`❌ فایل ${dataPath} پیدا نشد!`);
        process.exit(1);
    }
    const categoriesData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    console.log(`📄 فایل خوانده شد: ${categoriesData.length} ریشه\n`);

    // ۲. استخراج و ایجاد/به‌روزرسانی واحدها
    console.log('📦 همگام‌سازی واحدها...');
    const unitsSet = extractAllUnits(categoriesData);
    const unitMap = new Map<string, string>();
    let unitAdded = 0;
    let unitUpdated = 0;

    for (const unitTitle of unitsSet) {
        const shortCode = unitTitle
            .replace(/\s+/g, '')
            .replace(/[^آ-یa-zA-Z0-9]/g, '')
            .substring(0, 15)
            .toLowerCase();

        const existingUnit = await prisma.unit.findFirst({
            where: { shortCode },
            select: { id: true },
        });

        if (existingUnit) {
            await prisma.unit.update({
                where: { id: existingUnit.id },
                data: { title: unitTitle },
            });
            unitMap.set(unitTitle, existingUnit.id);
            unitUpdated++;
        } else {
            const newUnit = await prisma.unit.create({
                data: {
                    title: unitTitle,
                    shortCode,
                    isDefault: false,
                },
            });
            unitMap.set(unitTitle, newUnit.id);
            unitAdded++;
        }
    }
    console.log(`   ✅ ${unitAdded} واحد جدید، ${unitUpdated} واحد به‌روزرسانی شد\n`);

    // ۳. همگام‌سازی دسته‌بندی‌ها و mappings
    console.log('🌿 همگام‌سازی دسته‌بندی‌ها...');
    await syncCategories(categoriesData, null, '', -1, unitMap);

    // ۴. آمار نهایی
    const catCount = await prisma.productCategory.count();
    const mappingCount = await prisma.categoryUnitMapping.count();
    const unitCount = await prisma.unit.count();
    console.log(`\n✅ همگام‌سازی کامل شد!`);
    console.log(`📊 واحدها: ${unitCount}`);
    console.log(`📊 دسته‌بندی‌ها: ${catCount}`);
    console.log(`📊 mappings: ${mappingCount}`);
}

main()
    .catch((e) => {
        console.error('❌', e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());