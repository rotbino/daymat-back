// prisma/seed/update-arm-barton.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ============================================================
// 🎯 آپدیت کامل بازاری بارتون (با شماره پشتیبان و صنوف جدید)
// ============================================================

// عناوین صنوفی که برای بازاری بارتون انتخاب می‌کنیم
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
    console.log('🔧 به‌روزرسانی کامل بازاری بارتون...\n');

    const ARM_SLUG = 'barton'; // می‌توانید مستقیماً slug یا id بدهید
    // یا اگر id مشخص است:
    // const ARM_ID = '6a679a617968cd5ad1335936';

    // ۱. یافتن بازار
    const arm = await prisma.arm.findUnique({
        where: { slug: ARM_SLUG }, // یا { id: ARM_ID }
        select: { id: true, slug: true, name: true, config: true },
    });

    if (!arm) {
        console.log(`❌ بازاریی با شناسه ${ARM_SLUG} یافت نشد!`);
        return;
    }

    console.log(`✅ بازار پیدا شد: ${arm.name} (${arm.slug})`);

    // ۲. دریافت صنوف جدید از دیتابیس
    console.log('\n🏭 پیدا کردن اصناف مرتبط با مصالح...');
    const selectedIndustries = await prisma.industry.findMany({
        where: {
            title: { in: TARGET_INDUSTRY_TITLES },
            isActive: true,
        },
        select: { id: true, title: true },
    });

    if (selectedIndustries.length === 0) {
        console.log('❌ هیچ صنفی یافت نشد! ابتدا seed-industries.ts را اجرا کنید.');
        return;
    }

    const selectedIndustryIds = selectedIndustries.map(ind => ind.id);
    const selectedIndustryTitles = selectedIndustries.map(ind => ({ id: ind.id, title: ind.title }));

    console.log(`   ✅ ${selectedIndustries.length} صنف انتخاب شد:`);
    selectedIndustries.forEach(ind => console.log(`      - ${ind.title}`));

    // ۳. نگهداری تنظیمات قبلی (بجز بخش صنوف که با جدید جایگزین می‌شود)
    const currentConfig = arm.config as any || {};

    const updatedConfig = {
        // همهٔ بخش‌های قبلی را نگه می‌داریم
        ...currentConfig,

        // بخش‌های جدید یا به‌روزرسانی‌شده
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
            restrictMembershipByIndustry: true,   // فعال‌سازی محدودیت
            allowManualRoleSelection: true,
            requireAdminApprovalForMembership: false,
            requirePhoneVerification: false,
            requireBusinessVerification: false,
            restrictMembershipByLocation: false,
        },

        economy: {
            daymatShare: 30,
            currency: 'IRR',
            bumpCost: 10,
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

        // ✅ جایگزینی کامل صنوف با ساختار جدید
        selectedIndustryIds,
        selectedIndustries: selectedIndustryTitles,

        // پاک‌سازی یا حفظ آرایه‌های قدیمی برای سازگاری (می‌توانید خالی بگذارید یا نگه دارید)
        supplierIndustryIds: [],
        buyerIndustryIds: [],
        supplierIndustries: [],
        buyerIndustries: [],

        // مابقی بخش‌ها از تنظیمات قبلی (categorySelections, locationSelections, ...) باقی می‌مانند
        // (چون در currentConfig هستند و ما آن‌ها را با spread نگه داشتیم)
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
    };

    // ۴. به‌روزرسانی بازار
    await prisma.arm.update({
        where: { id: arm.id },
        data: {
            config: updatedConfig,
        },
    });

    console.log('\n✅ بازار با موفقیت به‌روزرسانی شد!');
    console.log(`🔗 آدرس: /${arm.slug}`);
    console.log(`📞 پشتیبانی: ${updatedConfig.support.phone} (قابل ویرایش توسط مدیر بازار)`);
    console.log(`🏭 صنوف جدید: ${selectedIndustries.length} عدد`);
    console.log('='.repeat(55));
}

main()
    .catch((e) => {
        console.error('❌ خطا:', e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());