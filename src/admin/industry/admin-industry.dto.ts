// src/admin/industry/admin-industry.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsOptional, IsBoolean, IsNumber } from 'class-validator';

export class CreateIndustryDto {
    @ApiProperty({ example: 'تولیدکننده سیمان', description: 'عنوان صنف' })
    @IsNotEmpty({ message: 'عنوان صنف الزامی است' })
    @IsString()
    title: string;

    @ApiProperty({ example: 'seman', description: 'شناسه یکتا' })
    @IsNotEmpty({ message: 'شناسه یکتا الزامی است' })
    @IsString()
    slug: string;

    @ApiProperty({ example: '6a5a...', description: 'شناسه والد', required: false })
    @IsOptional()
    @IsString()
    parentId?: string;

    @ApiProperty({ example: '12345', description: 'کد صنف', required: false })
    @IsOptional()
    @IsString()
    code?: string;

    @ApiProperty({ example: '🏭', description: 'آیکون', required: false })
    @IsOptional()
    @IsString()
    icon?: string;

    @ApiProperty({ example: 'توضیحات صنف', description: 'توضیحات', required: false })
    @IsOptional()
    @IsString()
    description?: string;

    @ApiProperty({ example: true, description: 'فعال/غیرفعال', required: false })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

export class UpdateIndustryDto {
    @ApiProperty({ example: 'تولیدکننده سیمان', description: 'عنوان صنف', required: false })
    @IsOptional()
    @IsString()
    title?: string;

    @ApiProperty({ example: 'seman', description: 'شناسه یکتا', required: false })
    @IsOptional()
    @IsString()
    slug?: string;

    @ApiProperty({ example: '6a5a...', description: 'شناسه والد', required: false })
    @IsOptional()
    @IsString()
    parentId?: string;

    @ApiProperty({ example: '12345', description: 'کد صنف', required: false })
    @IsOptional()
    @IsString()
    code?: string;

    @ApiProperty({ example: '🏭', description: 'آیکون', required: false })
    @IsOptional()
    @IsString()
    icon?: string;

    @ApiProperty({ example: 'توضیحات صنف', description: 'توضیحات', required: false })
    @IsOptional()
    @IsString()
    description?: string;

    @ApiProperty({ example: true, description: 'فعال/غیرفعال', required: false })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}