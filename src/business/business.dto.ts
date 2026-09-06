// src/business/business.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    IsNotEmpty,
    IsOptional,
    IsString,
    MaxLength,
    IsIn,
    IsNumber, IsArray,
} from 'class-validator';

export class CreateBusinessDto {
    @ApiProperty({ example: 'شرکت پخش خوشگوار', description: 'نام کسب‌وکار' })
    @IsNotEmpty({ message: 'نام کسب‌وکار الزامی است' })
    @IsString()
    @MaxLength(120)
    name: string;

    @ApiPropertyOptional({
        example: 'distributor',
        enum: ['producer', 'wholesaler', 'importer', 'exporter', 'distributor', 'retailer', 'contractor', 'service_provider', 'other'],
        required: false,
    })
    @IsOptional()
    @IsIn(['producer', 'wholesaler', 'importer', 'exporter', 'distributor', 'retailer', 'contractor', 'service_provider', 'other'])
    type?: string;

    @ApiPropertyOptional({ example: 'پخش مواد غذایی', required: false })
    @IsOptional()
    @IsString()
    @MaxLength(60)
    industryName?: string;

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

    @ApiPropertyOptional({ required: false })
    @IsOptional()
    @IsString()
    @MaxLength(60)
    industryName?: string;

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