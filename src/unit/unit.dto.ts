// src/unit/unit.dto.ts
// ✅ ثبت واحد جدید توسط کاربر (فروشنده) از مدال واحدهای ویزارد
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsOptional, IsBoolean, IsIn, Min, MaxLength, IsNumber } from 'class-validator';

export class CreateUserUnitDto {
    @ApiProperty({ example: 'شیرینگ', description: 'عنوان واحد (نباید تکراری باشد)' })
    @IsNotEmpty({ message: 'عنوان واحد الزامی است' })
    @IsString()
    @MaxLength(30, { message: 'عنوان واحد حداکثر ۳۰ کاراکتر است' })
    title: string;

    @ApiProperty({ enum: ['wholesale', 'retail'], description: 'این واحد مال عمده‌فروشی است یا خرده‌فروشی' })
    @IsIn(['wholesale', 'retail'], { message: 'تکلیف واحد را روشن کن: عمده‌فروشی یا خرده‌فروشی' })
    scope: 'wholesale' | 'retail';

    @ApiPropertyOptional({ example: 24, description: 'تعداد واحد خرد داخل بسته (فقط عمده — مثل ۲۴ عدد در هر کارتن)', required: false })
    @IsOptional()
    @IsNumber()
    @Min(2)
    containsQty?: number;

    @ApiPropertyOptional({ description: 'آیا تعداد ثابت است یا قابل تغییر', default: false, required: false })
    @IsOptional()
    @IsBoolean()
    qtyIsFixed?: boolean;
}
