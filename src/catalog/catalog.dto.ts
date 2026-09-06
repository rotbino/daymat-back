import {ApiProperty, ApiPropertyOptional} from '@nestjs/swagger';
import {
    IsNotEmpty,
    IsString,
    IsOptional,
    IsEnum,
    IsArray,
    MaxLength,
    Matches, IsIn,
} from 'class-validator';

export class CreateCatalogDto {
    @ApiProperty({ example: 'پخش مصالح نارین', description: 'نام کاتالوگ' })
    @IsNotEmpty({ message: 'نام کاتالوگ الزامی است' })
    @IsString()
    name: string;

    @ApiPropertyOptional({ enum: ['wholesale', 'retail', 'service'], description: 'هدف از ساخت کاتالوگ', required: false })
    @IsOptional()
    @IsIn(['wholesale', 'retail', 'service'])
    salesType?: string;



    @ApiProperty({ example: 'پخش عمده مصالح ساختمانی', required: false })
    @IsOptional()
    @IsString()
    shortDescription?: string;

    @ApiProperty({ example: 'ali-supermarket', description: 'اسلاگ (آدرس) کاتالوگ', required: false })
    @IsOptional()
    @IsString()
    @MaxLength(40)
    slug?: string;


    @ApiProperty({
        example: 'wholesaler',
        description: 'نوع کاتالوگ',
        enum: ['producer', 'wholesaler', 'importer', 'exporter', 'distributor', 'retailer', 'contractor', 'service_provider', 'other'],
    })
    @IsNotEmpty({ message: 'نوع کاتالوگ الزامی است' })
    @IsEnum(['producer', 'wholesaler', 'importer', 'exporter', 'distributor', 'retailer', 'contractor', 'service_provider', 'other'])
    type: string;

    @ApiProperty({ example: '98', required: false, default: '98' })
    @IsOptional()
    @IsString()
    countryCode?: string;

    @ApiPropertyOptional({ description: 'نهادِ مالک کاتالوگ — الزامی در create', required: false })
    @IsOptional()
    @IsString()
    businessId?: string;

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

    @ApiProperty({ example: 'توضیحات درباره کاتالوگ', description: 'توضیحات', required: false })
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

    @ApiProperty({ example: 'صاحب کاتالوگ', description: 'سمت کاربر در کاتالوگ', required: false })
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

    @ApiProperty({ example: 'پخش مواد غذایی', description: 'صنف (متن آزاد)', required: false })
    @IsOptional()
    @IsString()
    @MaxLength(60)
    industryName?: string;

    @ApiProperty({ example: ['6a595...', '6a595...'], description: 'لیست شناسه فعالیت‌ها (Activity)', required: false })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    activityIds?: string[];

    @ApiProperty({
        example: 'tamino',
        description: 'شناسه یکتای بازار (اختیاری — کاتالوگ می‌تواند مستقل از بازار ساخته شود)',
        required: false,
    })
    @IsOptional()
    @IsString()
    armSlug?: string;

    @ApiPropertyOptional({ example: 'AB3xKm9Q', description: 'کد دعوت‌کننده (از لینک رفرال‌دار فوتر کاتالوگ)', required: false })
    @IsOptional()
    @IsString()
    refCode?: string;
}

export class UpdateCatalogDto {
    @ApiProperty({ example: 'بازرگانی آهن مرکزی', description: 'نام کاتالوگ', required: false })
    @IsOptional()
    @IsString()
    name?: string;

    @ApiPropertyOptional({ enum: ['wholesale', 'retail', 'service'], description: 'هدف از ساخت کاتالوگ', required: false })
    @IsOptional()
    @IsIn(['wholesale', 'retail', 'service'])
    salesType?: string;

    @ApiProperty({ example: 'پخش عمده مصالح ساختمانی', description: 'معرفی کوتاه کاتالوگ', required: false })
    @IsOptional()
    @IsString()
    shortDescription?: string;

    @ApiProperty({ example: 'ali-supermarket', description: 'اسلاگ (آدرس) کاتالوگ', required: false })
    @IsOptional()
    @IsString()
    @MaxLength(40)
    slug?: string;

    @ApiPropertyOptional({ description: 'نهادِ مالک کاتالوگ — الزامی در create', required: false })
    @IsOptional()
    @IsString()
    businessId?: string;

    @ApiProperty({
        example: 'wholesaler',
        description: 'نوع کاتالوگ',
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

    @ApiProperty({ example: 'توضیحات درباره کاتالوگ', description: 'توضیحات', required: false })
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

    @ApiProperty({ example: 'صاحب کاتالوگ', description: 'سمت کاربر در کاتالوگ', required: false })
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

    @ApiProperty({ example: 'پخش مواد غذایی', description: 'صنف (متن آزاد)', required: false })
    @IsOptional()
    @IsString()
    @MaxLength(60)
    industryName?: string;

    @ApiProperty({ example: ['6a595...', '6a595...'], description: 'لیست شناسه فعالیت‌ها (Activity)', required: false })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    activityIds?: string[];

    @ApiPropertyOptional({ example: 'AB3xKm9Q', description: 'کد دعوت‌کننده (از لینک رفرال‌دار فوتر کاتالوگ)', required: false })
    @IsOptional()
    @IsString()
    refCode?: string;


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
    nationalCardFileId?: string;

    @ApiProperty()
    @IsArray()
    @IsString({ each: true })
    licenseFileIds: string[];

    @ApiProperty()
    @IsArray()
    @IsString({ each: true })
    awardFileIds: string[];
}