// src/business/business.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    IsNotEmpty,
    IsOptional,
    IsString,
    MaxLength,
    IsIn,
    IsNumber, IsArray, IsBoolean,
    Min, Max,
} from 'class-validator';

export class CreateBusinessDto {
    @ApiProperty({ example: 'شرکت پخش خوشگوار', description: 'نام کسب‌وکار' })
    @IsNotEmpty({ message: 'نام کسب‌وکار الزامی است' })
    @IsString()
    @MaxLength(120)
    name: string;

    @ApiPropertyOptional({
        example: 'distributor',
        description: '⚠️ legacy (deprecated) — به‌جاش از businessRole و businessSector استفاده کنید',
        enum: ['producer', 'wholesaler', 'importer', 'exporter', 'distributor', 'retailer', 'contractor', 'service_provider', 'other'],
        required: false,
    })
    @IsOptional()
    @IsIn(['producer', 'wholesaler', 'importer', 'exporter', 'distributor', 'retailer', 'contractor', 'service_provider', 'other'])
    type?: string;

    @ApiPropertyOptional({
        example: 'wholesaler',
        description: 'نوع دقیق فعالیت (سطح ۲ درخت BUSINESS_TYPE) — فیلد اصلی',
        required: false,
    })
    @IsOptional()
    @IsString()
    businessRole?: string;

    @ApiPropertyOptional({
        example: 'distribution',
        description: 'دسته‌بندی کسب‌وکار (سطح ۱ درخت BUSINESS_TYPE) — برای فیلتر',
        required: false,
    })
    @IsOptional()
    @IsString()
    businessSector?: string;

    @ApiPropertyOptional({ example: 'پخش مواد غذایی', required: false })
    @IsOptional()
    @IsString()
    @MaxLength(60)
    industryName?: string;

    @ApiPropertyOptional({ example: '6a5950314ac0957d6a72dde2', description: 'شناسه صنف (Industry)', required: false })
    @IsOptional()
    @IsString()
    industryId?: string;

    @ApiPropertyOptional({ example: 'پخش انواع نوشیدنی', required: false })
    @IsOptional()
    @IsString()
    shortDescription?: string;

    @ApiPropertyOptional({ required: false })
    @IsOptional()
    @IsString()
    description?: string;

    @ApiPropertyOptional({ required: false })
    @IsOptional()
    @IsString()
    province?: string;

    @ApiPropertyOptional({ required: false })
    @IsOptional()
    @IsString()
    provinceCode?: string;

    @ApiPropertyOptional({ required: false })
    @IsOptional()
    @IsString()
    city?: string;

    @ApiPropertyOptional({ required: false })
    @IsOptional()
    @IsString()
    cityCode?: string;

    @ApiPropertyOptional({ example: 35.6892, description: 'عرض جغرافیایی لوکیشن دقیق کسب‌وکار (اختیاری)', required: false })
    @IsOptional()
    @IsNumber()
    @Min(-90)
    @Max(90)
    locationLat?: number;

    @ApiPropertyOptional({ example: 51.389, description: 'طول جغرافیایی لوکیشن دقیق کسب‌وکار (اختیاری)', required: false })
    @IsOptional()
    @IsNumber()
    @Min(-180)
    @Max(180)
    locationLng?: number;

    @ApiPropertyOptional({ required: false })
    @IsOptional()
    @IsString()
    address?: string;

    @ApiPropertyOptional({ required: false })
    @IsOptional()
    @IsString()
    phone?: string;

    @ApiPropertyOptional({ required: false })
    @IsOptional()
    @IsString()
    website?: string;

    @ApiPropertyOptional({ required: false })
    @IsOptional()
    @IsString()
    logoUrl?: string;

    @ApiPropertyOptional({ example: '1234567890', required: false })
    @IsOptional()
    @IsString()
    @MaxLength(10)
    nationalId?: string;

    @ApiPropertyOptional({ required: false })
    @IsOptional()
    @IsString()
    businessLicense?: string;

    @ApiPropertyOptional({ example: 1395, description: 'سال شروع فعالیت تجاری', required: false })
    @IsOptional()
    @IsNumber()
    businessStartYear?: number;

    @ApiPropertyOptional({
        example: false,
        description: 'با true، هشدار کسب‌وکار مشابه نادیده گرفته می‌شود (کاربر صریحاً ثبتِ جدید را انتخاب کرده)',
        required: false,
    })
    @IsOptional()
    @IsBoolean()
    force?: boolean;

    @ApiPropertyOptional({
        example: 'مدیر فروش',
        description: 'پست/سمتِ ثبت‌کننده در کسب‌وکار — روی تیم کسب‌وکار (BusinessMember) ثبت می‌شود',
        required: false,
    })
    @IsOptional()
    @IsString()
    @MaxLength(60)
    position?: string;
}

export class UpdateBusinessDto {
    @ApiPropertyOptional({ required: false })
    @IsOptional()
    @IsString()
    @MaxLength(120)
    name?: string;

    @ApiPropertyOptional({ required: false })
    @IsOptional()
    @IsIn(['producer', 'wholesaler', 'importer', 'exporter', 'distributor', 'retailer', 'contractor', 'service_provider', 'other'])
    type?: string;

    @ApiPropertyOptional({
        example: 'wholesaler',
        description: 'نوع دقیق فعالیت (سطح ۲ درخت BUSINESS_TYPE) — فیلد اصلی',
        required: false,
    })
    @IsOptional()
    @IsString()
    businessRole?: string;

    @ApiPropertyOptional({
        example: 'distribution',
        description: 'دسته‌بندی کسب‌وکار (سطح ۱ درخت BUSINESS_TYPE) — برای فیلتر',
        required: false,
    })
    @IsOptional()
    @IsString()
    businessSector?: string;

    @ApiPropertyOptional({ required: false })
    @IsOptional()
    @IsString()
    @MaxLength(60)
    industryName?: string;

    @ApiPropertyOptional({ example: '6a5950314ac0957d6a72dde2', description: 'شناسه صنف (Industry)', required: false })
    @IsOptional()
    @IsString()
    industryId?: string;

    @ApiPropertyOptional({ required: false })
    @IsOptional()
    @IsString()
    shortDescription?: string;

    @ApiPropertyOptional({ required: false })
    @IsOptional()
    @IsString()
    description?: string;

    @ApiPropertyOptional({ required: false })
    @IsOptional()
    @IsString()
    province?: string;

    @ApiPropertyOptional({ required: false })
    @IsOptional()
    @IsString()
    provinceCode?: string;

    @ApiPropertyOptional({ required: false })
    @IsOptional()
    @IsString()
    city?: string;

    @ApiPropertyOptional({ required: false })
    @IsOptional()
    @IsString()
    cityCode?: string;

    @ApiPropertyOptional({ example: 35.6892, description: 'عرض جغرافیایی لوکیشن دقیق کسب‌وکار (اختیاری) — با null حذف می‌شود', required: false })
    @IsOptional()
    @IsNumber()
    @Min(-90)
    @Max(90)
    locationLat?: number;

    @ApiPropertyOptional({ example: 51.389, description: 'طول جغرافیایی لوکیشن دقیق کسب‌وکار (اختیاری) — با null حذف می‌شود', required: false })
    @IsOptional()
    @IsNumber()
    @Min(-180)
    @Max(180)
    locationLng?: number;

    @ApiPropertyOptional({ required: false })
    @IsOptional()
    @IsString()
    address?: string;

    @ApiPropertyOptional({ required: false })
    @IsOptional()
    @IsString()
    phone?: string;

    @ApiPropertyOptional({ required: false })
    @IsOptional()
    @IsString()
    website?: string;

    @ApiPropertyOptional({ required: false })
    @IsOptional()
    @IsString()
    logoUrl?: string;

    @ApiPropertyOptional({ required: false })
    @IsOptional()
    @IsString()
    @MaxLength(10)
    nationalId?: string;

    @ApiPropertyOptional({ required: false })
    @IsOptional()
    @IsString()
    businessLicense?: string;

    @ApiPropertyOptional({ required: false })
    @IsOptional()
    @IsNumber()
    businessStartYear?: number;
}

export class RequestBusinessVerificationDto {
    @ApiProperty({ enum: ['blue', 'silver', 'gold'] })
    @IsNotEmpty()
    @IsIn(['blue', 'silver', 'gold'])
    level: string;

    @ApiProperty({ example: '1234567890' })
    @IsNotEmpty()
    @IsString()
    nationalId: string;

    @ApiPropertyOptional({ required: false, description: 'شناسه فایل کارت ملی (در صورت تأیید قبلی اختیاری)' })
    @IsOptional()
    @IsString()
    nationalCardFileId?: string;

    @ApiPropertyOptional({ required: false })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    licenseFileIds?: string[];

    @ApiPropertyOptional({ required: false })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    awardFileIds?: string[];
}

// ============================================================
// تیم کاری کسب‌وکار — افزودن/ویرایش اعضا (فقط مدیر کسب‌وکار)
// دو سطح نقش:
//   • نقش سیستمی: role = admin | member (سازندهٔ کسب‌وکار ادمین است)
//   • نقش شرکتی: position — از لیست USER_POSITIONS یا متن آزاد «سایر»
// ============================================================
export class AddBusinessMemberDto {
    @ApiPropertyOptional({
        example: '09123456789',
        description: 'شماره موبایل کاربر (باید در دی مچ ثبت‌نام کرده باشد) — یا userId بدهید',
        required: false,
    })
    @IsOptional()
    @IsString()
    phone?: string;

    @ApiPropertyOptional({
        description: 'شناسهٔ کاربر از جستجوی GET /business/search-users — مسیر ترجیحی افزودن',
        required: false,
    })
    @IsOptional()
    @IsString()
    userId?: string;

    @ApiPropertyOptional({ example: 'کارشناس فروش', description: 'نقش شرکتی در کسب‌وکار', required: false })
    @IsOptional()
    @IsString()
    @MaxLength(60)
    position?: string;

    @ApiPropertyOptional({ enum: ['admin', 'member'], default: 'member', description: 'نقش سیستمی', required: false })
    @IsOptional()
    @IsIn(['admin', 'member'])
    role?: string;
}

export class UpdateBusinessMemberDto {
    @ApiPropertyOptional({ example: 'مدیر فروش', description: 'نقش شرکتی در کسب‌وکار', required: false })
    @IsOptional()
    @IsString()
    @MaxLength(60)
    position?: string;

    @ApiPropertyOptional({ enum: ['admin', 'member'], description: 'نقش سیستمی — واگذاری/سلب مدیریت', required: false })
    @IsOptional()
    @IsIn(['admin', 'member'])
    role?: string;
}

// ============================================================
// زمینه‌های فعالیت کسب‌وکار — جایگزینی کامل لیست (آرایهٔ خالی = پاک‌سازی)
// ============================================================
export class SetBusinessActivitiesDto {
    @ApiProperty({ type: [String], description: 'شناسه فعالیت‌ها (برگ‌های درخت فعالیت)' })
    @IsArray()
    @IsString({ each: true })
    activityIds: string[];
}