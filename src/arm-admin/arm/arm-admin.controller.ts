// src/arm-admin/arm/arm-admin.controller.ts
import {
    Controller,
    Get,
    Put,
    Post,
    Body,
    Param,
    UseGuards,
    Query,
} from '@nestjs/common';
import {
    ApiTags,
    ApiOperation,
    ApiResponse,
    ApiBearerAuth,
    ApiQuery,
} from '@nestjs/swagger';
import { ArmAdminService } from './arm-admin.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ArmAdminGuard } from '../../common/guards/arm-admin.guard';
import { CurrentUser } from '../../common/decorators/custom.decorators';
import { AdminCategoryService } from '../../admin/category/admin-category.service'; // ← اضافه شد

@ApiTags('arm-admin')
@Controller('arm-admin')
@UseGuards(JwtAuthGuard, ArmAdminGuard)
@ApiBearerAuth('access-token')
export class ArmAdminController {
    constructor(
        private armAdminService: ArmAdminService,
        private categoryService: AdminCategoryService, // ← تزریق شد
    ) {}

    // ============================================================
    // ۱. دریافت اطلاعات کامل بازار
    // ============================================================
    @Get(':slug')
    @ApiOperation({ summary: 'دریافت اطلاعات کامل بازار (مدیر بازار)' })
    async getArm(@Param('slug') slug: string) {
        return this.armAdminService.getArmWithStats(slug);
    }

    // ============================================================
    // ۲. دریافت آمار بازار
    // ============================================================
    @Get(':slug/stats')
    @ApiOperation({ summary: 'دریافت آمار جامع برای مدیر بازار' })
    async getStats(@Param('slug') slug: string) {
        return this.armAdminService.getArmStats(slug);
    }

    // ============================================================
    // ۳. دریافت لیست فیش‌های در انتظار
    // ============================================================
    @Get(':slug/payments')
    @ApiOperation({ summary: 'دریافت لیست فیش‌های در انتظار (مدیر بازار)' })
    async getPayments(@Param('slug') slug: string) {
        return this.armAdminService.getPendingPayments(slug);
    }

    // ============================================================
    // ۴. تأیید فیش
    // ============================================================
    @Post(':slug/payments/:id/approve')
    @ApiOperation({ summary: 'تأیید فیش (مدیر بازار)' })
    async approvePayment(
        @Param('slug') slug: string,
        @Param('id') id: string,
        @CurrentUser() user: any,
    ) {
        return this.armAdminService.approvePayment(slug, id, user.id);
    }

    // ============================================================
    // ۵. رد فیش
    // ============================================================
    @Post(':slug/payments/:id/reject')
    @ApiOperation({ summary: 'رد فیش (مدیر بازار)' })
    async rejectPayment(
        @Param('slug') slug: string,
        @Param('id') id: string,
        @Body('reason') reason: string,
        @CurrentUser() user: any,
    ) {
        return this.armAdminService.rejectPayment(slug, id, user.id, reason);
    }

    // ============================================================
    // ۶. دریافت تنظیمات بازار
    // ============================================================
    @Get(':slug/settings')
    @ApiOperation({ summary: 'دریافت تنظیمات بازار (مدیر بازار)' })
    async getSettings(@Param('slug') slug: string) {
        return this.armAdminService.getArmSettings(slug);
    }

    // ============================================================
    // ۷. به‌روزرسانی تنظیمات بازار
    // ============================================================
    @Put(':slug/settings')
    @ApiOperation({ summary: 'به‌روزرسانی تنظیمات بازار (مدیر بازار)' })
    @ApiResponse({ status: 200, description: 'تنظیمات با موفقیت به‌روزرسانی شد' })
    @ApiResponse({ status: 404, description: 'بازار یافت نشد' })
    async updateSettings(
        @Param('slug') slug: string,
        @Body() data: any, // داده‌ها را مستقیماً دریافت می‌کند
    ) {
        // لاگ برای دیباگ (اختیاری)
        console.log('📥 دریافت درخواست به‌روزرسانی تنظیمات:', JSON.stringify(data, null, 2));
        return this.armAdminService.updateArmSettings(slug, data);
    }

    // ============================================================
    // ۸. ✅ دریافت تنظیمات پرداخت بازار
    // ============================================================
    @Get(':slug/settings/payments')
    @ApiOperation({ summary: 'دریافت تنظیمات پرداخت بازار (مدیر بازار)' })
    async getPaymentSettings(@Param('slug') slug: string) {
        return this.armAdminService.getPaymentSettings(slug);
    }

    // ============================================================
    // ۹. ✅ به‌روزرسانی تنظیمات پرداخت بازار
    // ============================================================
    @Put(':slug/settings/payments')
    @ApiOperation({ summary: 'به‌روزرسانی تنظیمات پرداخت بازار (مدیر بازار)' })
    async updatePaymentSettings(
        @Param('slug') slug: string,
        @Body() data: any,
    ) {
        return this.armAdminService.updatePaymentSettings(slug, data);
    }

    // ============================================================
    // ۱۰. ✅ دریافت گزارش مالی بازار
    // ============================================================
    @Get(':slug/financial/report')
    @ApiOperation({ summary: 'دریافت گزارش مالی بازار (مدیر بازار)' })
    @ApiQuery({ name: 'startDate', required: false })
    @ApiQuery({ name: 'endDate', required: false })
    async getFinancialReport(
        @Param('slug') slug: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
    ) {
        return this.armAdminService.getFinancialReport(slug, startDate, endDate);
    }

    // ============================================================
    // دریافت دسته‌بندی‌ها برای مالک بازار
    // ============================================================
    @Get(':slug/categories')
    @ApiOperation({ summary: 'دریافت دسته‌بندی‌ها برای مالک بازار' })
    async getCategories(@Param('slug') slug: string) {
        return this.categoryService.findAllFlat();
    }

    // ============================================================
    // دریافت واحدهای یک دسته‌بندی برای مالک بازار
    // ============================================================
    @Get(':slug/categories/:categoryId/units')
    @ApiOperation({ summary: 'دریافت واحدهای یک دسته‌بندی برای مالک بازار' })
    async getCategoryUnits(
        @Param('slug') slug: string,
        @Param('categoryId') categoryId: string,
    ) {
        return this.categoryService.getCategoryUnits(categoryId);
    }


}