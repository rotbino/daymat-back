// src/inquiry/inquiry.dto.ts
// کاتالوگ خرید (استعلام قیمت) — DTO ها
// فلسفه: ساده به‌صورت پیش‌فرض (فقط عنوان + چند قلم)، پیشرفته اختیاری
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    IsNotEmpty, IsOptional, IsString, MaxLength, IsIn, IsNumber,
    IsArray, IsISO8601, ArrayMaxSize, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class InquiryItemDto {
    @ApiProperty({ example: 'گوجه‌فرنگی', description: 'نام کالا/قطعه — تنها فیلد اجباری' })
    @IsNotEmpty({ message: 'نام قلم الزامی است' })
    @IsString()
    @MaxLength(160)
    name: string;

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
}

export class CreateInquiryDto {
    @ApiProperty({ example: 'لیست خرید هفتگی سوپرمارکت', description: 'عنوان کاتالوگ خرید' })
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

    @ApiPropertyOptional({ enum: ['public', 'unlisted'], default: 'public', description: 'عمومی یا فقط با لینک' })
    @IsOptional()
    @IsIn(['public', 'unlisted'])
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
}

export class UpdateInquiryDto {
    @IsOptional() @IsString() @MaxLength(140) title?: string;
    @IsOptional() @IsString() @MaxLength(1500) description?: string;
    @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => InquiryItemDto)
    items?: InquiryItemDto[];
    @IsOptional() @IsIn(['public', 'unlisted']) visibility?: string;
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
