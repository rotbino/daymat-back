// src/business/business.controller.ts
import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { BusinessService } from './business.service';
import { CreateBusinessDto, RequestVerificationDto, UpdateBusinessDto } from './business.dto';
import { CurrentUser } from '../common/decorators/custom.decorators';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('business')
@Controller('business')
export class BusinessController {
    constructor(private businessService: BusinessService) {}

    // ═══════════════════════════════════════════════════════
    // ✅ Route عمومی - بدون نیاز به احراز هویت
    // ═══════════════════════════════════════════════════════

    @Get('slug/:slug')
    @ApiOperation({ summary: 'دریافت کسب‌وکار با اسلاگ (عمومی)' })
    @ApiResponse({ status: 200, description: 'کسب‌وکار یافت شد' })
    @ApiResponse({ status: 404, description: 'کسب‌وکار یافت نشد' })
    async findBySlug(@Param('slug') slug: string) {
        return this.businessService.findBySlug(slug);
    }

    // ═══════════════════════════════════════════════════════
    // ✅ Route های نیازمند احراز هویت
    // ═══════════════════════════════════════════════════════

    // ============================================================
    // ثبت کسب‌وکار جدید
    // ============================================================
    @Post()
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'ثبت کسب‌وکار جدید' })
    @ApiResponse({ status: 201, description: 'کسب‌وکار با موفقیت ثبت شد' })
    @ApiResponse({ status: 409, description: 'نام کسب‌وکار تکراری است' })
    create(@CurrentUser() user: any, @Body() dto: CreateBusinessDto) {
        return this.businessService.create(user.id, dto);
    }

    // ============================================================
    // لیست کسب‌وکارهای من
    // ============================================================
    @Get()
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'لیست کسب‌وکارهای من' })
    @ApiResponse({ status: 200, description: 'لیست کسب‌وکارها' })
    findAll(@CurrentUser() user: any) {
        return this.businessService.findAllByUser(user.id);
    }

    // ============================================================
    // کسب‌وکار فعال فعلی
    // ============================================================
    @Get('active')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'دریافت کسب‌وکار فعال فعلی (اولین کسب‌وکار)' })
    @ApiResponse({ status: 200, description: 'کسب‌وکار فعال' })
    getActive(@CurrentUser() user: any) {
        return this.businessService.getActiveBusiness(user.id);
    }

    // ============================================================
    // جزئیات یک کسب‌وکار
    // ============================================================
    @Get(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'دریافت جزئیات یک کسب‌وکار' })
    @ApiResponse({ status: 200, description: 'جزئیات کسب‌وکار' })
    @ApiResponse({ status: 404, description: 'کسب‌وکار یافت نشد' })
    @ApiResponse({ status: 403, description: 'دسترسی غیرمجاز' })
    findOne(@Param('id') id: string, @CurrentUser() user: any) {
        return this.businessService.findOne(id, user.id);
    }

    // ============================================================
    // ویرایش کسب‌وکار
    // ============================================================
    @Put(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'ویرایش کسب‌وکار' })
    @ApiResponse({ status: 200, description: 'کسب‌وکار با موفقیت ویرایش شد' })
    @ApiResponse({ status: 404, description: 'کسب‌وکار یافت نشد' })
    @ApiResponse({ status: 403, description: 'دسترسی غیرمجاز' })
    update(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: UpdateBusinessDto) {
        return this.businessService.update(id, user.id, dto);
    }

    // ============================================================
    // حذف کسب‌وکار (soft delete)
    // ============================================================
    @Delete(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'حذف کسب‌وکار (soft delete)' })
    @ApiResponse({ status: 200, description: 'کسب‌وکار با موفقیت حذف شد' })
    @ApiResponse({ status: 404, description: 'کسب‌وکار یافت نشد' })
    @ApiResponse({ status: 403, description: 'دسترسی غیرمجاز' })
    @ApiResponse({ status: 409, description: 'کسب‌وکار آگهی فعال دارد' })
    remove(@Param('id') id: string, @CurrentUser() user: any) {
        return this.businessService.remove(id, user.id);
    }

    // ============================================================
    // درخواست تیک اعتماد
    // ============================================================
    @Post(':id/verify')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'ارسال مدارک برای دریافت تیک اعتماد' })
    @ApiResponse({ status: 201, description: 'درخواست با موفقیت ثبت شد' })
    @ApiResponse({ status: 403, description: 'عدم دسترسی' })
    @ApiResponse({ status: 404, description: 'کسب‌وکار یافت نشد' })
    async requestVerification(
        @Param('id') id: string,
        @CurrentUser() user: any,
        @Body() dto: RequestVerificationDto,
    ) {
        return this.businessService.requestVerification(id, user.id, dto);
    }
}