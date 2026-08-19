// src/business/business.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import {
    IsNotEmpty,
    IsString,
    IsOptional,
    IsEnum,
    IsArray,
} from 'class-validator';

export class CreateBusinessDto {
    @ApiProperty({ example: 'پخش مصالح نارین', description: 'نام کسب‌وکار' })
    @IsNotEmpty({ message: 'نام کسب‌وکار الزامی است' })
    @IsString()
    name: string;


    @ApiProperty({ example: 'پخش عمده مصالح ساختمانی', required: false })
    @IsOptional()
    @IsString()
    shortDescription?: string;


    @ApiProperty({
        example: 'wholesaler',
        description: 'نوع کسب‌وکار',
        enum: ['producer', 'wholesaler', 'importer', 'exporter', 'distributor', 'retailer', 'contractor', 'service_provider', 'other'],
    })
    @IsNotEmpty({ message: 'نوع کسب‌وکار الزامی است' })
    @IsEnum(['producer', 'wholesaler', 'importer', 'exporter', 'distributor', 'retailer', 'contractor', 'service_provider', 'other'])
    type: string;

    @ApiProperty({ example: '98', required: false, default: '98' })
    @IsOptional()
    @IsString()
    countryCode?: string;


    @ApiProperty({ example: 'تهران', description: 'شهر', required: false })
    @IsOptional()
    @IsString()
    city?: string;

    @ApiProperty({ example: 'تهران', description: 'استان', required: false })
    @IsOptional()
    @IsString()
    province?: string;

    @ApiProperty({ example: '01', description: 'کد استان', required: false })
    @IsOptional()
    @IsString()
    provinceCode?: string;

    @ApiProperty({ example: '0112', description: 'کد شهر', required: false })
    @IsOptional()
    @IsString()
    cityCode?: string;

    @ApiProperty({ example: '021-12345678', description: 'تلفن', required: false })
    @IsOptional()
    @IsString()
    phone?: string;

    @ApiProperty({ example: 'توضیحات درباره کسب‌وکار', description: 'توضیحات', required: false })
    @IsOptional()
    @IsString()
    description?: string;

    @ApiProperty({ example: 'https://example.com/logo.png', description: 'آدرس لوگو', required: false })
    @IsOptional()
    @IsString()
    logoUrl?: string;

    @ApiProperty({ example: 'آدرس کامل', description: 'آدرس', required: false })
    @IsOptional()
    @IsString()
    address?: string;

    @ApiProperty({ example: 'https://example.com', description: 'وب‌سایت', required: false })
    @IsOptional()
    @IsString()
    website?: string;

    @ApiProperty({ example: 'صاحب کسب‌وکار', description: 'سمت کاربر در کسب‌وکار', required: false })
    @IsOptional()
    @IsString()
    position?: string;

    @ApiProperty({ example: '6a577c6da5d63434e0ac34a0', description: 'شناسه فایل لوگو', required: false })
    @IsOptional()
    @IsString()
    logoFileId?: string;

    @ApiProperty({ example: '6a5950314ac0957d6a72dde2', description: 'شناسه صنف اصلی (Industry)', required: false })
    @IsOptional()
    @IsString()
    industryId?: string;
    @IsOptional()
    @IsString()
    industryName?: string;

    @ApiProperty({ example: ['6a595...', '6a595...'], description: 'لیست شناسه فعالیت‌ها (Activity)', required: false })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    activityIds?: string[];

    @ApiProperty({
        example: 'barton',
        description: 'شناسه یکتای بازار (slug)',
        required: true,
    })
    @IsNotEmpty({ message: 'شناسه بازار الزامی است' })
    @IsString()
    armSlug: string;
}

export class UpdateBusinessDto {
    @ApiProperty({ example: 'بازرگانی آهن مرکزی', description: 'نام کسب‌وکار', required: false })
    @IsOptional()
    @IsString()
    name?: string;

    @ApiProperty({ example: 'پخش عمده مصالح ساختمانی', description: 'معرفی کوتاه کسب‌وکار', required: false })
    @IsOptional()
    @IsString()
    shortDescription?: string;  // ✅ اضافه شد

    @ApiProperty({
        example: 'wholesaler',
        description: 'نوع کسب‌وکار',
        enum: ['producer', 'wholesaler', 'importer', 'exporter', 'distributor', 'retailer', 'contractor', 'service_provider', 'other'],
        required: false,
    })
    @IsOptional()
    @IsEnum(['producer', 'wholesaler', 'importer', 'exporter', 'distributor', 'retailer', 'contractor', 'service_provider', 'other'])
    type?: string;

    @ApiProperty({ example: 'تهران', description: 'شهر', required: false })
    @IsOptional()
    @IsString()
    city?: string;

    @ApiProperty({ example: 'تهران', description: 'استان', required: false })
    @IsOptional()
    @IsString()
    province?: string;

    @ApiProperty({ example: '01', description: 'کد استان', required: false })
    @IsOptional()
    @IsString()
    provinceCode?: string;

    @ApiProperty({ example: '0112', description: 'کد شهر', required: false })
    @IsOptional()
    @IsString()
    cityCode?: string;

    @ApiProperty({ example: '021-12345678', description: 'تلفن', required: false })
    @IsOptional()
    @IsString()
    phone?: string;

    @ApiProperty({ example: 'توضیحات درباره کسب‌وکار', description: 'توضیحات', required: false })
    @IsOptional()
    @IsString()
    description?: string;

    @ApiProperty({ example: 'https://example.com/logo.png', description: 'آدرس لوگو', required: false })
    @IsOptional()
    @IsString()
    logoUrl?: string;

    @ApiProperty({ example: 'آدرس کامل', description: 'آدرس', required: false })
    @IsOptional()
    @IsString()
    address?: string;

    @ApiProperty({ example: 'https://example.com', description: 'وب‌سایت', required: false })
    @IsOptional()
    @IsString()
    website?: string;

    @ApiProperty({ example: 'صاحب کسب‌وکار', description: 'سمت کاربر در کسب‌وکار', required: false })
    @IsOptional()
    @IsString()
    position?: string;

    @ApiProperty({ example: '6a577c6da5d63434e0ac34a0', description: 'شناسه فایل لوگو', required: false })
    @IsOptional()
    @IsString()
    logoFileId?: string;

    @ApiProperty({ example: '6a5950314ac0957d6a72dde2', description: 'شناسه صنف اصلی (Industry)', required: false })
    @IsOptional()
    @IsString()
    industryId?: string;

    @IsOptional()
    @IsString()
    industryName?: string;

    @ApiProperty({ example: ['6a595...', '6a595...'], description: 'لیست شناسه فعالیت‌ها (Activity)', required: false })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    activityIds?: string[];


}


export class RequestVerificationDto {
    @ApiProperty({ enum: ['blue', 'silver', 'gold'] })
    @IsNotEmpty()
    @IsEnum(['blue', 'silver', 'gold'])
    level: string;

    @ApiProperty({ example: '1234567890' })
    @IsNotEmpty()
    @IsString()
    nationalId: string;

    @ApiProperty({ required: false, description: 'شناسه فایل کارت ملی (در صورت تأیید قبلی اختیاری)' })
    @IsOptional()
    @IsString()
    nationalCardFileId?: string;   // ← اختیاری شد

    @ApiProperty()
    @IsArray()
    @IsString({ each: true })
    licenseFileIds: string[];

    @ApiProperty()
    @IsArray()
    @IsString({ each: true })
    awardFileIds: string[];
}