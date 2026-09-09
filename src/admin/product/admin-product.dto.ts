// src/admin/product/admin-product.dto.ts
// ✅ DTOهای مدیریتی کالای مرجع — فقط ادمین سیستم
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, IsArray, IsObject, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';

// ────────────────────────────────────────────────
// ویرایش کالای مرجع توسط ادمین — همهٔ فیلدها + کنترل وضعیت
// ────────────────────────────────────────────────
export class AdminUpdateProductDto {
    @ApiPropertyOptional({ description: 'عنوان کالا' })
    @IsOptional()
    @IsString()
    @MaxLength(150)
    title?: string;

    @ApiPropertyOptional({ description: 'شناسه برند — رشتهٔ خالی یعنی حذف برند' })
    @IsOptional()
    @IsString()
    brandId?: string;

    @ApiPropertyOptional({ description: 'دستهٔ کالا' })
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
    imageUrl?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    thumbnailUrl?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    description?: string;

    @ApiPropertyOptional({ type: [String], description: 'واحدهای رایج' })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    unitHints?: string[];

    @ApiPropertyOptional({ type: Object, description: 'ویژگی‌های کالا (وزن، جنس و…)' })
    @IsOptional()
    @IsObject()
    specs?: Record<string, string>;

    @ApiPropertyOptional()
    @IsOptional()
    metadata?: any;

    @ApiPropertyOptional({ description: 'فعال/غیرفعال — غیرفعال از سرچ عمده حذف می‌شود' })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @ApiPropertyOptional({ description: 'تأیید ادمین — تأیید یعنی isNew=false و قفل ویرایش کاربر' })
    @IsOptional()
    @IsBoolean()
    confirmed?: boolean;
}

// ────────────────────────────────────────────────
// فیلترهای لیست مدیریتی — از Query string می‌آید
// ────────────────────────────────────────────────
export class AdminProductFilterDto {
    @ApiPropertyOptional({ description: 'جستجو در عنوان/کلمات کلیدی/برند' })
    @IsOptional()
    @IsString()
    q?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    brandId?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    category?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    armId?: string;

    @Transform(({ value }) => value === 'true')
    @ApiPropertyOptional({ description: 'فقط فعال‌ها' })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @Transform(({ value }) => value === 'true')
    @ApiPropertyOptional({ description: 'فقط تأییدشده‌ها' })
    @IsOptional()
    @IsBoolean()
    confirmed?: boolean;

    @Transform(({ value }) => value === 'true')
    @ApiPropertyOptional({ description: 'فقط کاربر-ساخته‌ها' })
    @IsOptional()
    @IsBoolean()
    isByUser?: boolean;

    @ApiPropertyOptional({ description: 'hasAds=true → فقط کالاهایی که آگهی وصل دارند' })
    @Transform(({ value }) => value === 'true')
    @IsOptional()
    @IsBoolean()
    hasAds?: boolean;

    @Transform(({ value }) => parseInt(value, 10) || 1)
    @ApiPropertyOptional()
    @IsOptional()
    page?: number;

    @Transform(({ value }) => parseInt(value, 10) || 20)
    @ApiPropertyOptional()
    @IsOptional()
    limit?: number;

    @ApiPropertyOptional({ enum: ['createdAt', 'usageCount', 'title'], description: 'مرتب‌سازی' })
    @IsOptional()
    @IsString()
    sortBy?: string;

    @ApiPropertyOptional({ enum: ['asc', 'desc'] })
    @IsOptional()
    @IsString()
    sortOrder?: 'asc' | 'desc';
}
