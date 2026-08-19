// prisma/seed/seed-arm-barton.ts
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const TARGET_CATEGORIES = [
    'کاشی و سرامیک', 'سیمان', 'آجر', 'عایق', 'بلوک',
    'فوم ساختمانی', 'شن و ماسه', 'گچ', 'کناف', 'دیوار پیش ساخته', 'تیرچه بلوک',
];

const TARGET_CITIES = [
    { province: 'تهران', city: 'تهران' },
    { province: 'تهران', city: 'کرج' },
    { province: 'همدان', city: 'همدان' },
    { province: 'همدان', city: 'ملایر' },
];

// صنوفی که برای بازاری بارتون انتخاب می‌کنیم (برگ‌های مرتبط با مصالح)
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

    // ═══════════════ ۲. دسته‌بندی‌ها + واحدها ═══════════════
    console.log('\n📦 پیدا کردن دسته‌بندی‌ها...');
    const categories = await prisma.productCategory.findMany({
        where: { title: { in: TARGET_CATEGORIES }, isActive: true },
        select: { id: true, title: true, example: true, defaultMinQuantity: true, parentId: true },
    });
    if (categories.length === 0) {
        console.log('❌ دسته‌بندی یافت نشد!');
        return;
    }

    const categorySelections: any[] = [];
    for (const cat of categories) {
        const mapping = await prisma.categoryUnitMapping.findFirst({
            where: { categoryId: cat.id, isDefault: true },
            include: { unit: { select: { id: true, title: true, shortCode: true } } },
        });
        categorySelections.push({
            categoryId: cat.id,
            customLabel: null,
            overrideUnitId: mapping?.unitId || null,
            overrideUnitTitle: mapping?.unit?.title || null,
            overrideMinQuantity: cat.defaultMinQuantity || null,
            displayPriority: categorySelections.length,
            isActive: true,
            example: cat.example || null,
        });
        console.log(`   ✅ ${cat.title} → ${mapping?.unit?.title || 'ندارد'}`);
    }

    // ═══════════════ ۳. موقعیت‌ها ═══════════════
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

    // ═══════════════ ۴. اصناف جدید (از جدول Industry) ═══════════════
    console.log('\n🏭 پیدا کردن اصناف مرتبط با مصالح...');
    const selectedIndustries = await prisma.industry.findMany({
        where: {
            title: { in: TARGET_INDUSTRY_TITLES },
            isActive: true,
        },
        select: { id: true, title: true },
    });

    if (selectedIndustries.length === 0) {
        console.log('❌ هیچ صنفی یافت نشد! ابتدا seed-industries را اجرا کنید.');
        return;
    }

    const selectedIndustryIds = selectedIndustries.map(ind => ind.id);
    const selectedIndustryTitles = selectedIndustries.map(ind => ({ id: ind.id, title: ind.title }));

    console.log(`   ✅ ${selectedIndustries.length} صنف انتخاب شد:`);
    selectedIndustries.forEach(ind => console.log(`      - ${ind.title}`));

    // ═══════════════ ۵. حذف بازاری قبلی ═══════════════
    console.log('\n🗑️ بررسی بازاری قبلی...');
    const old = await prisma.arm.findUnique({ where: { slug: 'barton' } });
    if (old) {
        await prisma.$transaction([
            prisma.armMembership.deleteMany({ where: { armId: old.id } }),
            prisma.arm.delete({ where: { id: old.id } }),
        ]);
        console.log('   ✅ حذف شد');
    }

    // ═══════════════ ۶. ایجاد بازاری جدید ═══════════════
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
            mission: 'اتصال تولیدکنندگان و فروشندگان عمده مصالح ساختمانی به خریداران در تهران و همدان',
            status: 'active',
            visibility: 'public',
            ownerUserId: armOwner.id,
            geoScopeType: 'multi_city',
            rankingAlgorithm: 'simple',
            metadata: { source: 'seed', version: '5.0' },

            config: {
                general: {
                    name: 'بارتون',
                    slogan: 'قیمت امروز فروشندگان عمده مصالح ساختمانی',
                    description: 'تابلو مقایسه قیمت‌های مصالح ساختمانی در تهران و همدان',
                    mission: 'اتصال تولیدکنندگان و فروشندگان عمده مصالح ساختمانی به خریداران در تهران و همدان',
                },

                support: {
                    phone: '021-12345678',
                    mobile: '09121234567',
                    email: 'support@barton.ir',
                    workingHours: 'شنبه تا چهارشنبه ۹ تا ۱۷',
                    description: 'پشتیبانی واحد بازار برای راهنمایی در خرید و فروش',
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
                        adValidityDefaultDays: 24,
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
                    restrictMembershipByIndustry: true,  // فعال‌سازی محدودیت صنف
                    allowManualRoleSelection: true,
                    requireAdminApprovalForMembership: false,
                    requirePhoneVerification: false,
                    requireBusinessVerification: false,
                    restrictMembershipByLocation: false,
                },

                economy: {
                    daymatShare: 30,
                    currency: 'IRR',
                    bumpCost: 10,  // هزینه نردبان
                    creditRules: {
                        signupBonus: 50,
                        referralBonus: 20,
                        dailyLoginBonus: 2,
                        commentBonus: 1,
                        adViewBonus: 0,
                    },
                },

                payment: {
                    paymentMode: 'both',
                    defaultGateway: 'pec',
                    gateways: [
                        {
                            name: 'pec',
                            pin: '44970783',
                            sandbox: false,
                            callbackUrl: 'http://localhost:3000/credit/verify',
                        },
                        {
                            name: 'zarinpal',
                            merchantId: 'your-zarinpal-merchant-id',
                            sandbox: true,
                            callbackUrl: 'http://localhost:3000/credit/verify',
                        },
                        {
                            name: 'rayanpay',
                            pin: 'sandbox',
                            sandbox: true,
                            callbackUrl: 'http://localhost:3000/credit/verify',
                        },
                    ],
                    manual: {
                        enabled: true,
                        cardNumber: '6037-9912-3456-7890',
                        shebaNumber: 'IR12-3456-7890-1234-5678-9012',
                        accountOwner: 'علی محمدی',
                        bankName: 'بانک ملت',
                        instructions: 'لطفاً مبلغ را به شماره کارت واریز کرده و تصویر رسید را آپلود کنید.',
                    },
                    settlementAccount: {
                        type: 'bank_card',
                        value: '6037-9912-3456-7890',
                    },
                },

                categorySelections,
                allowedCategoryScope: [categories[0]?.parentId].filter(Boolean),

                locationSelections: locationIds.map((id, i) => ({
                    locationId: id,
                    customLabel: null,
                    displayPriority: i,
                    isActive: true,
                })),

                // ✅ ساختار جدید صنوف (جایگزین supplierIndustryIds/buyerIndustryIds)
                selectedIndustryIds,
                selectedIndustries: selectedIndustryTitles,

                localization: {
                    timezone: 'Asia/Tehran',
                    locale: 'fa',
                },
                integrations: {},
                custom: {},

                formLabels: {
                    'business.name.label': 'نام کسب‌وکار',
                    'business.name.placeholder': 'نام کسب‌وکار را وارد کنید',
                    'business.shortDescription.label': 'معرفی کوتاه',
                    'business.shortDescription.placeholder': 'مثال: تولید کننده انواع آجر فشاری',
                    'business.type.label': 'نوع کسب‌وکار',
                    'business.type.placeholder': 'انتخاب نوع...',
                    'business.phone.label': 'شماره تماس',
                    'business.phone.placeholder': 'شماره تماس را وارد کنید',
                    'business.address.label': 'آدرس',
                    'business.address.placeholder': 'آدرس کامل را وارد کنید',
                    'business.city.label': 'شهر',
                    'business.city.placeholder': 'شهر را انتخاب کنید',
                    'business.province.label': 'استان',
                    'business.province.placeholder': 'استان را انتخاب کنید',
                    'business.position.label': 'سمت شما',
                    'business.position.placeholder': 'انتخاب سمت...',
                    'business.industry.label': 'صنف',
                    'business.industry.placeholder': 'انتخاب صنف...',
                },

                armAdminPermission: {
                    general: {
                        canEditName: true,
                        canEditShortName: true,
                        canEditSlogan: true,
                        canEditDescription: true,
                        canEditMission: true,
                        canEditSlug: false,
                        canEditStatus: false,
                        canEditIcon: true,
                        canEditColors: true,
                        canEditLogo: true,
                        canEditBanner: true,
                    },
                    support: {
                        canEdit: true,
                    },
                    modules: {
                        canEditPriceTable: false,
                        canEditBuyLead: false,
                    },
                    accessRules: {
                        canEdit: false,
                    },
                    economy: {
                        canEdit: false,
                        canViewDaymatShare: true,
                    },
                    payment: {
                        canEdit: false,
                    },
                    categories: {
                        canEdit: false,
                        canAdd: false,
                        canRemove: false,
                        canChangeUnit: false,
                        canAddScope: false,
                        canRemoveScope: false,
                        canView: true,
                    },
                    locations: {
                        canEdit: false,
                        canAdd: false,
                        canRemove: false,
                    },
                    industries: {
                        canEdit: false,
                        canAdd: false,
                        canRemove: false,
                    },
                    formLabels: {
                        canEdit: false,
                    },
                    members: {
                        canView: true,
                        canEdit: false,
                        canChangeRole: false,
                        canBan: false,
                    },
                    ads: {
                        canView: true,
                        canApprove: false,
                        canDelete: false,
                        canBump: true,
                    },
                },
            },
        },
    });

    console.log(`   ✅ بازار: ${arm.name} (${arm.slug})`);

    // ═══════════════ ۷. عضویت‌ها ═══════════════
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

    console.log('   ✅ هر دو کاربر به‌عنوان مالک بازار عضو شدند');

    // ═══════════════ ۸. خلاصه ═══════════════
    console.log('\n' + '='.repeat(55));
    console.log('🎉 بازاری بارتون با موفقیت ایجاد شد!');
    console.log('='.repeat(55));
    console.log(`🔗 آدرس: /${arm.slug}`);
    console.log(`👤 مالک بازار: 09196421264 / 123456`);
    console.log(`👤 سوپر ادمین: 09120000000 / admin123456`);
    console.log(`📊 دسته‌بندی: ${categories.length} | شهر: ${locationIds.length}`);
    console.log(`🏭 اصناف انتخاب‌شده: ${selectedIndustries.length}`);
    console.log(`🧩 ماژول‌ها: priceTable (فعال) | buyLead (فعال)`);
    console.log(`💳 پرداخت: آنلاین (pec) + فیشی`);
    const config = arm.config as any;
    console.log(`📞 پشتیبانی: ${config.support?.phone || 'تنظیم نشده'} (قابل ویرایش توسط مدیر بازار)`);
    console.log(`🔑 دسترسی مدیر بازار:`);
    console.log(`   ✅ عمومی: نام، شعار، توضیحات، مأموریت، رنگ، لوگو، اطلاعات پشتیبانی`);
    console.log(`   ❌ اسلاگ، وضعیت، دسته‌بندی، موقعیت، صنوف، ماژول‌ها، قوانین، اقتصاد، پرداخت، برچسب‌ها`);
    console.log('='.repeat(55));
}

main()
    .catch((e) => {
        console.error('❌', e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());