// src/inquiry/inquiry.dto.ts
// صفحه درخواست خرید (استعلام قیمت) — DTO ها
// فلسفه: ساده به‌صورت پیش‌فرض (فقط عنوان + چند قلم)، پیشرفته اختیاری
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    IsNotEmpty, IsOptional, IsString, MaxLength, IsIn, IsNumber, IsBoolean,
    IsArray, IsISO8601, ArrayMaxSize, ValidateNested, IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';

export class InquiryItemDto {
    @ApiProperty({ example: 'گوجه‌فرنگی', description: 'نام کالا/قطعه — تنها فیلد اجباری' })
    @IsNotEmpty({ message: 'نام قلم الزامی است' })
    @IsString()
    @MaxLength(160)
    name: string;

    @ApiPropertyOptional({ description: 'شناسه کالای مرجع (انتخاب از مرجع) — کلید معرفی تامین‌کنندهٔ مرتبط در آینده', required: false })
    @IsOptional()
    @IsString()
    referenceItemId?: string;

    @ApiPropertyOptional({ description: 'شناسه واحد از مرجع واحد', required: false })
    @IsOptional()
    @IsString()
    unitId?: string;

    @ApiPropertyOptional({ example: 500, description: 'مقدار', required: false })
    @IsOptional()
    @IsNumber()
    quantity?: number;

    @ApiPropertyOptional({ example: 'کیلوگرم', description: 'واحد — متن آزاد', required: false })
    @IsOptional()
    @IsString()
    @MaxLength(40)
    unit?: string;

    @ApiPropertyOptional({ example: 'سن‌مارکو', description: 'برند/سازندهٔ مدنظر (اختیاری)', required: false })
    @IsOptional()
    @IsString()
    @MaxLength(80)
    brand?: string;

    @ApiPropertyOptional({
        example: [{ key: 'قطر داخلی', value: '۴۵ میلی‌متر' }],
        description: 'مشخصات فنی اختیاری — برای قطعات صنعتی',
        required: false,
    })
    @IsOptional()
    @IsArray()
    specs?: { key: string; value: string }[];

    @ApiPropertyOptional({ description: 'عکس کالا/قطعه (اختیاری)', required: false })
    @IsOptional()
    @IsString()
    imageUrl?: string;

    @ApiPropertyOptional({ description: 'لینک نمونه/کاتالوگ سازنده (اختیاری)', required: false })
    @IsOptional()
    @IsString()
    referenceUrl?: string;

    @ApiPropertyOptional({ description: 'یادداشت روی قلم', required: false })
    @IsOptional()
    @IsString()
    @MaxLength(500)
    note?: string;

    @ApiPropertyOptional({ description: 'اعلام خرید فعال — قلم در «درخواست‌های خرید جاری» بالای کاتالوگ می‌نشیند', required: false })
    @IsOptional()
    @IsBoolean()
    urgent?: boolean;
}

export class InquiryUnitDto {
    @ApiProperty({ description: 'شناسه واحد از مرجع واحد' })
    @IsString()
    unitId: string;
}

/** ویرایش قلم — همهٔ فیلدها اختیاری (merge)؛ تاگل اعلام خرید با همین کار می‌کند */
export class UpdateInquiryItemDto {
    @ApiPropertyOptional({ description: 'نام کالا/قطعه', required: false })
    @IsOptional() @IsString() @MaxLength(160)
    name?: string;

    @IsOptional() @IsString() referenceItemId?: string;
    @IsOptional() @IsString() unitId?: string;
    @IsOptional() @IsNumber() quantity?: number;
    @IsOptional() @IsString() @MaxLength(40) unit?: string;
    @IsOptional() @IsString() @MaxLength(80) brand?: string;
    @IsOptional() @IsArray() specs?: { key: string; value: string }[];
    @IsOptional() @IsString() imageUrl?: string;
    @IsOptional() @IsString() referenceUrl?: string;
    @IsOptional() @IsString() @MaxLength(500) note?: string;
    @IsOptional() @IsBoolean() urgent?: boolean;
}

export class CreateInquiryDto {
    @ApiProperty({ example: 'لیست خرید هفتگی سوپرمارکت', description: 'عنوان صفحه درخواست خرید' })
    @IsNotEmpty({ message: 'عنوان الزامی است' })
    @IsString()
    @MaxLength(140)
    title: string;

    @ApiPropertyOptional({ description: 'توضیح کوتاه', required: false })
    @IsOptional()
    @IsString()
    @MaxLength(1500)
    description?: string;

    @ApiPropertyOptional({ type: [InquiryItemDto], description: 'اقلام خرید' })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(200)
    @ValidateNested({ each: true })
    @Type(() => InquiryItemDto)
    items?: InquiryItemDto[];

    @ApiPropertyOptional({ enum: ['public', 'unlisted', 'private'], default: 'public', description: 'عمومی (دیوار) | فقط با لینک | خصوصی (فقط تامین‌کننده‌های تاییدشده)' })
    @IsOptional()
    @IsIn(['public', 'unlisted', 'private'])
    visibility?: string;

    @ApiPropertyOptional({ example: '2026-09-20T18:00:00.000Z', description: 'مهلت پاسخ (اختیاری)', required: false })
    @IsOptional()
    @IsISO8601({})
    deadline?: string;

    @ApiPropertyOptional({ description: 'اسلاگ دلخواه (اختیاری)', required: false })
    @IsOptional()
    @IsString()
    @MaxLength(60)
    slug?: string;

    @ApiPropertyOptional({ description: 'استان', required: false })
    @IsOptional()
    @IsString()
    province?: string;

    @ApiPropertyOptional({ description: 'کد استان', required: false })
    @IsOptional()
    @IsString()
    provinceCode?: string;

    @ApiPropertyOptional({ description: 'شهر', required: false })
    @IsOptional()
    @IsString()
    city?: string;

    @ApiPropertyOptional({ description: 'کد شهر', required: false })
    @IsOptional()
    @IsString()
    cityCode?: string;

    @ApiPropertyOptional({ description: 'محل/شرایط تحویل', required: false })
    @IsOptional()
    @IsString()
    @MaxLength(400)
    deliveryNote?: string;

    @ApiPropertyOptional({ description: 'شرایط پرداخت', required: false })
    @IsOptional()
    @IsString()
    @MaxLength(400)
    paymentTerms?: string;

    @ApiPropertyOptional({ example: ['مواد غذایی', 'سبزیجات'], description: 'برچسب‌های صنف', required: false })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(10)
    @IsString({ each: true })
    tags?: string[];

    @ApiPropertyOptional({ description: 'کسب‌وکار صادرکننده (باید متعلق به کاربر باشد)', required: false })
    @IsOptional()
    @IsString()
    businessId?: string;

    @ApiPropertyOptional({ type: [InquiryUnitDto], description: 'واحدهای اختصاصی این صفحه درخواست خرید (از مرجع واحد)', required: false })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(50)
    @ValidateNested({ each: true })
    @Type(() => InquiryUnitDto)
    units?: InquiryUnitDto[];

    @ApiPropertyOptional({ description: 'امکان ارسال قیمت برای خریدهای غیر فوری (سایر کالاها)', required: false })
    @IsOptional()
    @IsBoolean()
    allowNonUrgentOffers?: boolean;
}

export class UpdateInquiryDto {
    @IsOptional() @IsString() @MaxLength(140) title?: string;
    @IsOptional() @IsString() @MaxLength(1500) description?: string;
    @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => InquiryItemDto)
    items?: InquiryItemDto[];
    @IsOptional() @IsIn(['public', 'unlisted', 'private']) visibility?: string;
    @IsOptional() @IsIn(['open', 'closed', 'archived']) status?: string;
    @IsOptional() @IsISO8601({}) deadline?: string;
    @IsOptional() @IsString() @MaxLength(60) slug?: string;
    @IsOptional() @IsString() province?: string;
    @IsOptional() @IsString() provinceCode?: string;
    @IsOptional() @IsString() city?: string;
    @IsOptional() @IsString() cityCode?: string;
    @IsOptional() @IsString() @MaxLength(400) deliveryNote?: string;
    @IsOptional() @IsString() @MaxLength(400) paymentTerms?: string;
    @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) tags?: string[];
    @ApiPropertyOptional({ description: 'کسب‌وکار صادرکننده (اختیاری — اتصال/تغییر/قطع اتصال با رشتهٔ خالی)', required: false })
    @IsOptional() @IsString() businessId?: string;
    @ApiPropertyOptional({ type: [InquiryUnitDto], description: 'واحدهای اختصاصی (جایگزینی کامل)', required: false })
    @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => InquiryUnitDto)
    units?: InquiryUnitDto[];
    @ApiPropertyOptional({ description: 'امکان ارسال قیمت برای خریدهای غیر فوری (سایر کالاها)', required: false })
    @IsOptional() @IsBoolean() allowNonUrgentOffers?: boolean;
}

export class CreateOfferDto {
    @ApiPropertyOptional({ description: 'شناسه قلم — خالی = پیشنهاد روی کل لیست', required: false })
    @IsOptional()
    @IsString()
    itemId?: string;

    @ApiProperty({ example: 12500000, description: 'مبلغ پیشنهادی' })
    @IsNumber()
    price: number;

    @ApiPropertyOptional({ example: 'IRT', description: 'واحد پول — پیش‌فرض تومان' })
    @IsOptional()
    @IsString()
    currency?: string;

    @ApiPropertyOptional({ example: 'جمع کل', description: 'مبنا: جمع کل / هر کیلو / هر عدد' })
    @IsOptional()
    @IsString()
    @MaxLength(40)
    priceBasis?: string;

    @ApiPropertyOptional({ example: 3, description: 'زمان تحویل تخمینی (روز)' })
    @IsOptional()
    @IsNumber()
    deliveryDays?: number;

    @ApiPropertyOptional({ description: 'پیام تامین‌کننده' })
    @IsOptional()
    @IsString()
    @MaxLength(800)
    message?: string;

    @ApiPropertyOptional({ description: 'تلفن تماس (اختیاری — از پروفایل)' })
    @IsOptional()
    @IsString()
    @MaxLength(20)
    contactPhone?: string;

    @ApiPropertyOptional({ description: 'کسب‌وکار ارائه‌دهندهٔ پیشنهاد', required: false })
    @IsOptional()
    @IsString()
    businessId?: string;
}

export class UpdateOfferDto {
    @ApiProperty({ enum: ['accepted', 'rejected', 'withdrawn'], description: 'پذیرش/رد توسط مالک، انصراف توسط پیشنهاددهنده' })
    @IsIn(['accepted', 'rejected', 'withdrawn'])
    status: string;
}

// ═══ اعضای صفحه درخواست خرید — تامین‌کننده‌های تاییدشده (شبکهٔ خرید↔فروش) ═══

export class AddInquiryMemberDto {
    @ApiProperty({ description: 'کاتالوگ فروشِ تامین‌کننده (باید متعلق به تامین‌کننده باشد)' })
    @IsNotEmpty({ message: 'کاتالوگ تامین‌کننده الزامی است' })
    @IsString()
    catalogId: string;

    @ApiPropertyOptional({ description: 'یادداشت دعوت', required: false })
    @IsOptional()
    @IsString()
    @MaxLength(300)
    note?: string;
}

export class RequestInquiryAccessDto {
    @ApiProperty({ description: 'کاتالوگ فروش خودم که با آن درخواست عضویت می‌دهم' })
    @IsNotEmpty({ message: 'کاتالوگ فروش الزامی است' })
    @IsString()
    catalogId: string;

    @ApiPropertyOptional({ description: 'پیام به خریدار', required: false })
    @IsOptional()
    @IsString()
    @MaxLength(300)
    note?: string;
}

/** تغییر وضعیت عضو — تایید/رد/حذف؛ نقش مجاز در سرویس تشخیص داده می‌شود */
export class DecideInquiryMemberDto {
    @ApiProperty({ enum: ['active', 'declined', 'removed'], description: 'تایید (active) | رد (declined) | حذف/خروج (removed)' })
    @IsIn(['active', 'declined', 'removed'])
    status: 'active' | 'declined' | 'removed';
}

/** 🪪 ذخیره/حذف مشخصات کارت ویزیت صفحه درخواست خرید (JSON) — قرینهٔ کاتالوگ فروش */
export class SaveInquiryVisitCardDto {
    /** مشخصات کامل کارت ویزیت (JSON آزاد — فشرده‌سازی تصاویر سمت کلاینت) — null = حذف کارت ذخیره‌شده */
    @ApiPropertyOptional({ description: 'مشخصات کارت ویزیت (JSON) — null برای حذف', nullable: true, type: Object })
    @IsOptional()
    @IsObject()
    spec?: Record<string, any> | null;
}
