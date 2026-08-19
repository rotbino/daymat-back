// prisma/seed/seed-activities.ts
import { PrismaClient } from '@prisma/client';
import { Activity } from '../data/Activity';

const prisma = new PrismaClient();

function toSlug(text: string): string {
    return text
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^آ-یa-zA-Z0-9\-]/g, '')
        .substring(0, 50)
        .toLowerCase();
}

const LEVEL_MAP = {
    '1': { name: 'services', label: 'خدمات' },
    '2': { name: 'agriculture', label: 'کشاورزی' },
    '3': { name: 'activity', label: 'صنعت' },
};

async function main() {
    console.log('🌱 شروع سید اصناف...');
    console.log(`📊 تعداد رکوردها: ${Activity.length}`);

    const rootMap = new Map();

    for (const [key, value] of Object.entries(LEVEL_MAP)) {
        const slug = toSlug(value.label);
        const root = await prisma.activity.upsert({
            where: { slug },
            update: {},
            create: {
                title: value.label,
                slug: slug,
                path: slug,
                level: 0,
                code: key,
                isActive: true,
                metadata: { type: 'root', levelKey: key },
            },
        });
        rootMap.set(key, root);
        console.log(`   ✅ ریشه ایجاد شد: ${value.label} (${root.id})`);
    }

    const processedIds = new Set();

    for (const item of Activity) {
        const departmentKey = item.DRP_DEPARTMENT;
        const departmentLabel = item.DRP_DEPARTMENT_LABEL;
        const branchLabel = item.DRP_BRANCH_LABEL;
        const subBranchLabel = item.DRP_SUB_BRANCH_LABEL;
        const title = item.TXT_TITLE_BUSINESS;
        const code = item.business_number;

        const root = rootMap.get(departmentKey);
        if (!root) continue;

        // Branch
        const branchSlug = toSlug(branchLabel);
        const branchPath = `${root.path}.${branchSlug}`;
        let branch = await prisma.activity.findUnique({ where: { slug: branchSlug } });
        if (!branch) {
            branch = await prisma.activity.create({
                data: {
                    title: branchLabel,
                    slug: branchSlug,
                    parentId: root.id,
                    path: branchPath,
                    level: 1,
                    code: null,
                    isActive: true,
                },
            });
            console.log(`      ✅ شاخه: ${branchLabel} (${branch.id})`);
        }

        // Sub-Branch
        const subBranchSlug = toSlug(subBranchLabel);
        const subBranchPath = `${branch.path}.${subBranchSlug}`;
        let subBranch = await prisma.activity.findUnique({ where: { slug: subBranchSlug } });
        if (!subBranch) {
            subBranch = await prisma.activity.create({
                data: {
                    title: subBranchLabel,
                    slug: subBranchSlug,
                    parentId: branch.id,
                    path: subBranchPath,
                    level: 2,
                    code: null,
                    isActive: true,
                },
            });
            console.log(`         ✅ زیرشاخه: ${subBranchLabel} (${subBranch.id})`);
        }

        // صنف نهایی
        const finalSlug = `${toSlug(title)}-${code}`;
        const finalPath = `${subBranch.path}.${finalSlug}`;

        if (!processedIds.has(code)) {
            await prisma.activity.create({
                data: {
                    title: title,
                    slug: finalSlug,
                    parentId: subBranch.id,
                    path: finalPath,
                    level: 3,
                    code: code,
                    isActive: true,
                    metadata: {
                        business_number: code,
                        tags: item.DRP_BUSINESS_TAGS_LABEL,
                        custodian: item.DRP_CUSTODIAN_ISSUE_AUTHORITY_LABEL,
                        category_id: item.CATEGORY_ID,
                    },
                },
            });
            processedIds.add(code);
            console.log(`            ✅ صنف: ${title} (${code})`);
        }
    }

    console.log(`✅ سید اصناف با موفقیت انجام شد!`);
    console.log(`📊 تعداد اصناف ایجاد شده: ${processedIds.size}`);
}

main()
    .catch((e) => {
        console.error('❌ خطا در حین سید:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
        console.log('\n🔌 اتصال به دیتابیس قطع شد');
    });