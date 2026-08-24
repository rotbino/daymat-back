// prisma/seed/seed-categories.ts
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
    if (code.length !== 8) return 0;

    const familyPart = code.substring(2, 4);
    const classPart = code.substring(4, 6);
    const commodityPart = code.substring(6, 8);

    if (familyPart === '00' && classPart === '00' && commodityPart === '00') return 1;
    if (classPart === '00' && commodityPart === '00') return 2;
    if (commodityPart === '00') return 3;
    return 4;
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

function getParentCodeFromCode(code: string): string | null {
    if (!code) return null;
    if (/^[A-J]$/.test(code)) return null;
    if (code.length !== 8) return null;

    const familyPart = code.substring(2, 4);
    const classPart = code.substring(4, 6);
    const commodityPart = code.substring(6, 8);

    if (familyPart === '00' && classPart === '00' && commodityPart === '00') {
        const segmentNum = parseInt(code.substring(0, 2));
        if (isNaN(segmentNum) || segmentNum < 1 || segmentNum > 26) return null;
        return String.fromCharCode(64 + segmentNum);
    }

    if (classPart === '00' && commodityPart === '00') {
        return code.substring(0, 2) + '000000';
    }

    if (commodityPart === '00') {
        return code.substring(0, 4) + '0000';
    }

    return code.substring(0, 6) + '00';
}

function toSlug(titleEn: string, code: string): string {
    const base = titleEn
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\u0600-\u06FF]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return `${base}-${code}`;
}

// ============================================================
// خواندن اکسل
// ============================================================

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
// ساخت والد missing (بازگشتی)
// ============================================================

async function ensureParentExists(
    parentCode: string,
    codeToId: Map<string, string>,
): Promise<string | null> {
    // ۱. اگه خودش هست
    if (codeToId.has(parentCode)) {
        return codeToId.get(parentCode)!;
    }

    // ۲. جستجو در دیتابیس
    const existing = await prisma.productCategory.findUnique({
        where: { code: parentCode },
    });
    if (existing) {
        codeToId.set(existing.code, existing.id);
        return existing.id;
    }

    // ۳. ساخت والد
    const level = getLevel(parentCode);
    const slug = toSlug(`auto-${parentCode}`, parentCode);

    // پیدا کردن والدِ والد
    let grandParentId: string | null = null;
    const grandParentCode = getParentCodeFromCode(parentCode);

    if (grandParentCode) {
        if (/^[A-J]$/.test(grandParentCode)) {
            const group = await prisma.productCategory.findUnique({
                where: { code: grandParentCode },
            });
            if (group) {
                grandParentId = group.id;
                codeToId.set(group.code, group.id);
            }
        } else {
            grandParentId = await ensureParentExists(grandParentCode, codeToId);
        }
    }

    const created = await prisma.productCategory.upsert({
        where: { code: parentCode },
        update: {
            parentId: grandParentId,
            parentCode: grandParentCode,
            level,
            isActive: true,
        },
        create: {
            code: parentCode,
            title: `Auto: ${parentCode}`,
            titleEn: `Auto: ${parentCode}`,
            slug,
            parentId: grandParentId,
            parentCode: grandParentCode,
            level,
            path: parentCode,
            isActive: true,
            score: 0,
        },
    });

    codeToId.set(created.code, created.id);
    console.log(`   🛠️ والد ساخته/آپدیت شد: ${parentCode} (سطح ${level})`);

    return created.id;
}

// ============================================================
// تابع اصلی
// ============================================================

async function main() {
    console.log('🌱 شروع سید دسته‌بندی از فایل اکسل (با upsert)...\n');

    const dataPath = path.join(__dirname, '../data/ISIC_CodesFa.xlsx');
    if (!fs.existsSync(dataPath)) {
        console.error(`❌ فایل ${dataPath} پیدا نشد!`);
        process.exit(1);
    }

    const rows = parseExcel(dataPath);
    console.log(`📄 ${rows.length} رکورد از اکسل خوانده شد\n`);

    const codeToId = new Map<string, string>();
    const keyToId = new Map<string, string>();

    // ═══════════════════════════════════════
    // مرحله ۰: upsert گروه‌های A-J
    // ═══════════════════════════════════════
    console.log('📦 مرحله ۰: upsert گروه‌های A-J...\n');

    const groupTitles: Record<string, string> = {
        'A': 'مواد خام',
        'B': 'تجهیزات و ابزار صنعتی',
        'C': 'ملزومات و قطعات',
        'D': 'خدمات ساختمانی و تاسیساتی',
        'E': 'تجهیزات پزشکی',
        'F': 'مواد غذایی',
        'G': 'خدمات مالی و بیمه',
        'H': 'خدمات آموزشی',
        'I': 'خدمات حمل و نقل',
        'J': 'خدمات عمومی',
    };

    for (const letter of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']) {
        const group = await prisma.productCategory.upsert({
            where: { code: letter },
            update: {
                title: groupTitles[letter] || `گروه ${letter}`,
                titleEn: `Group ${letter}`,
                parentId: null,
                parentCode: null,
                level: 0,
                path: letter,
                isActive: true,
            },
            create: {
                code: letter,
                title: groupTitles[letter] || `گروه ${letter}`,
                titleEn: `Group ${letter}`,
                slug: toSlug(`group-${letter}`, letter),
                parentId: null,
                parentCode: null,
                level: 0,
                path: letter,
                isActive: true,
                score: 0,
            },
        });
        codeToId.set(letter, group.id);
    }
    console.log('   ✅ گروه‌های A-J آماده شدند\n');

    // ═══════════════════════════════════════
    // مرحله ۱: upsert همه نودها
    // ═══════════════════════════════════════
    console.log('📥 مرحله ۱: درج/آپدیت همه نودها...\n');

    const sortedRows = [...rows].sort((a, b) => {
        const levelA = getLevel(a.code);
        const levelB = getLevel(b.code);
        if (levelA !== levelB) return levelA - levelB;
        return a.code.localeCompare(b.code);
    });

    let created = 0;
    let updated = 0;
    let errors = 0;

    for (const row of sortedRows) {
        try {
            const level = getLevel(row.code);

            // اگه گروه A-J هست، از قبل ساخته شده
            if (level === 0) {
                if (codeToId.has(row.code)) {
                    keyToId.set(row.key, codeToId.get(row.code)!);
                }
                continue;
            }

            // ─── پیدا کردن یا ساخت والد ───
            let parentId: string | null = null;
            let parentCode: string | null = null;

            // ۱. با parentKey
            if (row.parentKey && keyToId.has(row.parentKey)) {
                parentId = keyToId.get(row.parentKey)!;
                const parent = await prisma.productCategory.findFirst({
                    where: { id: parentId },
                    select: { code: true },
                });
                parentCode = parent?.code || null;
            }

            // ۲. با محاسبه از کد
            if (!parentId) {
                const calculatedParent = getParentCodeFromCode(row.code);
                if (calculatedParent) {
                    if (/^[A-J]$/.test(calculatedParent)) {
                        const group = await prisma.productCategory.findUnique({
                            where: { code: calculatedParent },
                        });
                        if (group) {
                            parentId = group.id;
                            parentCode = calculatedParent;
                        }
                    } else {
                        parentId = await ensureParentExists(calculatedParent, codeToId);
                        if (parentId) {
                            const parent = await prisma.productCategory.findFirst({
                                where: { id: parentId },
                                select: { code: true },
                            });
                            parentCode = parent?.code || calculatedParent;
                        }
                    }
                }
            }

            const slug = toSlug(row.titleEn || row.titleFa, row.code);

            // ─── upsert ───
            const existing = await prisma.productCategory.findUnique({
                where: { code: row.code },
            });

            if (existing) {
                await prisma.productCategory.update({
                    where: { id: existing.id },
                    data: {
                        title: row.titleFa || row.titleEn,
                        titleEn: row.titleEn || row.titleFa,
                        parentId,
                        parentCode,
                        level,
                        path: buildPath(row.code, level),
                        isActive: true,
                    },
                });
                codeToId.set(row.code, existing.id);
                keyToId.set(row.key, existing.id);
                updated++;
            } else {
                const category = await prisma.productCategory.create({
                    data: {
                        code: row.code,
                        title: row.titleFa || row.titleEn,
                        titleEn: row.titleEn || row.titleFa,
                        slug,
                        parentId,
                        parentCode,
                        level,
                        path: buildPath(row.code, level),
                        isActive: true,
                        score: 0,
                    },
                });
                codeToId.set(row.code, category.id);
                keyToId.set(row.key, category.id);
                created++;
            }

            if ((created + updated) % 1000 === 0) {
                console.log(`   ✅ ${created + updated} رکورد پردازش شد... (${created} جدید، ${updated} آپدیت)`);
            }
        } catch (error: any) {
            errors++;
            console.error(`   ❌ خطا برای ${row.code}: ${error.message?.slice(0, 100)}`);
        }
    }

    console.log(`\n   ✅ ${created} رکورد جدید، ${updated} آپدیت، ${errors} خطا\n`);

    // ═══════════════════════════════════════
    // مرحله ۲: اصلاح یتیم‌ها
    // ═══════════════════════════════════════
    console.log('🔧 مرحله ۲: اصلاح یتیم‌ها...\n');

    let fixedOrphans = 0;
    const maxPasses = 10;

    for (let pass = 0; pass < maxPasses; pass++) {
        const orphanList = await prisma.productCategory.findMany({
            where: {
                parentId: null,
                level: { gt: 0 },
            },
            select: { id: true, code: true, level: true },
            orderBy: { level: 'asc' },
        });

        if (orphanList.length === 0) {
            console.log(`   ✅ هیچ یتیمی بعد از پاس ${pass} نیست`);
            break;
        }

        for (const orphan of orphanList) {
            const parentCode = getParentCodeFromCode(orphan.code);
            if (!parentCode) continue;

            let parentId: string | null = null;

            if (/^[A-J]$/.test(parentCode)) {
                parentId = codeToId.get(parentCode) || null;
            } else {
                const parent = await prisma.productCategory.findUnique({
                    where: { code: parentCode },
                });
                if (parent) {
                    parentId = parent.id;
                    codeToId.set(parent.code, parent.id);
                } else {
                    parentId = await ensureParentExists(parentCode, codeToId);
                }
            }

            if (parentId) {
                const parent = await prisma.productCategory.findFirst({
                    where: { id: parentId },
                    select: { path: true, code: true },
                });

                if (parent) {
                    await prisma.productCategory.update({
                        where: { id: orphan.id },
                        data: {
                            parentId,
                            parentCode: parent.code,
                            path: `${parent.path}.${orphan.code}`,
                        },
                    });
                    fixedOrphans++;
                }
            }
        }
    }

    console.log(`   🔧 ${fixedOrphans} یتیم اصلاح شد\n`);

    // ═══════════════════════════════════════
    // مرحله ۳: آپدیت مسیرها
    // ═══════════════════════════════════════
    console.log('📝 مرحله ۳: آپدیت مسیرها...\n');

    let updatedPaths = 0;

    for (const level of [1, 2, 3, 4]) {
        const nodes = await prisma.productCategory.findMany({
            where: { level },
            select: { id: true, code: true, parentId: true, path: true },
            orderBy: { code: 'asc' },
        });

        for (const node of nodes) {
            if (!node.parentId) continue;

            const parent = await prisma.productCategory.findFirst({
                where: { id: node.parentId },
                select: { path: true },
            });

            if (parent) {
                const correctPath = `${parent.path}.${node.code}`;
                if (node.path !== correctPath) {
                    await prisma.productCategory.update({
                        where: { id: node.id },
                        data: { path: correctPath },
                    });
                    updatedPaths++;
                }
            }
        }
    }

    console.log(`   ✅ ${updatedPaths} مسیر اصلاح شد\n`);

    // ═══════════════════════════════════════
    // گزارش نهایی
    // ═══════════════════════════════════════
    const totalCount = await prisma.productCategory.count();
    const level0 = await prisma.productCategory.count({ where: { level: 0 } });
    const level1 = await prisma.productCategory.count({ where: { level: 1 } });
    const level2 = await prisma.productCategory.count({ where: { level: 2 } });
    const level3 = await prisma.productCategory.count({ where: { level: 3 } });
    const level4 = await prisma.productCategory.count({ where: { level: 4 } });
    const finalOrphans = await prisma.productCategory.count({
        where: { parentId: null, level: { gt: 0 } },
    });

    console.log('📊 گزارش نهایی:');
    console.log('─'.repeat(40));
    console.log(`   ✅ جدید: ${created}`);
    console.log(`   🔄 آپدیت: ${updated}`);
    console.log(`   ❌ خطا: ${errors}`);
    console.log(`   🔧 یتیم اصلاح شده: ${fixedOrphans}`);
    console.log('   ─────────────────────────');
    console.log(`   📁 کل: ${totalCount}`);
    console.log(`   📁 سطح 0 (A-J): ${level0}`);
    console.log(`   📁 سطح 1 (Segment): ${level1}`);
    console.log(`   📁 سطح 2 (Family): ${level2}`);
    console.log(`   📁 سطح 3 (Class): ${level3}`);
    console.log(`   📁 سطح 4 (Commodity): ${level4}`);
    console.log(`   📁 یتیم نهایی: ${finalOrphans}`);
    console.log('─'.repeat(40));

    if (finalOrphans > 0) {
        console.log('\n📋 یتیم‌های باقی‌مانده:');
        const orphanList = await prisma.productCategory.findMany({
            where: { parentId: null, level: { gt: 0 } },
            select: { code: true, title: true, titleEn: true, level: true },
            orderBy: [{ level: 'asc' }, { code: 'asc' }],
            take: 20,
        });
        for (const orphan of orphanList) {
            const expectedParent = getParentCodeFromCode(orphan.code);
            console.log(`   🔸 ${orphan.code} (${orphan.titleEn}) سطح ${orphan.level} — والد: ${expectedParent || 'N/A'}`);
        }
    }

    console.log('\n🎉 سید کامل شد!');
}

main()
    .catch((e) => {
        console.error('❌ خطای کلی:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });