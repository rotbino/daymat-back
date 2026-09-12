/**
 * مهاجرت یک‌باره: برای هر کاتالوگِ موجود، رکورد CatalogMemberِ اونر ساخته می‌شود
 *   — اونر = مالکِ کسب‌وکار (Business.ownerUserId) با لِین فروشندهٔ فعال
 *     (sellerBusinessId = businessId کاتالوگ) — چون اونر به‌طور پیش‌فرض
 *     فروشندهٔ کاتالوگ خودش است و خودش سفارش می‌گیرد.
 *   — position قدیمی از TeamMember (legacy) منتقل می‌شود.
 *   — رویداد CatalogTeamEvent «migrated» ثبت می‌شود (برای تاریخچه).
 *   Idempotent — اجرای دوباره آسیبی نمی‌زند.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const catalogs = await prisma.catalog.findMany({
        where: { status: { not: 'closed' } },
        select: {
            id: true,
            businessId: true,
            business: { select: { ownerUserId: true } },
            teamMembers: { select: { userId: true, position: true, role: true } },
        },
    });

    let created = 0;
    let skipped = 0;

    for (const c of catalogs) {
        const ownerId = (c.business as any)?.ownerUserId;
        if (!ownerId) {
            console.warn(`⚠️ catalog ${c.id}: business بدون owner — رد شد`);
            skipped++;
            continue;
        }
        const existing = await prisma.catalogMember.findUnique({
            where: { catalogId_userId: { catalogId: c.id, userId: ownerId } },
        });
        if (existing) {
            skipped++;
            continue;
        }
        const legacyPos = (c.teamMembers as any[])?.find((t) => t.userId === ownerId)?.position || null;

        await prisma.catalogMember.create({
            data: {
                catalogId: c.id,
                userId: ownerId,
                role: 'catalog_owner',
                status: 'active',
                position: legacyPos,
                sellerBusinessId: c.businessId,
                sellerStatus: 'active',
                sellerJoinedAt: new Date(),
            },
        });
        await prisma.catalogTeamEvent.create({
            data: {
                catalogId: c.id,
                userId: ownerId,
                eventType: 'migrated',
                note: 'مهاجرت به مدل تیم کاتالوگ — اونر با لِین فروشندهٔ فعال',
            },
        });
        created++;
    }

    console.log(`✅ migrated: ${created} catalogs, skipped: ${skipped}`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
