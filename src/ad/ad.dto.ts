// src/ad/ad.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import {
    IsNotEmpty, IsString, IsNumber, IsOptional, IsBoolean,
    Min, Max, IsEnum, ValidateNested, IsObject,
} from 'class-validator';
import {Transform, Type} from 'class-transformer';



// ═══════════════════════════════════════════════════════════════
// DTOهای شرایط فروش
// ═══════════════════════════════════════════════════════════════
export class SpecsDto {
    [key: string]: string;
}

// ═══════════════════════════════════════════════════════════════
// DTOهای شرایط فروش (روش‌های پرداخت) - نسخه چندگانه
// ═══════════════════════════════════════════════════════════════

export class ChequeOptionDto {
    @ApiProperty({ example: 5500000, description: 'قیمت چکی برای این مدت' })
    @IsNumber()
    @Min(0)
    price: number;

    @ApiProperty({ example: 60, description: 'مدت چک (روز)' })
    @IsNumber()
    @Min(1)
    days: number;
}

export class InstallmentOptionDto {
    @ApiProperty({ example: 6000000, description: 'قیمت اقساطی برای این طرح' })
    @IsNumber()
    @Min(0)
    price: number;

    @ApiProperty({ example: 6, description: 'تعداد اقساط (ماه)' })
    @IsNumber()
    @Min(1)
    months: number;

    @ApiProperty({ example: 30, description: 'درصد پیش‌پرداخت', required: false })
    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(100)
    prepaymentPercent?: number;
}

// src/ad/ad.dto.ts – بخش PaymentMethodsDto

export class PaymentMethodsDto {
    @ApiProperty({ description: 'فروش چکی', required: false })
    @IsOptional()
    @ValidateNested({ each: true })
    @Type(() => ChequeOptionDto)
    cheque?: ChequeOptionDto[];

    @ApiProperty({ description: 'توضیحات چکی', required: false })
    @IsOptional()
    @IsString()
    chequeDescription?: string;

    @ApiProperty({ description: 'فروش اقساطی', required: false })
    @IsOptional()
    @ValidateNested({ each: true })
    @Type(() => InstallmentOptionDto)
    installment?: InstallmentOptionDto[];

    @ApiProperty({ description: 'توضیحات اقساطی', required: false })
    @IsOptional()
    @IsString()
    installmentDescription?: string;

    @ApiProperty({ description: 'توضیحات کلی', required: false })
    @IsOptional()
    @IsString()
    description?: string;
}









class ChequePaymentDto {
    @ApiProperty({ example: true, description: 'فعال بودن فروش چکی' })
    @IsBoolean()
    enabled: boolean;

    @ApiProperty({ example: 5500000, description: 'قیمت چکی', required: false })
    @IsOptional()
    @IsNumber()
    @Min(0)
    price?: number;

    @ApiProperty({ example: 60, description: 'حداکثر مدت چک (روز)', required: false })
    @IsOptional()
    @IsNumber()
    @Min(1)
    maxDays?: number;
}

class InstallmentPaymentDto {
    @ApiProperty({ example: true, description: 'فعال بودن فروش اقساطی' })
    @IsBoolean()
    enabled: boolean;

    @ApiProperty({ example: 6000000, description: 'قیمت اقساطی', required: false })
    @IsOptional()
    @IsNumber()
    @Min(0)
    price?: number;

    @ApiProperty({ example: 6, description: 'تعداد اقساط (ماه)', required: false })
    @IsOptional()
    @IsNumber()
    @Min(1)
    months?: number;

    @ApiProperty({ example: 30, description: 'درصد پیش‌پرداخت', required: false })
    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(100)
    prepaymentPercent?: number;
}



class CustomFieldsDto {
    @ApiProperty({ description: 'روش‌های پرداخت', required: false })
    @IsOptional()
    @ValidateNested()
    @Type(() => PaymentMethodsDto)
    paymentMethods?: PaymentMethodsDto;

    @ApiProperty({ example: { "رنگ": "سفید", "برند": "هگمتانه" }, description: 'مشخصات فنی کالا', required: false })
    @IsOptional()
    specs?: Record<string, string>;
}



// ═══════════════════════════════════════════════════════════════
// CreateAdDto
// ═══════════════════════════════════════════════════════════════

export class CreateAdDto {
    @ApiProperty({ example: 'barton', description: 'شناسه یکتای بازار (slug)' })
    @IsNotEmpty({ message: 'شناسه بازار الزامی است' })
    @IsString()
    armSlug: string;

    @ApiProperty({ example: '6a53517d3a1399c4dd791940', description: 'شناسه دسته‌بندی', required: false })
    @IsOptional()
    @IsString()
    categoryId?: string;

    @ApiProperty({ example: '6a53517d3a1399c4dd791940', description: 'شناسه گره اختصاصی', required: false })
    @IsOptional()
    @IsString()
    customCategoryId?: string;

    @ApiProperty({ example: '6a5350efcc995617ae037ea4', description: 'شناسه واحد', required: false })
    @IsOptional()
    @IsString()
    unitId?: string;

    @ApiProperty({ example: 'میلگرد ۱۴ فایکو', description: 'عنوان آگهی' })
    @IsNotEmpty({ message: 'عنوان آگهی الزامی است' })
    @IsString()
    title: string;

    @ApiProperty({ example: 'پرتلند تیپ ۲', description: 'نوع کالا', required: false })
    @IsOptional()
    @IsString()
    productType?: string;

    @ApiProperty({ example: 'میلگرد با کیفیت عالی', description: 'توضیحات', required: false })
    @IsOptional()
    @IsString()
    description?: string;

    @ApiProperty({ example: 24, description: 'تعداد در واحد (مثلاً 24 عدد در کارتن)', required: false })
    @IsOptional()
    @IsNumber()
    @Min(1)
    unitQty?: number;

    @ApiProperty({ example: false, description: 'آیا تعداد قابل تغییر توسط کاربر است', required: false })
    @IsOptional()
    @IsBoolean()
    unitIsVariableQty?: boolean;

    @ApiProperty({ example: 24500, description: 'قیمت واحد (نقدی)' })
    @IsNotEmpty({ message: 'قیمت واحد الزامی است' })
    @IsNumber()
    @Min(1)
    unitPrice: number;

    @ApiProperty({ example: 5, description: 'حداقل سفارش' })
    @IsNotEmpty({ message: 'حداقل سفارش الزامی است' })
    @IsNumber()
    @Min(1)
    minQuantity: number;

    @ApiProperty({ example: 100, description: 'موجودی انبار', required: false })
    @IsOptional()
    @IsNumber()
    @Min(0)
    availableQuantity?: number;

    @ApiProperty({ example: 'under_50', description: 'سطل موجودی', enum: ['under_50', '50_to_200', 'over_200'], required: false })
    @IsOptional()
    @IsEnum(['under_50', '50_to_200', 'over_200'])
    availableQuantityBucket?: string;

    @ApiProperty({ example: 'IR', description: 'کد کشور', required: false })
    @IsOptional()
    @IsString()
    countryCode?: string;

    @ApiProperty({ example: '21', description: 'کد استان', required: false })
    @IsOptional()
    @IsString()
    provinceCode?: string;

    @ApiProperty({ example: '334', description: 'کد شهر', required: false })
    @IsOptional()
    @IsString()
    cityCode?: string;

    @ApiProperty({ example: 'تهران', description: 'نام استان', required: false })
    @IsOptional()
    @IsString()
    province?: string;

    @ApiProperty({ example: 'تهران', description: 'نام شهر' })
    @IsOptional()
    @IsString()
    city?: string;

    @ApiProperty({ example: 'بازار آهن شادآباد', description: 'جزئیات مکان', required: false })
    @IsOptional()
    @IsString()
    locationDetail?: string;

    @ApiProperty({ example: 7, description: 'مدت اعتبار (روز)', minimum: 1, maximum: 30, required: false })
    @IsOptional()
    @IsNumber()
    @Min(1)
    @Max(240)
    validityHours?: number;

    @ApiProperty({ example: false, description: 'انتشار ناشناس', required: false })
    @IsOptional()
    @IsBoolean()
    isAnonymous?: boolean;

    @ApiProperty({ example: false, description: 'نردبان', required: false })
    @IsOptional()
    @IsBoolean()
    isBumped?: boolean;



    @ApiProperty({ example: 24, description: 'مدت زمان نردبان (ساعت)، پیش‌فرض ۲۴', required: false })
    @IsOptional()
    @IsNumber()
    @Min(24)
    @Max(72) // یا هر مقداری که با validityHours محدود می‌شود
    bumpDurationHours?: number;

    @ApiProperty({ description: 'روش‌های پرداخت', required: false })
    @IsOptional()
    @ValidateNested()
    @Type(() => PaymentMethodsDto)
    paymentMethods?: PaymentMethodsDto;

    @ApiProperty({ description: 'مشخصات فنی', required: false })
    @IsOptional()
    @IsObject()
    specs?: SpecsDto;

    // ⚠️ customFields قدیمی را برای سازگاری حفظ می‌کنیم
    @ApiProperty({ description: 'فیلدهای سفارشی ', required: false })
    @IsOptional()
    @IsObject()
    customFields?: any;


}

// ═══════════════════════════════════════════════════════════════
// UpdateAdDto
// ═══════════════════════════════════════════════════════════════


export class UpdateAdDto {
    @ApiProperty({ example: true, description: 'آیا آگهی برای تایید مجدد ارسال می شود؟ (برای آگهی‌های ردشده)', required: false })
    @IsOptional()
    @IsBoolean()
    forceReapproval?: boolean;

    @ApiProperty({ example: 'میلگرد ۱۴ فایکو - بروزرسانی', description: 'عنوان آگهی', required: false })
    @IsOptional()
    @IsString()
    title?: string;

    @ApiProperty({ example: 'پرتلند تیپ ۲', description: 'نوع کالا', required: false })
    @IsOptional()
    @IsString()
    productType?: string;

    @ApiProperty({ example: 'توضیحات', description: 'توضیحات', required: false })
    @IsOptional()
    @IsString()
    description?: string;

    @ApiProperty({ example: 24, description: 'تعداد در واحد', required: false })
    @IsOptional()
    @IsNumber()
    @Min(1)
    unitQty?: number;

    @ApiProperty({ example: false, description: 'آیا تعداد قابل تغییر است', required: false })
    @IsOptional()
    @IsBoolean()
    unitIsVariableQty?: boolean;

    @ApiProperty({ example: 25000, description: 'قیمت واحد', required: false })
    @IsOptional()
    @IsNumber()
    @Min(1)
    unitPrice?: number;

    @ApiProperty({ example: 5, description: 'حداقل سفارش', required: false })
    @IsOptional()
    @IsNumber()
    @Min(1)
    minQuantity?: number;

    @ApiProperty({ example: 100, description: 'موجودی', required: false })
    @IsOptional()
    @IsNumber()
    @Min(0)
    availableQuantity?: number;

    @ApiProperty({ example: '50_to_200', description: 'سطل موجودی', enum: ['under_50', '50_to_200', 'over_200'], required: false })
    @IsOptional()
    @IsEnum(['under_50', '50_to_200', 'over_200'])
    availableQuantityBucket?: string;

    @ApiProperty({ example: 'تهران', description: 'شهر', required: false })
    @IsOptional()
    @IsString()
    city?: string;

    @ApiProperty({ example: '334', description: 'کد شهر', required: false })
    @IsOptional()
    @IsString()
    cityCode?: string;

    @ApiProperty({ example: '21', description: 'کد استان', required: false })
    @IsOptional()
    @IsString()
    provinceCode?: string;

    @ApiProperty({ example: 'تهران', description: 'استان', required: false })
    @IsOptional()
    @IsString()
    province?: string;

    @ApiProperty({ example: 'بازار آهن', description: 'جزئیات مکان', required: false })
    @IsOptional()
    @IsString()
    locationDetail?: string;

    @ApiProperty({ example: 7, description: 'مدت اعتبار (روز)', required: false })
    @IsOptional()
    @IsNumber()
    @Min(1)
    @Max(240)
    validityHours?: number;

    @ApiProperty({ example: false, description: 'انتشار ناشناس', required: false })
    @IsOptional()
    @IsBoolean()
    isAnonymous?: boolean;



    @ApiProperty({
        enum: ['active', 'inactive', 'expired'],
        description: 'وضعیت آگهی (فعال/غیرفعال)',
        required: false,
    })
    @IsOptional()
    @IsEnum(['active', 'inactive', 'expired'])
    status?: string;

    // ✅ فیلدهای جدید (برای تغییر دسته‌بندی، واحد و نردبان)
    @ApiProperty({ example: '6a654123902c364093573a61', description: 'شناسه دسته‌بندی سراسری', required: false })
    @IsOptional()
    @IsString()
    categoryId?: string;

    @ApiProperty({ example: '6a654123902c364093573a61', description: 'شناسه گره اختصاصی بازار', required: false })
    @IsOptional()
    @IsString()
    customCategoryId?: string;

    @ApiProperty({ example: '6a654103902c364093572867', description: 'شناسه واحد', required: false })
    @IsOptional()
    @IsString()
    unitId?: string;

    @ApiProperty({ example: true, description: 'فعال‌سازی نردبان', required: false })
    @IsOptional()
    @IsBoolean()
    isBumped?: boolean;

    @ApiProperty({ example: 24, description: 'مدت زمان نردبان (ساعت)', required: false })
    @IsOptional()
    @IsNumber()
    @Min(24)
    @Max(72)
    bumpDurationHours?: number;

    @ApiProperty({ description: 'روش‌های پرداخت', required: false })
    @IsOptional()
    @ValidateNested()
    @Type(() => PaymentMethodsDto)
    paymentMethods?: PaymentMethodsDto;

    @ApiProperty({ description: 'مشخصات فنی', required: false })
    @IsOptional()
    @IsObject()
    specs?: SpecsDto;

    // ⚠️ customFields قدیمی
    @ApiProperty({ description: 'فیلدهای سفارشی (قدیمی)', required: false })
    @IsOptional()
    @IsObject()
    customFields?: any;
}

// ═══════════════════════════════════════════════════════════════
// SortItemDto
// ═══════════════════════════════════════════════════════════════

export class SortItemDto {
    @ApiProperty({ example: 'unitPrice', description: 'نام فیلد', enum: ['unitPrice', 'createdAt', 'updatedAt', 'minQuantity'] })
    @IsString()
    field: string;

    @ApiProperty({ example: 'asc', description: 'نوع مرتب‌سازی', enum: ['asc', 'desc'] })
    @IsString()
    order: 'asc' | 'desc';
}

// ═══════════════════════════════════════════════════════════════
// AdListQueryDto
// ═══════════════════════════════════════════════════════════════

export class AdListQueryDto {
    @ApiProperty({ example: '67a1b2c3...', description: 'شناسه گره', required: false })
    @IsOptional()
    @IsString()
    categoryId?: string;

    @ApiProperty({ example: 'global', description: 'نوع گره', enum: ['global', 'custom'], required: false })
    @IsOptional()
    @IsEnum(['global', 'custom'])
    categoryType?: 'global' | 'custom';

    @ApiProperty({ example: 'IR', description: 'کد کشور', required: false })
    @IsOptional()
    @IsString()
    countryCode?: string;

    @ApiProperty({ example: '21', description: 'کد استان', required: false })
    @IsOptional()
    @IsString()
    provinceCode?: string;

    @ApiProperty({ example: '334', description: 'کد شهر', required: false })
    @IsOptional()
    @IsString()
    cityCode?: string;

    @ApiProperty({ example: 'تهران', description: 'نام استان', required: false })
    @IsOptional()
    @IsString()
    province?: string;

    @ApiProperty({ example: 'تهران', description: 'نام شهر', required: false })
    @IsOptional()
    @IsString()
    city?: string;

    @ApiProperty({ example: 10000, description: 'حداقل قیمت', required: false })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    minPrice?: number;

    @ApiProperty({ example: 50000, description: 'حداکثر قیمت', required: false })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    maxPrice?: number;

    @ApiProperty({ example: 10, description: 'حداقل حجم سفارش', required: false })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    minQuantity?: number;

    @ApiProperty({ example: 'all', description: 'فیلتر نردبان', enum: ['all', 'bumped', 'normal'], required: false })
    @IsOptional()
    @IsEnum(['all', 'bumped', 'normal'])
    bumpFilter?: 'all' | 'bumped' | 'normal';

    // ✅ حذف تعریف قبلی SortItemDto[] و جایگزینی با any
    @ApiProperty({ required: false, description: 'مرتب‌سازی (رشته‌ای مثل unitPrice:asc یا آرایه‌ای از { field, order })' })
    @IsOptional()
    sort?: any; // string | { field: string, order: 'asc' | 'desc' }[]

    @ApiProperty({ example: 1, description: 'شماره صفحه', required: false })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(1)
    page?: number;

    @ApiProperty({ example: 20, description: 'تعداد آیتم', required: false })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(1)
    @Max(100)
    limit?: number;

    @ApiProperty({ example: 50, description: 'حداقل موجودی', required: false })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    minAvailableQuantity?: number;

    @ApiProperty({ example: 200, description: 'حداکثر موجودی', required: false })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    maxAvailableQuantity?: number;

    @ApiProperty({ example: 'under_50', description: 'سطل موجودی (قدیمی)', enum: ['under_50', '50_to_200', 'over_200'], required: false })
    @IsOptional()
    @IsEnum(['under_50', '50_to_200', 'over_200'])
    availableQuantityBucket?: string;

    @ApiProperty({ required: false })
    @IsOptional()
    @IsBoolean()
    @Transform(({ value }) => value === 'true' || value === true)
    requireSufficientStock?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// ExtendAdDto
// ═══════════════════════════════════════════════════════════════

// src/ad/ad.dto.ts – ExtendAdDto
export class ExtendAdDto {
    @ApiProperty({ example: 7, description: 'مدت تمدید (روز)', minimum: 1, maximum: 30 })
    @IsNotEmpty({ message: 'مدت تمدید الزامی است' })
    @IsNumber()
    @Min(1)
    @Max(30)
    validityHours: number;

    @ApiProperty({ example: false, description: 'فعال‌سازی نردبان در حین تمدید', required: false })
    @IsOptional()
    @IsBoolean()
    isBumped?: boolean;

    @ApiProperty({ example: 24, description: 'مدت نردبان (ساعت)', required: false })
    @IsOptional()
    @IsNumber()
    @Min(24)
    bumpDurationHours?: number;
}