// src/product-reference/product-reference.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, IsArray, IsObject } from 'class-validator';

export class SearchProductDto {
    @ApiProperty({ example: 'کنسرو' })
    @IsString()
    q!: string;

    @ApiPropertyOptional({ example: 'food' })
    @IsOptional()
    @IsString()
    category?: string;

    @ApiPropertyOptional({ example: 20 })
    @IsOptional()
    limit?: number;
}

export class CreateProductDto {
    @ApiProperty({ example: 'کنسرو ماهی مکنزی ۲۰۰ گرمی' })
    @IsString()
    @MaxLength(150)
    title!: string;

    @ApiPropertyOptional({ example: '6a9f...' })
    @IsOptional()
    @IsString()
    brandId?: string;

    @ApiPropertyOptional({ example: 'food/canned' })
    @IsOptional()
    @IsString()
    category?: string;

    @ApiPropertyOptional({ type: [String], description: 'کلمات کلیدی: ["تن ماهی", "کنسرو ماهی"]' })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    keywords?: string[];

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    imageUrl?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    thumbnailUrl?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    description?: string;

    @ApiPropertyOptional({ type: [String], description: 'واحدهای رایج: ["عدد", "کارتن ۲۴تایی"]' })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    unitHints?: string[];

    @ApiPropertyOptional({ type: Object, example: { 'وزن': '۲۰۰ گرم', 'جنس': 'فلز' }, description: 'ویژگی‌های کالا — مالِ کالاست نه آگهی' })
    @IsOptional()
    @IsObject()
    specs?: Record<string, string>;

    @ApiPropertyOptional({ description: 'specs, weight, volume, ...' })
    @IsOptional()
    metadata?: any;
}

export class UpdateProductDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(150)
    title?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    brandId?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    category?: string;

    @ApiPropertyOptional({ type: [String] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    keywords?: string[];

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    imageUrl?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    thumbnailUrl?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    description?: string;

    @ApiPropertyOptional({ type: [String] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    unitHints?: string[];

    @ApiPropertyOptional({ type: Object, description: 'ویژگی‌های کالا' })
    @IsOptional()
    @IsObject()
    specs?: Record<string, string>;

    @ApiPropertyOptional()
    @IsOptional()
    metadata?: any;
}
