// prisma/temp-runner.ts
// prisma/temp-runner.ts
/**
 * مهاجرت دیتای ریپلیس Business → Catalog (یک‌باره، idempotent)
 *
 * چه می‌کند (به‌ترتیب):
 *   ۱) کلون کامل Business → Catalog (با همان _idها — $merge، بدون حلقهٔ JS)
 *   ۲) ری‌نیم فیلد businessId → catalogId در همهٔ کالکشن‌های وابسته
 *   ۳) File.relatedModel: 'Business' → 'Catalog'  (لوگوها را نجات می‌دهد)
 *   ۴) BusinessActivity → CatalogActivity (با ری‌نیم فیلد)
 *   ۵) گزارش نهایی سلامت
 *
 * اجرا:   npx ts-node prisma/temp-runner.ts
 * ترتیب کل عملیات در دیتای عملیاتی:
 *   mongodump → این اسکریپت → npx prisma db push → تست اپ
 * (اسکریپت فقط دستورهای خام مونگو می‌زند؛ به وضعیت schema و کلاینت وابسته نیست)
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ─── ابزارهای خام ───
const cmd = (c: any) => prisma.$runCommandRaw(c) as Promise<any>;

async function count(coll: string): Promise<number> {
    try {
        const r: any = await cmd({ count: coll });
        return r?.n ?? 0;
    } catch {
        return -1; // کالکشن وجود ندارد
    }
}

async function ensureCollection(name: string) {
    try {
        await cmd({ create: name });
        console.log(`[create] کالکشن ${name} ساخته شد`);
    } catch (e: any) {
        // NamespaceExists = از قبل هست — عادی
        if (!String(e?.message).includes('already exists') && e?.code !== 48) {
            throw e;
        }
    }
}

// ─── ۱) کلون Business → Catalog ───
async function cloneBusinessToCatalog() {
    const srcCount = await count('Business');
    if (srcCount < 0) {
        console.log('[clone] کالکشن Business وجود ندارد — رد شد');
        return;
    }
    await ensureCollection('Catalog');

    // $merge: همهٔ داکیومنت‌ها با همان _id کپی می‌شوند؛
    // داکیومنتِ موجود با همان _id دست نمی‌خورد (idempotent) و جدیدها insert می‌شوند
    await cmd({
        aggregate: 'Business',
        pipeline: [{ $match: {} }, { $merge: { into: 'Catalog' } }],
        cursor: {},
    });
    const dstCount = await count('Catalog');
    console.log(`[clone] Business(${srcCount}) → Catalog(${dstCount}) ✓`);
}

// ─── ۲) ری‌نیم businessId → catalogId ───
const RENAMES: Record<string, string[]> = {
    ArmMembership: ['businessId'],
    Ad: ['businessId'],
    TeamMember: ['businessId'],
    Credit: ['businessId'],
    CreditRequest: ['businessId'],
    Verification: ['businessId'],
    TrustMetric: ['businessId'],
    CatalogInteraction: ['businessId'],
};

async function renameBusinessIdFields() {
    for (const [coll, fields] of Object.entries(RENAMES)) {
        if ((await count(coll)) <= 0) {
            console.log(`[rename] ${coll} — خالی/ناموجود، رد شد`);
            continue;
        }
        for (const field of fields) {
            try {
                const res: any = await cmd({
                    update: coll,
                    updates: [{
                        q: { [field]: { $exists: true } },
                        // فرم pipeline — کپی مقدار فیلد (نه رشتهٔ متنی!)
                        u: [
                            { $set: { catalogId: `$${field}` } },
                            { $unset: [field] },
                        ],
                        multi: true,
                    }],
                });
                console.log(`[rename] ${coll}.${field} → catalogId : n=${res?.n ?? '?'}`);
            } catch (e: any) {
                console.log(`[rename] ${coll}.${field} — خطا: ${String(e?.message).slice(0, 100)}`);
            }
        }
    }
}

// ─── ۳) File.relatedModel: Business → Catalog ───
async function fixFileRelatedModel() {
    if ((await count('File')) <= 0) return;
    const res: any = await cmd({
        update: 'File',
        updates: [{
            q: { relatedModel: 'Business' },
            u: { $set: { relatedModel: 'Catalog' } },
            multi: true,
        }],
    });
    console.log(`[file] relatedModel Business→Catalog : n=${res?.n ?? '?'}`);
    const left = await count('File');
    const check = await cmd({
        count: 'File',
        query: { relatedModel: 'Business' },
    }) as any;
    console.log(`[file] ماندهٔ relatedModel=Business : ${check?.n ?? 0}`);
    void left;
}

// ─── ۴) BusinessActivity → CatalogActivity ───
async function migrateActivities() {
    const src = await count('BusinessActivity');
    if (src <= 0) {
        console.log('[activity] BusinessActivity خالی/ناموجود — رد شد');
        return;
    }
    await ensureCollection('CatalogActivity');

    await cmd({
        aggregate: 'BusinessActivity',
        pipeline: [
            { $match: {} },
            { $addFields: { catalogId: '$businessId' } },
            { $unset: 'businessId' },
            // keepExisting → اجرای تکراری هیچ‌چیز را بازنویسی نمی‌کند
            { $merge: { into: 'CatalogActivity', whenMatched: 'keepExisting' } },
        ],
        cursor: {},
    });
    const dst = await count('CatalogActivity');
    console.log(`[activity] BusinessActivity(${src}) → CatalogActivity(${dst}) ✓`);
}

// ─── ۵) گزارش نهایی ───
async function report() {
    const rows: [string, number][] = [];
    for (const c of ['Catalog', 'ArmMembership', 'Ad', 'TeamMember', 'File', 'CatalogActivity', 'CatalogInteraction']) {
        rows.push([c, await count(c)]);
    }
    console.log('── گزارش نهایی ──');
    for (const [c, n] of rows) console.log(`  ${c.padEnd(22)} ${n}`);

    // هیچ businessId باقی نمانده؟
    for (const coll of Object.keys(RENAMES)) {
        const r: any = await cmd({ count: coll, query: { businessId: { $exists: true } } }).catch(() => null);
        if (r?.n > 0) {
            console.warn(`  ⚠️ ${coll}: ${r.n} داکیومنت هنوز businessId دارد`);
            process.exitCode = 1;
        }
    }
    const fb: any = await cmd({ count: 'File', query: { relatedModel: 'Business' } }).catch(() => null);
    if (fb?.n > 0) {
        console.warn(`  ⚠️ File: ${fb.n} داکیومنت هنوز relatedModel=Business دارد`);
        process.exitCode = 1;
    }
    console.log('── پایان ──');
}

async function main() {
    console.log('══ مهاجرت دیتای Business → Catalog ══');
    await cloneBusinessToCatalog();
    await renameBusinessIdFields();
    await fixFileRelatedModel();
    await migrateActivities();
    await report();
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());