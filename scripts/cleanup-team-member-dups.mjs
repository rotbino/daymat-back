// scripts/cleanup-team-member-dups.mjs — حذف رکوردهای TeamMember تکراری/آزمایشی پیش از بازسازی ایندکس یونیک
import { createRequire } from 'module';
const require = createRequire('/home/z/my-project/repos/daymat-back/package.json');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

try {
    const rows = await prisma.teamMember.findMany({ orderBy: { createdAt: 'asc' } });
    const seen = new Map(); // catalogId:userId → اولین رکورد (نگه داشته می‌شود)
    const dups = [];
    for (const r of rows) {
        const key = `${r.catalogId}:${r.userId}`;
        if (seen.has(key)) dups.push(r);
        else seen.set(key, r);
    }
    console.log(`total=${rows.length} dups=${dups.length}`);
    for (const d of dups) {
        await prisma.teamMember.delete({ where: { id: d.id } });
        console.log(`deleted dup: ${d.id} (catalog=${d.catalogId} user=${d.userId} status=${d.status})`);
    }
    console.log('cleanup done');
} catch (e) {
    console.error('ERROR:', e.message);
} finally {
    await prisma.$disconnect();
}
