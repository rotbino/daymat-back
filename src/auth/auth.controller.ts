// src/auth/auth.controller.ts

import {Controller, Post, Body, UseInterceptors, Put, UseGuards, Get} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import {
    RegisterDto,
    LoginDto,
    AuthResponseDto,
    UpdateProfileDto,
    ChangePasswordDto,
    RequestVerificationCodeDto,
    VerifyCodeAndSetPasswordDto,
} from './auth.dto';
import { CurrentUser, CurrentLocale } from '../common/decorators/custom.decorators';
import { LocaleInterceptor } from '../common/interceptors/locale.interceptor';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('auth')
@Controller('auth')
@UseInterceptors(LocaleInterceptor)
export class AuthController {
    constructor(private authService: AuthService) {}

    // ============================================================
    // ✅ ثبت‌نام
    // ============================================================
    @Post('register')
    @ApiOperation({ summary: 'ثبت‌نام کاربر جدید' })
    @ApiBody({ type: RegisterDto })
    @ApiResponse({ status: 201, description: 'ثبت‌نام موفق', type: AuthResponseDto })
    @ApiResponse({ status: 400, description: 'خطا در داده‌های ورودی' })
    register(@Body() dto: RegisterDto, @CurrentLocale() locale: string) {
        return this.authService.register(dto, locale);
    }

    // ============================================================
    // ✅ ورود
    // ============================================================
    @Post('login')
    @ApiOperation({ summary: 'ورود کاربر' })
    @ApiBody({ type: LoginDto })
    @ApiResponse({ status: 200, description: 'ورود موفق', type: AuthResponseDto })
    @ApiResponse({ status: 401, description: 'شماره موبایل یا رمز عبور اشتباه است' })
    login(@Body() dto: LoginDto, @CurrentLocale() locale: string) {
        return this.authService.login(dto, locale);
    }

    // ============================================================
    // ✅ بررسی وجود شماره موبایل
    // ============================================================
    @Post('check-phone')
    @ApiOperation({ summary: 'بررسی وجود شماره موبایل' })
    async checkPhone(@Body() dto: { phone: string }) {
        return this.authService.checkPhone(dto.phone);
    }

    // ============================================================
    // ✅ به‌روزرسانی پروفایل (فقط نام)
    // ============================================================
    @Put('profile')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'به‌روزرسانی نام کاربر' })
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                fullName: { type: 'string', example: 'سعید یوسفی' },
            },
        },
    })
    @ApiResponse({ status: 200, description: 'پروفایل با موفقیت به‌روزرسانی شد' })
    @ApiResponse({ status: 401, description: 'احراز هویت نشده' })
    @ApiResponse({ status: 404, description: 'کاربر یافت نشد' })
    async updateProfile(
        @CurrentUser() user: any,
        @Body() dto: UpdateProfileDto,
    ) {
        return this.authService.updateProfile(user.id, dto);
    }

    // ============================================================
    // ✅ تغییر رمز عبور (با تایید رمز فعلی)
    // ============================================================
    @Put('change-password')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'تغییر رمز عبور (با تایید رمز فعلی)' })
    @ApiBody({ type: ChangePasswordDto })
    @ApiResponse({ status: 200, description: 'رمز عبور با موفقیت تغییر یافت' })
    @ApiResponse({ status: 401, description: 'رمز عبور فعلی اشتباه است' })
    @ApiResponse({ status: 404, description: 'کاربر یافت نشد' })
    async changePassword(
        @CurrentUser() user: any,
        @Body() dto: ChangePasswordDto,
    ) {
        return this.authService.changePassword(user.id, dto);
    }

    // ============================================================
    // ✅ درخواست کد تایید (فراموشی رمز)
    // ============================================================
    @Post('request-verification')
    @ApiOperation({ summary: 'درخواست کد تایید برای فراموشی رمز عبور' })
    @ApiBody({ type: RequestVerificationCodeDto })
    @ApiResponse({ status: 200, description: 'کد تایید ارسال شد' })
    @ApiResponse({ status: 404, description: 'کاربری با این شماره یافت نشد' })
    async requestVerificationCode(@Body() dto: RequestVerificationCodeDto) {
        return this.authService.requestVerificationCode(dto);
    }

    // ============================================================
    // ✅ تایید کد و تنظیم رمز جدید (فراموشی رمز)
    // ============================================================
    @Post('verify-code-and-set-password')
    @ApiOperation({ summary: 'تایید کد و تنظیم رمز جدید (فراموشی رمز)' })
    @ApiBody({ type: VerifyCodeAndSetPasswordDto })
    @ApiResponse({ status: 200, description: 'رمز عبور با موفقیت تغییر یافت' })
    @ApiResponse({ status: 400, description: 'کد نامعتبر یا منقضی شده' })
    @ApiResponse({ status: 404, description: 'کاربری با این شماره یافت نشد' })
    async verifyCodeAndSetPassword(@Body() dto: VerifyCodeAndSetPasswordDto) {
        return this.authService.verifyCodeAndSetPassword(dto);
    }

    @Get('me')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    async getProfile(@CurrentUser() user: any) {
        return this.authService.getProfile(user.id);
    }

    @Post('logout')
    @UseGuards(JwtAuthGuard)
    async logout(@CurrentUser() user: any) {
        // در اینجا می‌توانید refresh token فعلی را از دیتابیس حذف یا blacklist کنید
        // در ساده‌ترین حالت، نیازی به کاری نیست چون JWT stateless است
        return { message: 'خروج با موفقیت انجام شد' };
    }


}