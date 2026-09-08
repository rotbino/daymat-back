// prisma/seed/sync-categories.ts
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';

const prisma = new PrismaClient();

// ============================================================
// توابع کمکی
// ============================================================
function getLevel(code: string): number {
    if (!code) return 0;
    if (/^[A-J]$/.test(code)) return 0;
    if (code.length === 8) {
        const familyPart = code.substring(2, 4);
        const classPart = code.substring(4, 6);
        const commodityPart = code.substring(6, 8);
        if (familyPart === '00' && classPart === '00' && commodityPart === '00') return 1;
        if (classPart === '00' && commodityPart === '00') return 2;
        if (commodityPart === '00') return 3;
        return 4;
    }
    return 0;
}

function buildPath(code: string, level: number): string {
    if (/^[A-J]$/.test(code)) return code;
    if (code.length !== 8) return code;
    const segment = code.substring(0, 2) + '000000';
    const family = code.substring(0, 4) + '0000';
    const cls = code.substring(0, 6) + '00';
    switch (level) {
        case 1: return segment;
        case 2: return `${segment}.${family}`;
        case 3: return `${segment}.${family}.${cls}`;
        case 4: return `${segment}.${family}.${cls}.${code}`;
        default: return code;
    }
}

function toSlug(titleEn: string, code: string): string {
    const base = titleEn
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\u0600-\u06FF]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return `${base}-${code}`;
}

interface ExcelRow {
    key: string;
    parentKey: string;
    code: string;
    titleEn: string;
    titleFa: string;
}

function parseExcel(filePath: string): ExcelRow[] {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

    const rows: ExcelRow[] = [];
    const seenCodes = new Set<string>();

    for (let i = 1; i < rawData.length; i++) {
        const row = rawData[i];
        if (!row || row.length < 4) continue;

        const cleaned = row.map((cell: any) =>
            cell === null || cell === undefined ? '' : String(cell).trim()
        );

        const key = cleaned[0] || '';
        const parentKey = cleaned[1] || '';
        const code = cleaned[2] || '';
        const titleEn = cleaned[3] || '';
        const titleFa = cleaned[4] || titleEn;

        if (!code || !key) continue;
        if (seenCodes.has(code)) continue;

        seenCodes.add(code);
        rows.push({ key, parentKey, code, titleEn, titleFa });
    }

    return rows;
}

// ============================================================
// تابع اصلی
// ============================================================
async function main() {
    console.log('🌱 شروع همگام‌سازی دسته‌بندی‌ها از فایل اکسل (بدون حذف داده‌ها)...\n');

    // ۱. خواندن فایل اکسل
    const dataPath = path.join(__dirname, '../data/ISIC_CodesFa.xlsx');
    if (!fs.existsSync(dataPath)) {
        console.error(`❌ فایل ${dataPath} پیدا نشد!`);
        process.exit(1);
    }

    const rows = parseExcel(dataPath);
    console.log(`📄 ${rows.length} رکورد از اکسل خوانده شد\n`);

    // ۲. مرتب‌سازی بر اساس level
    const sortedRows = [...rows].sort((a, b) => getLevel(a.code) - getLevel(b.code));

    // ۳. همگام‌سازی
    const keyToId = new Map<string, string>();
    let added = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    console.log('🌿 همگام‌سازی دسته‌بندی‌ها...\n');

    for (const row of sortedRows) {
        try {
            const level = getLevel(row.code);
            const pathValue = buildPath(row.code, level);
            const slug = toSlug(row.titleEn || row.titleFa, row.code);

            // ✅ پیدا کردن والد با Key
            let parentId: string | null = null;
            let parentCode: string | null = null;

            if (row.parentKey) {
                // اول در keyToId
                if (keyToId.has(row.parentKey)) {
                    parentId = keyToId.get(row.parentKey)!;
                }

                // یا با کد والد
                if (!parentId) {
                    const parentCategory = await prisma.productCategory.findFirst({
                        where: { code: row.parentKey },
                    });
                    if (parentCategory) {
                        parentId = parentCategory.id;
                        keyToId.set(row.parentKey, parentCategory.id);
                    }
                }

                // گرفتن کد والد
                if (parentId) {
                    const parentCategory = await prisma.productCategory.findUnique({
                        where: { id: parentId },
                    });
                    parentCode = parentCategory?.code || row.parentKey;
                }
            }

            // ✅ بررسی وجود با code (اولویت با code)
            const existingByCode = await prisma.productCategory.findFirst({
                where: { code: row.code },
            });

            if (existingByCode) {
                // ✅ به‌روزرسانی
                await prisma.productCategory.update({
                    where: { id: existingByCode.id },
                    data: {
                        title: row.titleFa || row.titleEn,
                        titleEn: row.titleEn || row.titleFa,
                        parentId: parentId || existingByCode.parentId,
                        parentCode: parentCode || existingByCode.parentCode,
                        level,
                        path: pathValue,
                        isActive: true,
                    },
                });
                keyToId.set(row.key, existingByCode.id);
                updated++;
            } else {
                // ✅ ایجاد جدید
                const created = await prisma.productCategory.create({
                    data: {
                        code: row.code,
                        title: row.titleFa || row.titleEn,
                        titleEn: row.titleEn || row.titleFa,
                        slug,
                        parentId,
                        parentCode,
                        level,
                        path: pathValue,
                        isActive: true,
                        score: 0,
                    },
                });
                keyToId.set(row.key, created.id);
                added++;
            }

            if ((added + updated) % 500 === 0) {
                console.log(`   ✅ ${added + updated} رکورد پردازش شد...`);
            }
        } catch (error: any) {
            errors++;

            if (error.message.includes('Unique constraint')) {
                // Slug تکراری - سعی با slug متفاوت
                const uniqueSlug = toSlug(row.titleEn || row.titleFa, row.code) + `-${Date.now()}`;
                try {
                    const level = getLevel(row.code);
                    const pathValue = buildPath(row.code, level);

                    const created = await prisma.productCategory.create({
                        data: {
                            code: row.code,
                            title: row.titleFa || row.titleEn,
                            titleEn: row.titleEn || row.titleFa,
                            slug: uniqueSlug,
                            parentId: null,
                            parentCode: null,
                            level,
                            path: pathValue,
                            isActive: true,
                            score: 0,
                        },
                    });
                    keyToId.set(row.key, created.id);
                    added++;
                } catch (retryError) {
                    skipped++;
                    console.error(`   ❌ خطای مجدد برای ${row.code}: ${retryError.message}`);
                }
            } else {
                errors--;
                skipped++;
                console.error(`   ❌ خطا برای ${row.code} - ${row.titleFa}: ${error.message}`);
            }
        }
    }

    // ۴. غیرفعال‌سازی کتگوری‌هایی که در اکسل نیستن
    const allCodes = new Set(rows.map(r => r.code));
    const existingCategories = await prisma.productCategory.findMany({
        select: { id: true, code: true },
    });

    let deactivated = 0;
    for (const cat of existingCategories) {
        if (!cat.code || !allCodes.has(cat.code)) {
            // ✅ فقط غیرفعال کن، حذف نکن
            await prisma.productCategory.update({
                where: { id: cat.id },
                data: { isActive: false },
            });
            deactivated++;
        }
    }

    // ۵. گزارش
    const totalCount = await prisma.productCategory.count();
    const activeCount = await prisma.productCategory.count({ where: { isActive: true } });
    const level0 = await prisma.productCategory.count({ where: { level: 0 } });
    const level1 = await prisma.productCategory.count({ where: { level: 1 } });
    const level2 = await prisma.productCategory.count({ where: { level: 2 } });
    const level3 = await prisma.productCategory.count({ where: { level: 3 } });
    const level4 = await prisma.productCategory.count({ where: { level: 4 } });

    console.log('\n📊 گزارش نهایی:');
    console.log(`   ➕ افزوده شده: ${added}`);
    console.log(`   🔄 به‌روزرسانی: ${updated}`);
    console.log(`   ⏭️ رد شده: ${skipped}`);
    console.log(`   ❌ خطا: ${errors}`);
    console.log(`   🔕 غیرفعال شده: ${deactivated}`);
    console.log('   ─────────────────────────');
    console.log(`   📁 کل: ${totalCount}`);
    console.log(`   ✅ فعال: ${activeCount}`);
    console.log(`   📁 سطح 0 (A-J): ${level0}`);
    console.log(`   📁 سطح 1 (Segment): ${level1}`);
    console.log(`   📁 سطح 2 (Family): ${level2}`);
    console.log(`   📁 سطح 3 (Class): ${level3}`);
    console.log(`   📁 سطح 4 (Commodity): ${level4}`);
    console.log('\n🎉 همگام‌سازی با موفقیت انجام شد!');
}

main()
    .catch((e) => {
        console.error('❌ خطای کلی:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });