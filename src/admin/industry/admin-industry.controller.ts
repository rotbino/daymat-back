// src/admin/industry/admin-industry.controller.ts
import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AdminIndustryService } from './admin-industry.service';
import { CreateIndustryDto, UpdateIndustryDto } from './admin-industry.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { ArmManagerGuard } from '../../common/guards/arm-manager.guard';
import { ArmAdminOrOwnerReadGuard } from '../../common/guards/arm-admin-or-owner-read.guard';

@ApiTags('industries')
@Controller()
export class AdminIndustryController {
    constructor(private industryService: AdminIndustryService) {}

    // ✅ публичный endpoint برای autocomplete (همه کاربران)
    @Get('industries/autocomplete')
    @UseGuards(OptionalJwtAuthGuard)
    @ApiOperation({ summary: 'جستجوی خودکار صنف‌ها برای autocomplete' })
    @ApiQuery({ name: 'q', required: true })
    async autocomplete(@Query('q') q: string) {
        if (!q || q.trim().length < 2) {
            return { items: [] };
        }
        return this.industryService.search(q.trim(), 10, 0, false);
    }

    @Get('admin/industries/search')
    @UseGuards(JwtAuthGuard, ArmAdminOrOwnerReadGuard)
    @ApiOperation({ summary: 'جستجوی صنف‌ها با pagination' })
    @ApiQuery({ name: 'q', required: true })
    @ApiQuery({ name: 'limit', required: false })
    @ApiQuery({ name: 'offset', required: false })
    @ApiQuery({ name: 'leavesOnly', required: false, type: Boolean })
    async search(
        @Query('q') q: string,
        @Query('limit') limit = '20',
        @Query('offset') offset = '0',
        @Query('leavesOnly') leavesOnly?: string,
    ) {
        const isLeaves = leavesOnly === 'true';
        return this.industryService.search(q, +limit, +offset, isLeaves);
    }

    // ============================================================
    // ✅ دریافت فقط برگ‌ها (قابل انتخاب) - هم ادمین و هم مالک
    // ============================================================
    @Get('admin/industries/leaves')
    @UseGuards(JwtAuthGuard, ArmAdminOrOwnerReadGuard)
    @ApiOperation({ summary: 'دریافت لیست صنف‌های برگ (قابل انتخاب)' })
    @ApiResponse({ status: 200, description: 'لیست صنف‌های برگ' })
    @ApiQuery({ name: 'slug', required: false, description: 'شناسه بازار (برای مالک بازار)' })
    async getLeaves(@Query('slug') slug?: string) {
        return this.industryService.getLeaves();
    }

    // ============================================================
    // ✅ دریافت درخت کامل - هم ادمین و هم مالک
    // ============================================================
    @Get('admin/industries/tree')
    @UseGuards(JwtAuthGuard, ArmAdminOrOwnerReadGuard)
    @ApiOperation({ summary: 'دریافت درخت کامل صنف‌ها' })
    @ApiResponse({ status: 200, description: 'درخت صنف‌ها' })
    async getTree() {
        return this.industryService.getTree();
    }

    // ============================================================
    // ✅ دریافت همه صنف‌ها (مسطح) - هم ادمین و هم مالک
    // ============================================================
    @Get('admin/industries')
    @UseGuards(JwtAuthGuard, ArmAdminOrOwnerReadGuard)
    @ApiOperation({ summary: 'دریافت لیست همه صنف‌ها (مسطح)' })
    @ApiResponse({ status: 200, description: 'لیست همه صنف‌ها' })
    async getAll() {
        return this.industryService.getAll();
    }



    // ============================================================
    // ✅ دریافت یک صنف - هم ادمین و هم مالک
    // ============================================================
    @Get('admin/industries/:id')
    @UseGuards(JwtAuthGuard, ArmAdminOrOwnerReadGuard)
    @ApiOperation({ summary: 'دریافت یک صنف با id' })
    @ApiResponse({ status: 200, description: 'اطلاعات صنف' })
    @ApiResponse({ status: 404, description: 'صنف یافت نشد' })
    async getOne(@Param('id') id: string) {
        return this.industryService.getOne(id);
    }

    // ============================================================
    // ✅ دریافت زیرمجموعه‌ها - هم ادمین و هم مالک
    // ============================================================
    @Get('admin/industries/:id/children')
    @UseGuards(JwtAuthGuard, ArmAdminOrOwnerReadGuard)
    @ApiOperation({ summary: 'دریافت زیرمجموعه‌های یک صنف' })
    @ApiResponse({ status: 200, description: 'زیرمجموعه‌ها' })
    @ApiResponse({ status: 404, description: 'صنف یافت نشد' })
    async getChildren(@Param('id') id: string) {
        return this.industryService.getChildren(id);
    }

    // ============================================================
    // ✅ دریافت مسیر - هم ادمین و هم مالک
    // ============================================================
    @Get('admin/industries/:id/path')
    @UseGuards(JwtAuthGuard, ArmAdminOrOwnerReadGuard)
    @ApiOperation({ summary: 'دریافت کل مسیر یک صنف' })
    @ApiResponse({ status: 200, description: 'مسیر صنف' })
    @ApiResponse({ status: 404, description: 'صنف یافت نشد' })
    async getPath(@Param('id') id: string) {
        return this.industryService.getPath(id);
    }

    // ============================================================
    // ❌ ایجاد صنف جدید - فقط ادمین سیستم
    // ============================================================
    @Post('admin/industries')
    @UseGuards(JwtAuthGuard, ArmManagerGuard)
    @ApiOperation({ summary: 'ایجاد صنف جدید (فقط ادمین)' })
    @ApiResponse({ status: 201, description: 'صنف با موفقیت ایجاد شد' })
    @ApiResponse({ status: 409, description: 'slug تکراری است' })
    @ApiResponse({ status: 400, description: 'والد یافت نشد' })
    async create(@Body() dto: CreateIndustryDto) {
        return this.industryService.create(dto);
    }

    // ============================================================
    // ❌ ویرایش صنف - فقط ادمین سیستم
    // ============================================================
    @Put('admin/industries/:id')
    @UseGuards(JwtAuthGuard, ArmManagerGuard)
    @ApiOperation({ summary: 'ویرایش صنف (فقط ادمین)' })
    @ApiResponse({ status: 200, description: 'صنف با موفقیت ویرایش شد' })
    @ApiResponse({ status: 404, description: 'صنف یافت نشد' })
    @ApiResponse({ status: 409, description: 'slug تکراری است' })
    @ApiResponse({ status: 400, description: 'خطا در والد یا ایجاد حلقه' })
    async update(@Param('id') id: string, @Body() dto: UpdateIndustryDto) {
        return this.industryService.update(id, dto);
    }

    // ============================================================
    // ❌ حذف صنف - فقط ادمین سیستم
    // ============================================================
    @Delete('admin/industries/:id')
    @UseGuards(JwtAuthGuard, ArmManagerGuard)
    @ApiOperation({ summary: 'حذف صنف (فقط ادمین)' })
    @ApiResponse({ status: 200, description: 'صنف با موفقیت حذف شد' })
    @ApiResponse({ status: 404, description: 'صنف یافت نشد' })
    @ApiResponse({ status: 409, description: 'صنف دارای زیرمجموعه یا در کاتالوگ استفاده شده است' })
    async remove(@Param('id') id: string) {
        return this.industryService.remove(id);
    }
}