// src/admin/brand/admin-brand.dto.ts
// ✅ DTOهای مدیریتی برند — فقط ادمین سیستم
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, IsArray, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';

// ────────────────────────────────────────────────
// ویرایش برند توسط ادمین — همهٔ فیلدها + کنترل وضعیت
// ────────────────────────────────────────────────
export class AdminUpdateBrandDto {
    @ApiPropertyOptional({ description: 'عنوان برند' })
    @IsOptional()
    @IsString()
    @MaxLength(80)
    title?: string;

    @ApiPropertyOptional({ description: 'دستهٔ برند' })
    @IsOptional()
    @IsString()
    category?: string;

    @ApiPropertyOptional({ type: [String], description: 'کلمات کلیدی' })
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

    @ApiPropertyOptional({ description: 'فعال/غیرفعال — غیرفعال از سرچ عمده حذف می‌شود' })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @ApiPropertyOptional({ description: 'تأیید ادمین' })
    @IsOptional()
    @IsBoolean()
    confirmed?: boolean;
}
