// src/arm/dto/create-arm.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import {
    IsNotEmpty,
    IsString,
    IsOptional,
    IsArray,
    IsBoolean,
    IsNumber,
    Min,
    IsEnum,
    ValidateNested,
    IsObject,
    IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

// ============================================================
// بخش‌های مختلف Config
// ============================================================

// ------------------------------------------------------------
// 1. Appearance (ظاهر)
// ------------------------------------------------------------
export class ArmAppearanceConfigDto {
    @ApiProperty({ example: 'Vazirmatn', description: 'فونت بازار', required: false })
    @IsOptional()
    @IsString()
    fontFamily?: string;

    @ApiProperty({ example: true, description: 'نمایش نشان تأیید شده' })
    @IsBoolean()
    showVerifiedBadge: boolean;

    @ApiProperty({ example: true, description: 'نمایش نام کسب‌وکار' })
    @IsBoolean()
    showCompanyName: boolean;

    @ApiProperty({ example: true, description: 'نمایش دکمه درخواست خرید' })
    @IsBoolean()
    showBuyLeadButton: boolean;

    @ApiProperty({ example: true, description: 'نمایش نوار جستجو' })
    @IsBoolean()
    showSearchBar: boolean;

    @ApiProperty({ example: true, description: 'نمایش فیلتر دسته‌بندی' })
    @IsBoolean()
    showCategoryFilter: boolean;

    @ApiProperty({ example: true, description: 'نمایش فیلتر مکان' })
    @IsBoolean()
    showLocationFilter: boolean;

    @ApiProperty({ example: null, description: 'فیلترهای پیش‌فرض', required: false })
    @IsOptional()
    @IsObject()
    defaultFilters?: any;

    @ApiProperty({ example: ['category', 'location', 'price'], description: 'فیلترهای فعال', required: false })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    availableFilters?: string[];
}

// ------------------------------------------------------------
// 2. Features (ویژگی‌ها و قوانین محتوا)
// ------------------------------------------------------------
export class ArmFeaturesConfigDto {
    @ApiProperty({ example: true, description: 'امکان انتشار ناشناس' })
    @IsBoolean()
    allowAnonymousPublishing: boolean;

    @ApiProperty({ example: true, description: 'فعال بودن تابلوی درخواست خرید' })
    @IsBoolean()
    enableBuyLead: boolean;

    @ApiProperty({ example: false, description: 'فعال بودن اشتراک' })
    @IsBoolean()
    subscriptionEnabled: boolean;

    @ApiProperty({ example: true, description: 'نیاز به نام کسب‌وکار' })
    @IsBoolean()
    requireBusinessName: boolean;

    @ApiProperty({ example: true, description: 'نیاز به شهر' })
    @IsBoolean()
    requireCity: boolean;

    @ApiProperty({ example: true, description: 'نیاز به نوع کسب‌وکار' })
    @IsBoolean()
    requireType: boolean;

    @ApiProperty({ example: true, description: 'تأیید خودکار آگهی‌ها' })
    @IsBoolean()
    autoApproveAds: boolean;

    @ApiProperty({ example: false, description: 'نیاز به مجوز کسب‌وکار' })
    @IsBoolean()
    requireBusinessLicense: boolean;

    @ApiProperty({ example: 7, description: 'مدت اعتبار پیش‌فرض آگهی (روز)' })
    @IsNumber()
    @Min(1)
    adValidityDefaultDays: number;

    @ApiProperty({ example: 5, description: 'حداکثر تعداد آگهی رایگان' })
    @IsNumber()
    @Min(0)
    maxTotalFreeAdPerUser: number;
}

// ------------------------------------------------------------
// 3. Credit Rules (قوانین اعتبارات)
// ------------------------------------------------------------
export class ArmCreditRulesDto {
    @ApiProperty({ example: 50, description: 'هدیه ثبت‌نام' })
    @IsNumber()
    @Min(0)
    signupBonus: number;

    @ApiProperty({ example: 20, description: 'پاداش دعوت' })
    @IsNumber()
    @Min(0)
    referralBonus: number;

    @ApiProperty({ example: 2, description: 'پاداش ورود روزانه' })
    @IsNumber()
    @Min(0)
    dailyLoginBonus: number;

    @ApiProperty({ example: 1, description: 'پاداش کامنت' })
    @IsNumber()
    @Min(0)
    commentBonus: number;

    @ApiProperty({ example: 0, description: 'پاداش بازدید آگهی' })
    @IsNumber()
    @Min(0)
    adViewBonus: number;

    @ApiProperty({ example: 100, description: 'سقف درآمد روزانه' })
    @IsNumber()
    @Min(0)
    maxDailyEarn: number;

    @ApiProperty({ example: 10000, description: 'سقف موجودی' })
    @IsNumber()
    @Min(0)
    maxBalance: number;

    @ApiProperty({ example: 10, description: 'حداکثر دعوت پاداش‌دار' })
    @IsNumber()
    @Min(0)
    referralMaxCount: number;
}

// ------------------------------------------------------------
// 4. Economy (اقتصاد)
// ------------------------------------------------------------
// در ArmEconomyConfigDto
export class ArmEconomyConfigDto {
    @ApiProperty({ example: 'IRR', description: 'واحد پول' })
    @IsString()
    @IsIn(['IRR', 'USD', 'EUR', 'BTC'])
    currency: string;

    @ApiProperty({ example: 10, description: 'هزینه نردبان (اعتبار)' })
    @IsNumber()
    @Min(0)
    bumpCost: number;

    // ✅ اضافه شود: قیمت هر واحد اعتبار به تومان
    @ApiProperty({ example: 2000, description: 'قیمت هر واحد اعتبار به تومان' })
    @IsNumber()
    @Min(0)
    creditPrice: number;  // ← اینجا

    @ApiProperty({ type: ArmCreditRulesDto, description: 'قوانین اعتبارات' })
    @ValidateNested()
    @Type(() => ArmCreditRulesDto)
    creditRules: ArmCreditRulesDto;
}

// ------------------------------------------------------------
// 5. Payment Gateway (تنظیمات درگاه پرداخت)
// ------------------------------------------------------------
export class PaymentGatewayConfigDto {
    @ApiProperty({ example: 'pec', description: 'نام درگاه' })
    @IsString()
    name: string;

    @ApiProperty({ example: '44970783', description: 'شناسه پذیرنده', required: false })
    @IsOptional()
    @IsString()
    merchantId?: string;

    @ApiProperty({ example: 'your-pin', description: 'PIN درگاه', required: false })
    @IsOptional()
    @IsString()
    pin?: string;

    @ApiProperty({ example: false, description: 'حالت تست' })
    @IsBoolean()
    sandbox: boolean;

    @ApiProperty({ example: 'https://my-arm.com/payment/verify', description: 'آدرس بازگشت' })
    @IsString()
    callbackUrl: string;

    @ApiProperty({ example: { secretKey: 'sk_live_...' }, description: 'تنظیمات اختصاصی درگاه', required: false })
    @IsOptional()
    @IsObject()
    extra?: any;
}

// ------------------------------------------------------------
// 6. Settlement Account (حساب تسویه)
// ------------------------------------------------------------
export class SettlementAccountDto {
    @ApiProperty({ example: 'bank_card', description: 'نوع حساب', enum: ['bank_card', 'sheba', 'crypto_wallet', 'paypal_email'] })
    @IsString()
    @IsIn(['bank_card', 'sheba', 'crypto_wallet', 'paypal_email'])
    type: string;

    @ApiProperty({ example: '6037-9912-3456-7890', description: 'مقدار (شماره کارت، شبا، آدرس کیف‌پول، ایمیل)' })
    @IsString()
    value: string;
}

// ------------------------------------------------------------
// 7. Manual Payment (پرداخت فیشی)
// ------------------------------------------------------------
export class ManualPaymentConfigDto {
    @ApiProperty({ example: true, description: 'فعال بودن پرداخت کارت به کارت (فیشی)' })
    @IsBoolean()
    enabled: boolean;

    @ApiProperty({ example: '6037-9912-3456-7890', description: 'شماره کارت بانکی', required: false })
    @IsOptional()
    @IsString()
    cardNumber?: string;

    @ApiProperty({ example: 'IR12-3456-7890-1234-5678-9012', description: 'شماره شبا', required: false })
    @IsOptional()
    @IsString()
    shebaNumber?: string;

    @ApiProperty({ example: 'علی محمدی', description: 'نام صاحب حساب', required: false })
    @IsOptional()
    @IsString()
    accountOwner?: string;

    @ApiProperty({ example: 'بانک ملت', description: 'نام بانک', required: false })
    @IsOptional()
    @IsString()
    bankName?: string;

    @ApiProperty({ example: 'واریز مبلغ دقیق به همراه شناسه تراکنش', description: 'توضیحات برای کاربر', required: false })
    @IsOptional()
    @IsString()
    instructions?: string;
}

// ------------------------------------------------------------
// 8. Payment (تنظیمات پرداخت کامل)
// ------------------------------------------------------------
export class ArmPaymentConfigDto {
    @ApiProperty({
        example: 'both',
        description: 'روش‌های پرداخت فعال',
        enum: ['online_only', 'manual_only', 'both'],
    })
    @IsString()
    @IsIn(['online_only', 'manual_only', 'both'])
    paymentMode: 'online_only' | 'manual_only' | 'both';

    @ApiProperty({ example: 'pec', description: 'درگاه پیش‌فرض (فقط در حالت online)', required: false })
    @IsOptional()
    @IsString()
    defaultGateway?: string;

    @ApiProperty({ type: [PaymentGatewayConfigDto], description: 'لیست درگاه‌های آنلاین', required: false })
    @IsOptional()
    @ValidateNested({ each: true })
    @Type(() => PaymentGatewayConfigDto)
    gateways?: PaymentGatewayConfigDto[];

    @ApiProperty({ type: ManualPaymentConfigDto, description: 'تنظیمات پرداخت کارت به کارت (فیشی)' })
    @ValidateNested()
    @Type(() => ManualPaymentConfigDto)
    manual: ManualPaymentConfigDto;

    @ApiProperty({ type: SettlementAccountDto, description: 'حساب تسویه' })
    @ValidateNested()
    @Type(() => SettlementAccountDto)
    settlementAccount: SettlementAccountDto;
}

// ------------------------------------------------------------
// 9. Category Selection (انتخاب دسته‌بندی)
// ------------------------------------------------------------

export class CategorySelectionDto {
    @ApiProperty({ example: '6a5845e89cc29349ab4062cf' })
    @IsString()
    categoryId: string;

    @ApiProperty({ example: 'آجر سفال', required: false })
    @IsOptional()
    @IsString()
    customLabel?: string;

    @ApiProperty({ example: '6a5845df9cc29349ab405ebb' })
    @IsString()
    overrideUnitId: string; // ← این باید اجباری شود

    @ApiProperty({ example: 'تن' })
    @IsString()
    overrideUnitTitle: string; // ← اضافه شود

    @ApiProperty({ example: 1000, required: false })
    @IsOptional()
    @IsNumber()
    @Min(0)
    overrideMinQuantity?: number;

    @ApiProperty({ example: 0 })
    @IsNumber()
    @Min(0)
    displayPriority: number;

    @ApiProperty({ example: true })
    @IsBoolean()
    isActive: boolean;
}

// ------------------------------------------------------------
// 10. Location Selection (انتخاب موقعیت جغرافیایی)
// ------------------------------------------------------------
export class LocationSelectionDto {
    @ApiProperty({ example: '6a5950314ac0957d6a72dde2', description: 'شناسه موقعیت از Location' })
    @IsString()
    locationId: string;

    @ApiProperty({ example: 'ملایر', description: 'برچسب سفارشی', required: false })
    @IsOptional()
    @IsString()
    customLabel?: string;

    @ApiProperty({ example: 0, description: 'اولویت نمایش' })
    @IsNumber()
    @Min(0)
    displayPriority: number;

    @ApiProperty({ example: true, description: 'فعال بودن' })
    @IsBoolean()
    isActive: boolean;
}

// ------------------------------------------------------------
// 11. Localization (محلی‌سازی)
// ------------------------------------------------------------
export class ArmLocalizationConfigDto {
    @ApiProperty({ example: 'Asia/Tehran', description: 'منطقه زمانی' })
    @IsString()
    timezone: string;

    @ApiProperty({ example: 'fa', description: 'زبان پیش‌فرض' })
    @IsString()
    locale: string;
}

// ------------------------------------------------------------
// 12. Arm Config (ساختار اصلی Config)
// ------------------------------------------------------------
export class ArmConfigDto {
    @ApiProperty({ type: ArmAppearanceConfigDto, description: 'تنظیمات ظاهر' })
    @ValidateNested()
    @Type(() => ArmAppearanceConfigDto)
    appearance: ArmAppearanceConfigDto;

    @ApiProperty({ type: ArmFeaturesConfigDto, description: 'تنظیمات ویژگی‌ها و قوانین' })
    @ValidateNested()
    @Type(() => ArmFeaturesConfigDto)
    features: ArmFeaturesConfigDto;

    @ApiProperty({ type: ArmEconomyConfigDto, description: 'تنظیمات اقتصادی' })
    @ValidateNested()
    @Type(() => ArmEconomyConfigDto)
    economy: ArmEconomyConfigDto;

    @ApiProperty({ type: ArmPaymentConfigDto, description: 'تنظیمات پرداخت', required: false })
    @IsOptional()
    @ValidateNested()
    @Type(() => ArmPaymentConfigDto)
    payment?: ArmPaymentConfigDto;


    @ApiProperty({
        type: [String],
        description: 'لیست شناسه‌های گره‌های سطح بالا (شاخه‌ها) که بازار فقط می‌تواند زیرمجموعه‌های آنها را انتخاب کند',
        example: ['6a5b7ccc6123693a53f20ae1', '6a5b7ccc6123693a53f20ae2'],
        required: false,
    })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    allowedCategoryScope?: string[];

    @ApiProperty({ type: [CategorySelectionDto], description: 'دسته‌بندی‌های انتخاب‌شده' })
    @ValidateNested({ each: true })
    @Type(() => CategorySelectionDto)
    categorySelections: CategorySelectionDto[];

    @ApiProperty({ type: [LocationSelectionDto], description: 'موقعیت‌های انتخاب‌شده' })
    @ValidateNested({ each: true })
    @Type(() => LocationSelectionDto)
    locationSelections: LocationSelectionDto[];

    @ApiProperty({ type: ArmLocalizationConfigDto, description: 'تنظیمات محلی‌سازی' })
    @ValidateNested()
    @Type(() => ArmLocalizationConfigDto)
    localization: ArmLocalizationConfigDto;

    // ✅ صنوف هدف بازار (Industry – نه Activity)
    @ApiProperty({
        type: [String],
        description: 'لیست شناسه‌های صنوف تامین‌کننده (فروشندگان) – از مدل Industry',
        example: ['6a595...', '6a595...'],
        required: false,
    })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    supplierIndustryIds?: string[];

    @ApiProperty({
        type: [String],
        description: 'لیست شناسه‌های صنوف خریدار – از مدل Industry',
        example: ['6a595...', '6a595...'],
        required: false,
    })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    buyerIndustryIds?: string[];

    @ApiProperty({
        example: true,
        description: 'آیا کاربر می‌تواند بدون تطابق صنف، نقش خود را انتخاب کند؟',
        required: false,
        default: true,
    })
    @IsOptional()
    @IsBoolean()
    allowManualRoleSelection?: boolean;

    @ApiProperty({ example: {}, description: 'تنظیمات یکپارچه‌سازی با سرویس‌های خارجی', required: false })
    @IsOptional()
    @IsObject()
    integrations?: any;

    @ApiProperty({ example: {}, description: 'تنظیمات سفارشی و آینده', required: false })
    @IsOptional()
    @IsObject()
    custom?: any;
}

// ============================================================
// DTO اصلی CreateArmDto
// ============================================================
export class CreateArmDto {
    // ============================================================
    // فیلدهای اصلی Arm (در روت مدل)
    // ============================================================
    @ApiProperty({
        example: 'barton',
        description: 'شناسه یکتا در URL (فقط حروف انگلیسی، اعداد و خط تیره)',
    })
    @IsNotEmpty()
    @IsString()
    slug: string;

    @ApiProperty({
        example: 'بارتون',
        description: 'نام نمایشی بازار',
    })
    @IsNotEmpty()
    @IsString()
    name: string;

    @ApiProperty({
        example: 'قیمت امروز فروشندگان عمده مصالح',
        description: 'شعار بازار',
    })
    @IsNotEmpty()
    @IsString()
    slogan: string;

    @ApiProperty({
        example: 'تابلو مقایسه قیمت‌های مصالح ساختمانی',
        description: 'توضیحات بازار',
        required: false,
    })
    @IsOptional()
    @IsString()
    description?: string;

    @ApiProperty({
        example: 'https://arkan.ir',
        description: 'دامنه اختصاصی بازار',
        required: false,
    })
    @IsOptional()
    @IsString()
    customDomain?: string;

    @ApiProperty({
        example: 'construction',
        description: 'آیکون (نام آیکون از Material Symbols)',
        required: false,
    })
    @IsOptional()
    @IsString()
    icon?: string;

    @ApiProperty({
        example: '#8b0000',
        description: 'رنگ اصلی برند (به صورت HEX)',
        required: false,
    })
    @IsOptional()
    @IsString()
    colorPrimary?: string;

    @ApiProperty({
        example: '#904d00',
        description: 'رنگ ثانویه برند (به صورت HEX)',
        required: false,
    })
    @IsOptional()
    @IsString()
    colorSecondary?: string;

    @ApiProperty({
        example: '/images/logo.png',
        description: 'آدرس لوگوی بازار (پس از آپلود)',
        required: false,
    })
    @IsOptional()
    @IsString()
    logoUrl?: string;

    @ApiProperty({
        example: '/images/banner.png',
        description: 'آدرس بنر بازار (پس از آپلود)',
        required: false,
    })
    @IsOptional()
    @IsString()
    bannerUrl?: string;

    @ApiProperty({
        example: 'اتصال تولیدکنندگان و فروشندگان عمده مصالح ساختمانی به خریداران',
        description: 'مأموریت بازار (خلاصه‌ای از هدف و چشم‌انداز)',
        required: false,
    })
    @IsOptional()
    @IsString()
    mission?: string;

    @ApiProperty({
        example: 'active',
        description: 'وضعیت بازار',
        enum: ['draft', 'active', 'archived'],
        default: 'draft',
        required: false,
    })
    @IsOptional()
    @IsEnum(['draft', 'active', 'archived'])
    status?: string;

    @ApiProperty({
        example: 'public',
        description: 'دسترسی بازار',
        enum: ['public', 'private'],
        default: 'public',
        required: false,
    })
    @IsOptional()
    @IsEnum(['public', 'private'])
    visibility?: string;

    @ApiProperty({
        example: 'multi_city',
        description: 'نوع محدوده جغرافیایی',
        enum: ['country', 'province', 'city', 'multi_city'],
    })
    @IsNotEmpty()
    @IsEnum(['country', 'province', 'city', 'multi_city'])
    geoScopeType: string;

    @ApiProperty({
        example: '6a5845df9cc29349ab405ebb',
        description: 'شناسه واحد پیش‌فرض (از مدل Unit)',
        required: false,
    })
    @IsOptional()
    @IsString()
    defaultUnitId?: string;

    @ApiProperty({
        example: ['buy_lead', 'anonymous_posting'],
        description: 'لیست ویژگی‌های فعال',
        required: false,
        type: [String],
    })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    featuresEnabled?: string[];

    @ApiProperty({
        example: 'simple',
        description: 'الگوریتم رتبه‌بندی',
        enum: ['simple', 'weighted', 'ml'],
        default: 'simple',
        required: false,
    })
    @IsOptional()
    @IsEnum(['simple', 'weighted', 'ml'])
    rankingAlgorithm?: string;

    @ApiProperty({
        example: { source: 'web', version: '1.0' },
        description: 'داده‌های اضافی',
        required: false,
    })
    @IsOptional()
    @IsObject()
    metadata?: any;

    // ============================================================
    // فیلد config (همه تنظیمات بازار)
    // ============================================================
   /* @ApiProperty({
        type: ArmConfigDto,
        description: 'همه تنظیمات بازار',
    })
    @ValidateNested()
    @Type(() => ArmConfigDto)
    config: ArmConfigDto;*/

    @IsObject()
    config: any;   // بدون هیچ دکوراتور اعتبارسنجی داخلی
}