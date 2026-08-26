// prisma/seed/seed-arm-barton.ts
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// ✅ واحدهای مورد استفاده در بازار مصالح
const UNIT_IDS = {
    number: '6a78d21072aee46310168600',     // عدد
    kg: '6a78d21072aee463101685f9',        // کیلوگرم
    ton: '6a78d21072aee463101685fa',       // تن
    bag: '6a78d21072aee463101685fb',       // کیسه
    carton: '6a78d21072aee463101685fc',    // کارتن
    pallet: '6a78d21072aee463101685fd',    // پالت
    pack: '6a78d21072aee463101685ff',      // بسته
    box: '6a8a87a44a9d610bf0ab6d1f',       // باکس
};

// ✅ درخت دسته‌بندی مصالح ساختمانی — ساختار جدید
const CATEGORY_TREE = [
    {
        id: 'cat_barton_01',
        title: 'مصالح پایه',
        isLeaf: false,
        customCode: '01',
        isActive: true,
        children: [
            {
                id: 'cat_barton_0101',
                title: 'سیمان',
                isLeaf: true,
                customCode: '0101',
                isActive: true,
                baseUnitId: UNIT_IDS.ton,
                baseUnitTitle: 'تن',
                baseUnitShortCode: 'تن',
                overrideUnitId: UNIT_IDS.bag,
                overrideUnitTitle: 'کیسه',
                overrideUnitShortCode: 'کیسه',
                overrideUnitQty: 20,
                overrideUnitIsVariableQty: true,
                alternativeUnits: [
                    {
                        unitId: UNIT_IDS.pallet,
                        unitTitle: 'پالت',
                        unitShortCode: 'پالت',
                        isVariableQty: true,
                        qty: 40,
                        isActive: true,
                        displayPriority: 0,
                    },
                ],
            },
            {
                id: 'cat_barton_0102',
                title: 'گچ',
                isLeaf: true,
                customCode: '0102',
                isActive: true,
                baseUnitId: UNIT_IDS.ton,
                baseUnitTitle: 'تن',
                baseUnitShortCode: 'تن',
                overrideUnitId: UNIT_IDS.bag,
                overrideUnitTitle: 'کیسه',
                overrideUnitShortCode: 'کیسه',
                overrideUnitQty: 25,
                overrideUnitIsVariableQty: true,
                alternativeUnits: [],
            },
            {
                id: 'cat_barton_0103',
                title: 'آجر',
                isLeaf: true,
                customCode: '0103',
                isActive: true,
                baseUnitId: UNIT_IDS.number,
                baseUnitTitle: 'عدد',
                baseUnitShortCode: 'عدد',
                overrideUnitId: UNIT_IDS.pallet,
                overrideUnitTitle: 'پالت',
                overrideUnitShortCode: 'پالت',
                overrideUnitQty: 500,
                overrideUnitIsVariableQty: true,
                alternativeUnits: [],
            },
            {
                id: 'cat_barton_0104',
                title: 'بلوک',
                isLeaf: true,
                customCode: '0104',
                isActive: true,
                baseUnitId: UNIT_IDS.number,
                baseUnitTitle: 'عدد',
                baseUnitShortCode: 'عدد',
                overrideUnitId: UNIT_IDS.pallet,
                overrideUnitTitle: 'پالت',
                overrideUnitShortCode: 'پالت',
                overrideUnitQty: 100,
                overrideUnitIsVariableQty: true,
                alternativeUnits: [],
            },
            {
                id: 'cat_barton_0105',
                title: 'شن و ماسه',
                isLeaf: true,
                customCode: '0105',
                isActive: true,
                baseUnitId: UNIT_IDS.ton,
                baseUnitTitle: 'تن',
                baseUnitShortCode: 'تن',
                overrideUnitId: UNIT_IDS.ton,
                overrideUnitTitle: 'تن',
                overrideUnitShortCode: 'تن',
                overrideUnitQty: 1,
                overrideUnitIsVariableQty: true,
                alternativeUnits: [],
            },
        ],
    },
    {
        id: 'cat_barton_02',
        title: 'عایق و پوشش',
        isLeaf: false,
        customCode: '02',
        isActive: true,
        children: [
            {
                id: 'cat_barton_0201',
                title: 'عایق',
                isLeaf: true,
                customCode: '0201',
                isActive: true,
                baseUnitId: UNIT_IDS.kg,
                baseUnitTitle: 'کیلوگرم',
                baseUnitShortCode: 'کیلوگرم',
                overrideUnitId: UNIT_IDS.carton,
                overrideUnitTitle: 'کارتن',
                overrideUnitShortCode: 'کارتن',
                overrideUnitQty: 20,
                overrideUnitIsVariableQty: true,
                alternativeUnits: [],
            },
            {
                id: 'cat_barton_0202',
                title: 'فوم ساختمانی',
                isLeaf: true,
                customCode: '0202',
                isActive: true,
                baseUnitId: UNIT_IDS.number,
                baseUnitTitle: 'عدد',
                baseUnitShortCode: 'عدد',
                overrideUnitId: UNIT_IDS.carton,
                overrideUnitTitle: 'کارتن',
                overrideUnitShortCode: 'کارتن',
                overrideUnitQty: 10,
                overrideUnitIsVariableQty: true,
                alternativeUnits: [],
            },
            {
                id: 'cat_barton_0203',
                title: 'کاشی و سرامیک',
                isLeaf: true,
                customCode: '0203',
                isActive: true,
                baseUnitId: UNIT_IDS.box,
                baseUnitTitle: 'باکس',
                baseUnitShortCode: 'باکس',
                overrideUnitId: UNIT_IDS.pallet,
                overrideUnitTitle: 'پالت',
                overrideUnitShortCode: 'پالت',
                overrideUnitQty: 40,
                overrideUnitIsVariableQty: true,
                alternativeUnits: [],
            },
            {
                id: 'cat_barton_0204',
                title: 'کناف',
                isLeaf: true,
                customCode: '0204',
                isActive: true,
                baseUnitId: UNIT_IDS.number,
                baseUnitTitle: 'عدد',
                baseUnitShortCode: 'عدد',
                overrideUnitId: UNIT_IDS.pack,
                overrideUnitTitle: 'بسته',
                overrideUnitShortCode: 'بسته',
                overrideUnitQty: 10,
                overrideUnitIsVariableQty: true,
                alternativeUnits: [],
            },
        ],
    },
    {
        id: 'cat_barton_03',
        title: 'سازه و پیش‌ساخته',
        isLeaf: false,
        customCode: '03',
        isActive: true,
        children: [
            {
                id: 'cat_barton_0301',
                title: 'تیرچه بلوک',
                isLeaf: true,
                customCode: '0301',
                isActive: true,
                baseUnitId: UNIT_IDS.number,
                baseUnitTitle: 'عدد',
                baseUnitShortCode: 'عدد',
                overrideUnitId: UNIT_IDS.pack,
                overrideUnitTitle: 'بسته',
                overrideUnitShortCode: 'بسته',
                overrideUnitQty: 10,
                overrideUnitIsVariableQty: true,
                alternativeUnits: [],
            },
            {
                id: 'cat_barton_0302',
                title: 'دیوار پیش ساخته',
                isLeaf: true,
                customCode: '0302',
                isActive: true,
                baseUnitId: UNIT_IDS.number,
                baseUnitTitle: 'عدد',
                baseUnitShortCode: 'عدد',
                overrideUnitId: UNIT_IDS.number,
                overrideUnitTitle: 'عدد',
                overrideUnitShortCode: 'عدد',
                overrideUnitQty: 1,
                overrideUnitIsVariableQty: true,
                alternativeUnits: [],
            },
        ],
    },
    {
        id: 'cat_barton_99',
        title: 'سایر مصالح',
        isLeaf: true,
        customCode: '99',
        isActive: true,
        baseUnitId: UNIT_IDS.number,
        baseUnitTitle: 'عدد',
        baseUnitShortCode: 'عدد',
        overrideUnitId: UNIT_IDS.number,
        overrideUnitTitle: 'عدد',
        overrideUnitShortCode: 'عدد',
        overrideUnitQty: 1,
        overrideUnitIsVariableQty: true,
        alternativeUnits: [],
    },
];

const TARGET_CITIES = [
    { province: 'تهران', city: 'تهران' },
    { province: 'تهران', city: 'کرج' },
    { province: 'همدان', city: 'همدان' },
    { province: 'همدان', city: 'ملایر' },
];

const TARGET_INDUSTRY_TITLES = [
    'تولیدکننده مصالح ساختمانی',
    'عمده‌فروش مصالح ساختمانی',
    'خرده‌فروش مصالح ساختمانی',
    'پیمانکار ساختمانی',
    'انبوه‌ساز مسکن',
    'مهندس مشاور / ناظر ساختمان',
    'تعمیرکار و بازسازی‌کننده ساختمان',
    'واردکننده مصالح ساختمانی',
];

async function main() {
    console.log('🏗️ شروع ایجاد بازاری بارتون (مصالح ساختمانی)...\n');

    const passHash = await bcrypt.hash('123456', 10);
    const adminPassHash = await bcrypt.hash('admin123456', 10);

    // ═══════════════ ۱. کاربران ═══════════════
    console.log('👤 ایجاد کاربران...');

    let superAdmin = await prisma.user.findUnique({ where: { phone: '09120000000' } });
    if (!superAdmin) {
        superAdmin = await prisma.user.create({
            data: {
                phone: '09120000000',
                fullName: 'ادمین',
                passwordHash: adminPassHash,
                role: 'system_admin',
                status: 'active',
                isPhoneVerified: true,
                temporaryPassword: false,
            },
        });
        await prisma.credit.create({
            data: {
                userId: superAdmin.id,
                creditCount: 1000,
                creditType: 'bonus',
                transactionType: 'signup_bonus',
                description: 'اعتبار هدیه برای ادمین',
                status: 'success',
                amount: 0,
                currency: 'IRR',
            },
        });
    }
    console.log(`   ✅ سوپر ادمین: 09120000000 / admin123456`);

    let armOwner = await prisma.user.findUnique({ where: { phone: '09196421264' } });
    if (!armOwner) {
        armOwner = await prisma.user.create({
            data: {
                phone: '09196421264',
                fullName: 'مدیر بازار بارتون',
                passwordHash: passHash,
                role: 'system_user',
                status: 'active',
                isPhoneVerified: true,
                temporaryPassword: false,
            },
        });
        await prisma.credit.create({
            data: {
                userId: armOwner.id,
                creditCount: 500,
                creditType: 'bonus',
                transactionType: 'signup_bonus',
                description: 'اعتبار هدیه برای مالک بازار',
                status: 'success',
                amount: 0,
                currency: 'IRR',
            },
        });
    }
    console.log(`   ✅ مدیر بازار: 09196421264 / 123456`);

    // ═══════════════ ۲. موقعیت‌ها ═══════════════
    console.log('\n📍 پیدا کردن موقعیت‌ها...');
    const locationIds: string[] = [];
    for (const t of TARGET_CITIES) {
        const loc = await prisma.location.findFirst({
            where: {
                type: 'city',
                title: t.city,
                parent: { title: t.province },
                isActive: true,
            },
            select: { id: true },
        });
        if (loc) {
            locationIds.push(loc.id);
            console.log(`   ✅ ${t.province} - ${t.city}`);
        }
    }

    // ═══════════════ ۳. اصناف ═══════════════
    console.log('\n🏭 پیدا کردن اصناف مرتبط با مصالح...');
    const selectedIndustries = await prisma.industry.findMany({
        where: {
            title: { in: TARGET_INDUSTRY_TITLES },
            isActive: true,
        },
        select: { id: true, title: true },
    });

    if (selectedIndustries.length === 0) {
        console.log('❌ هیچ صنفی یافت نشد!');
        return;
    }

    const selectedIndustryIds = selectedIndustries.map(ind => ind.id);
    const selectedIndustryTitles = selectedIndustries.map(ind => ({ id: ind.id, title: ind.title }));

    console.log(`   ✅ ${selectedIndustries.length} صنف انتخاب شد`);

    // ═══════════════ ۴. حذف بازاری قبلی ═══════════════
    console.log('\n🗑️ بررسی بازاری قبلی...');
    const old = await prisma.arm.findUnique({ where: { slug: 'barton' } });
    if (old) {
        await prisma.$transaction([
            prisma.armMembership.deleteMany({ where: { armId: old.id } }),
            prisma.ad.deleteMany({ where: { armId: old.id } }),
            prisma.arm.delete({ where: { id: old.id } }),
        ]);
        console.log('   ✅ حذف شد');
    }

    // ═══════════════ ۵. ایجاد بازاری جدید ═══════════════
    console.log('\n🏗️ ایجاد بازاری جدید...');

    const arm = await prisma.arm.create({
        data: {
            slug: 'barton',
            name: 'بارتون',
            shortName: 'بارتون',
            slogan: 'قیمت امروز فروشندگان عمده مصالح ساختمانی',
            description: 'تابلو مقایسه قیمت‌های مصالح ساختمانی در تهران و همدان',
            icon: 'construction',
            colorPrimary: '#8b0000',
            colorSecondary: '#904d00',
            logoUrl: '/images/logo.png',
            bannerUrl: '/images/banner.png',
            mission: 'اتصال تولیدکنندگان و فروشندگان عمده مصالح ساختمانی به خریداران',
            status: 'active',
            visibility: 'public',
            ownerUserId: armOwner.id,
            geoScopeType: 'multi_city',
            rankingAlgorithm: 'simple',
            metadata: { source: 'seed', version: '6.0' },
            categoryTree: CATEGORY_TREE,
            allowedCategoryScopeTree: CATEGORY_TREE,
            config: {
                general: {
                    name: 'بارتون',
                    slogan: 'قیمت امروز فروشندگان عمده مصالح ساختمانی',
                    description: 'تابلو مقایسه قیمت‌های مصالح ساختمانی در تهران و همدان',
                    mission: 'اتصال تولیدکنندگان و فروشندگان عمده مصالح ساختمانی',
                },
                support: {
                    phone: '021-12345678',
                    mobile: '09121234567',
                    email: 'support@barton.ir',
                    workingHours: 'شنبه تا چهارشنبه ۹ تا ۱۷',
                    description: 'پشتیبانی واحد بازار',
                },
                modules: {
                    priceTable: {
                        enabled: true,
                        requireLoginToViewPrices: true,
                        requireMembershipToViewPrices: false,
                        requireLoginToCall: false,
                        requireMembershipToCall: true,
                        allowAnonymousPublishing: true,
                        autoApproveAds: true,
                        maxTotalFreeAdPerUser: 10,
                        adValidityDefaultHours: 24,
                        maxActiveAdsPerUser: 5,
                        bumpCost: 10,
                    },
                    buyLead: {
                        enabled: true,
                        requireMembershipToView: false,
                        requireMembershipToSubmit: true,
                        maxActiveRequestsPerUser: 5,
                    },
                },
                accessRules: {
                    restrictMembershipByIndustry: true,
                    allowManualRoleSelection: true,
                    requireAdminApprovalForMembership: false,
                    requirePhoneVerification: false,
                    requireBusinessVerification: false,
                    restrictMembershipByLocation: false,
                    requireBusinessForMembership: true,
                },
                economy: {
                    daymatShare: 30,
                    currency: 'IRR',
                    bumpCost: 10,
                    creditRules: {
                        signupBonus: 50,
                        referralBonus: 20,
                        dailyLoginBonus: 2,
                    },
                },
                payment: {
                    paymentMode: 'both',
                    defaultGateway: 'pec',
                    gateways: [],
                    manual: {
                        enabled: true,
                        cardNumber: '6037-9912-3456-7890',
                        shebaNumber: 'IR12-3456-7890-1234-5678-9012',
                        accountOwner: 'علی محمدی',
                        bankName: 'بانک ملت',
                        instructions: 'لطفاً مبلغ را واریز کرده و رسید را آپلود کنید.',
                    },
                    settlementAccount: {
                        type: 'bank_card',
                        value: '6037-9912-3456-7890',
                    },
                },
                locationSelections: locationIds.map((id, i) => ({
                    locationId: id,
                    customLabel: null,
                    displayPriority: i,
                    isActive: true,
                })),
                selectedIndustryIds,
                selectedIndustries: selectedIndustryTitles,
                localization: {
                    timezone: 'Asia/Tehran',
                    locale: 'fa',
                },
                integrations: {},
                custom: {},
                formLabels: {},
                armAdminPermission: {
                    categories: {
                        canEdit: true,
                        canAdd: true,
                        canRemove: true,
                        canChangeUnit: true,
                    },
                    locations: {
                        canEdit: false,
                    },
                    ads: {
                        canView: true,
                        canApprove: true,
                        canDelete: true,
                        canBump: true,
                    },
                },
            },
        },
    });

    console.log(`   ✅ بازار: ${arm.name} (${arm.slug})`);

    // ═══════════════ ۶. عضویت‌ها ═══════════════
    console.log('\n👥 عضویت‌ها...');

    await prisma.armMembership.create({
        data: {
            armId: arm.id,
            userId: armOwner.id,
            role: 'arm_owner',
            status: 'active',
            source: 'auto_create',
        },
    });

    await prisma.armMembership.create({
        data: {
            armId: arm.id,
            userId: superAdmin.id,
            role: 'arm_owner',
            status: 'active',
            source: 'auto_create',
        },
    });

    console.log('   ✅ هر دو کاربر مالک بازار شدند');

    // ═══════════════ ۷. خلاصه ═══════════════
    let leafCount = 0;
    const countLeaves = (nodes: any[]) => {
        for (const n of nodes) {
            if (n.isLeaf || !n.children?.length) leafCount++;
            if (n.children) countLeaves(n.children);
        }
    };
    countLeaves(CATEGORY_TREE);

    console.log('\n' + '='.repeat(55));
    console.log('🎉 بازاری بارتون با موفقیت ایجاد شد!');
    console.log('='.repeat(55));
    console.log(`🔗 آدرس: /${arm.slug}`);
    console.log(`👤 مالک بازار: 09196421264 / 123456`);
    console.log(`👤 سوپر ادمین: 09120000000 / admin123456`);
    console.log(`📊 دسته‌بندی: ${leafCount} برگ | شهر: ${locationIds.length}`);
    console.log(`🏭 اصناف: ${selectedIndustries.length}`);
    console.log('='.repeat(55));
}

main()
    .catch((e) => {
        console.error('❌', e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());