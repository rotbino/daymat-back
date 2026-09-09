// src/brand/brand.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, IsArray, IsBoolean } from 'class-validator';

export class SearchBrandDto {
    @ApiProperty({ example: 'مکنزی' })
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

export class CreateBrandDto {
    @ApiProperty({ example: 'مکنزی' })
    @IsString()
    @MaxLength(80)
    title!: string;

    @ApiPropertyOptional({ description: 'اسلاگ بازارِ مبدأ (وقتی از داخل یک بازار ثبت می‌شود — برای نظارت مالک بازار)' })
    @IsOptional()
    @IsString()
    armSlug?: string;

    @ApiPropertyOptional({ example: 'food' })
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
    logoUrl?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    description?: string;
}

export class UpdateBrandDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(80)
    title?: string;

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
    logoUrl?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    description?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    confirmed?: boolean;
}
