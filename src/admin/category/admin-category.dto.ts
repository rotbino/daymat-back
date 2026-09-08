// src/admin/category/admin-category.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsOptional, IsNumber, IsBoolean } from 'class-validator';

export class CreateCategoryDto {
    @ApiProperty({ example: 'مصالح ساختمانی', description: 'عنوان دسته‌بندی' })
    @IsNotEmpty({ message: 'عنوان دسته‌بندی الزامی است' })
    @IsString()
    title: string;

    @ApiProperty({ example: 'construction', description: 'شناسه یکتا' })
    @IsNotEmpty({ message: 'شناسه یکتا الزامی است' })
    @IsString()
    slug: string;

    @ApiProperty({ example: '67a1b2c3d4e5f67890123456', description: 'شناسه والد (اگر زیرمجموعه است)', required: false })
    @IsOptional()
    @IsString()
    parentId?: string;

    @ApiProperty({ example: 'سیمان تیپ ۲', description: 'مثال برای راهنمایی', required: false })
    @IsOptional()
    @IsString()
    example?: string;

    @ApiProperty({ example: '🏗️', description: 'آیکون', required: false })
    @IsOptional()
    @IsString()
    icon?: string;

    @ApiProperty({ example: 'توضیحات دسته‌بندی', description: 'توضیحات', required: false })
    @IsOptional()
    @IsString()
    description?: string;

    @ApiProperty({ example: { fields: [{ key: 'grade', label: 'گرید', type: 'select', options: ['A1', 'A2'] }] }, description: 'فیلدهای سفارشی', required: false })
    @IsOptional()
    customFieldsSchema?: Record<string, any>;

    @ApiProperty({ example: 10, description: 'حداقل سفارش پیش‌فرض', required: false })
    @IsOptional()
    @IsNumber()
    defaultMinQuantity?: number;

    @ApiProperty({ example: true, description: 'فعال/غیرفعال', required: false })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

export class UpdateCategoryDto {
    @ApiProperty({ example: 'مصالح ساختمانی', description: 'عنوان دسته‌بندی', required: false })
    @IsOptional()
    @IsString()
    title?: string;

    @ApiProperty({ example: 'construction', description: 'شناسه یکتا', required: false })
    @IsOptional()
    @IsString()
    slug?: string;

    @ApiProperty({ example: '67a1b2c3d4e5f67890123456', description: 'شناسه والد', required: false })
    @IsOptional()
    @IsString()
    parentId?: string;

    @ApiProperty({ example: 'سیمان تیپ ۲', description: 'مثال برای راهنمایی', required: false })
    @IsOptional()
    @IsString()
    example?: string;

    @ApiProperty({ example: '🏗️', description: 'آیکون', required: false })
    @IsOptional()
    @IsString()
    icon?: string;

    @ApiProperty({ example: 'توضیحات دسته‌بندی', description: 'توضیحات', required: false })
    @IsOptional()
    @IsString()
    description?: string;

    @ApiProperty({ example: { fields: [{ key: 'grade', label: 'گرید', type: 'select', options: ['A1', 'A2'] }] }, description: 'فیلدهای سفارشی', required: false })
    @IsOptional()
    customFieldsSchema?: Record<string, any>;

    @ApiProperty({ example: 10, description: 'حداقل سفارش پیش‌فرض', required: false })
    @IsOptional()
    @IsNumber()
    defaultMinQuantity?: number;

    @ApiProperty({ example: true, description: 'فعال/غیرفعال', required: false })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}