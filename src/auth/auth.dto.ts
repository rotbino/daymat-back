// src/auth/auth.dto.ts
import {
    IsNotEmpty,
    IsOptional,
    IsString,
    MinLength,
    IsPhoneNumber,
    MaxLength,
    IsDateString,
    IsIn, IsObject, IsInt
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// ============================================================
// ثبت‌نام
// ============================================================
export class RegisterDto {
    @ApiProperty({
        example: '09123456789',
        description: 'شماره موبایل کاربر',
    })
    @IsNotEmpty({ message: 'شماره موبایل الزامی است' })
    @IsPhoneNumber('IR', { message: 'شماره موبایل معتبر نیست' })
    phone: string;

    @ApiProperty({
        example: 'سعید یوسفی',
        description: 'نام و نام خانوادگی کاربر',
        required: false,
    })
    @IsOptional()
    @IsString()
    fullName?: string;

    @ApiProperty({
        example: '123456',
        description: 'رمز عبور (حداقل ۶ کاراکتر)',
        minLength: 6,
    })
    @IsNotEmpty({ message: 'رمز عبور الزامی است' })
    @MinLength(6, { message: 'رمز عبور باید حداقل ۶ کاراکتر باشد' })
    password: string;
}

// ============================================================
// ورود
// ============================================================
export class LoginDto {
    @ApiProperty({
        example: '09123456789',
        description: 'شماره موبایل کاربر',
    })
    @IsNotEmpty({ message: 'شماره موبایل الزامی است' })
    @IsPhoneNumber('IR', { message: 'شماره موبایل معتبر نیست' })
    phone: string;

    @ApiProperty({
        example: '123456',
        description: 'رمز عبور کاربر',
    })
    @IsNotEmpty({ message: 'رمز عبور الزامی است' })
    @MinLength(6, { message: 'رمز عبور باید حداقل ۶ کاراکتر باشد' })
    password: string;
}

// ============================================================
// به‌روزرسانی پروفایل
// ============================================================

export class UpdateProfileDto {
    @ApiProperty({ example: 'سعید یوسفی', description: 'نام و نام خانوادگی' })
    @IsNotEmpty({ message: 'نام و نام خانوادگی الزامی است' })
    @IsString()
    fullName: string;

    // ── فیلدهای جدید (همه اختیاری) ──
    @ApiProperty({ example: 'user@example.com', required: false })
    @IsOptional()
    @IsString()
    email?: string;

    @ApiProperty({ example: 'male', enum: ['male', 'female', 'other'], required: false })
    @IsOptional()
    @IsIn(['male', 'female', 'other'])
    gender?: string;

    @ApiProperty({ example: '1990-03-21T00:00:00.000Z', description: 'تاریخ تولد (ISO)', required: false })
    @IsOptional()
    @IsDateString()
    birthDate?: string;   // به Date تبدیل می‌کنیم

    @ApiProperty({ example: 'تهران', required: false })
    @IsOptional()
    @IsString()
    province?: string;

    @ApiProperty({ example: 'تهران', required: false })
    @IsOptional()
    @IsString()
    city?: string;

    @IsOptional()
    @IsString()
    country?: string;

    @IsOptional()
    @IsString()
    countryCode?: string;

    @IsOptional()
    @IsString()
    provinceCode?: string;

    @IsOptional()
    @IsString()
    cityCode?: string;

    @ApiProperty({ example: '1234567890', required: false })
    @IsOptional()
    @IsString()
    postalCode?: string;

    @ApiProperty({ example: 'خ آزادی، پلاک ۱۲', required: false })
    @IsOptional()
    @IsString()
    address?: string;

    @ApiProperty({ example: 'تولیدکننده مصالح ساختمانی با ۱۵ سال سابقه', required: false })
    @IsOptional()
    @IsString()
    bio?: string;

    @ApiProperty({ example: 1385, description: 'سال شروع فعالیت تجاری', required: false })
    @IsOptional()
    @IsInt()
    businessStartYear?: number;

    @ApiProperty({ example: 'https://mycompany.com', required: false })
    @IsOptional()
    @IsString()
    website?: string;

    @ApiProperty({ example: '@mytelegram', required: false })
    @IsOptional()
    @IsString()
    telegram?: string;

    @ApiProperty({ example: { linkedin: 'in/myprofile', instagram: 'myinsta' }, description: 'لینک شبکه‌های اجتماعی', required: false })
    @IsOptional()
    @IsObject()
    socialLinks?: Record<string, string>;
}

// ============================================================
// تغییر رمز عبور
// ============================================================
export class ChangePasswordDto {
    @ApiProperty({
        example: 'oldpassword123',
        description: 'رمز عبور فعلی',
    })
    @IsNotEmpty({ message: 'رمز عبور فعلی الزامی است' })
    @MinLength(6, { message: 'رمز عبور باید حداقل ۶ کاراکتر باشد' })
    currentPassword: string;

    @ApiProperty({
        example: 'newpassword456',
        description: 'رمز عبور جدید',
    })
    @IsNotEmpty({ message: 'رمز عبور جدید الزامی است' })
    @MinLength(6, { message: 'رمز عبور جدید باید حداقل ۶ کاراکتر باشد' })
    newPassword: string;
}

// ============================================================
// درخواست کد تایید (فراموشی رمز)
// ============================================================
export class RequestVerificationCodeDto {
    @ApiProperty({
        example: '09123456789',
        description: 'شماره موبایل کاربر',
    })
    @IsNotEmpty({ message: 'شماره موبایل الزامی است' })
    @IsPhoneNumber('IR', { message: 'شماره موبایل معتبر نیست' })
    phone: string;
}

// ============================================================
// تایید کد و تنظیم رمز جدید
// ============================================================
export class VerifyCodeAndSetPasswordDto {
    @ApiProperty({
        example: '09123456789',
        description: 'شماره موبایل کاربر',
    })
    @IsNotEmpty({ message: 'شماره موبایل الزامی است' })
    @IsPhoneNumber('IR', { message: 'شماره موبایل معتبر نیست' })
    phone: string;

    @ApiProperty({
        example: '123456',
        description: 'کد تایید ۶ رقمی',
    })
    @IsNotEmpty({ message: 'کد تایید الزامی است' })
    @IsString()
    @MinLength(6, { message: 'کد تایید باید ۶ رقم باشد' })
    @MaxLength(6, { message: 'کد تایید باید ۶ رقم باشد' })
    code: string;

    @ApiProperty({
        example: 'newpassword123',
        description: 'رمز عبور جدید',
    })
    @IsNotEmpty({ message: 'رمز عبور جدید الزامی است' })
    @MinLength(6, { message: 'رمز عبور باید حداقل ۶ کاراکتر باشد' })
    newPassword: string;
}

// ============================================================
// پاسخ موفقیت‌آمیز
// ============================================================
export class AuthResponseDto {
    @ApiProperty({ example: 'عملیات با موفقیت انجام شد' })
    message: string;

    @ApiProperty({
        example: 'eyJhbGciOiJIUzI1NiIsInR...',
        description: 'توکن دسترسی JWT',
        required: false,
    })
    access_token?: string;

    @ApiProperty({
        description: 'اطلاعات کاربر',
        required: false,
    })
    user?: {
        id: string;
        phone: string;
        fullName: string;
        role: string;
        locale: string;
        isPhoneVerified: boolean;
        temporaryPassword: boolean;
    };
}