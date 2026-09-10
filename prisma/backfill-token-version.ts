// بک‌فیلد tokenVersion=0 برای کاربران موجود (اسناد قدیمی مونگو فیلد ندارند)
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const res = await prisma.user.updateMany({
        data: { tokenVersion: 0 },
    });
    console.log(`✅ tokenVersion=0 set for ${res.count} users`);
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
