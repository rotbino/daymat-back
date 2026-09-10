// src/catalog/catalog.controller.ts
import {
    Controller, Get, Post, Put, Delete, Patch, Body, Param, UseGuards, Query, Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { CatalogService } from './catalog.service';
import { CreateCatalogDto, UpdateCatalogDto, SaveVisitCardDto } from './catalog.dto';
import { CurrentUser } from '../common/decorators/custom.decorators';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard';
import { Request } from 'express';

@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
    constructor(private catalogService: CatalogService) {}

    // ─── عمومی ───
    @Get('slug/:slug')
    @ApiOperation({ summary: 'دریافت کاتالوگ با اسلاگ (عمومی)' })
    async findBySlug(@Param('slug') slug: string) {
        return this.catalogService.findBySlug(slug);
    }

    @Get('check-slug')
    @ApiOperation({ summary: 'بررسی آزاد بودن آدرس کاتالوگ' })
    @ApiQuery({ name: 'slug', required: true })
    @ApiQuery({ name: 'excludeId', required: false })
    async checkSlug(
        @Query('slug') slug: string,
        @Query('excludeId') excludeId?: string,
    ) {
        return this.catalogService.checkSlugAvailability(slug ?? '', excludeId || undefined);
    }

    @Get('featured')
    @ApiOperation({ summary: 'کاتالوگ‌های نمونه (عمومی)' })
    async featured(@Query('limit') limit?: string) {
        return this.catalogService.getFeatured(Number(limit) || 12);
    }

    @Get('saved/list')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'لیست کاتالوگ‌های ذخیره شده کاربر' })
    async getSavedList(@CurrentUser() user: any) {
        return this.catalogService.getSavedList(user.id);
    }

    // ─── احراز هویت‌دار ───
    @Post()
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'ثبت کاتالوگ جدید (برای یک کسب‌وکار)' })
    create(@CurrentUser() user: any, @Body() dto: CreateCatalogDto) {
        return this.catalogService.create(user.id, dto);
    }

    @Post('for-business')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'ساخت کاتالوگ برای یکی از کسب‌وکارهای من' })
    async createForBusiness(@CurrentUser() user: any, @Body() dto: CreateCatalogDto) {
        return this.catalogService.createForBusiness(user.id, dto);
    }

    @Get()
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'لیست کاتالوگ‌های من' })
    findAll(@CurrentUser() user: any) {
        return this.catalogService.findAllByUser(user.id);
    }

    @Get('active')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'کاتالوگ فعال فعلی' })
    getActive(@CurrentUser() user: any) {
        return this.catalogService.getActiveCatalog(user.id);
    }

    @Get(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'جزئیات یک کاتالوگ' })
    findOne(@Param('id') id: string, @CurrentUser() user: any) {
        return this.catalogService.findOne(id, user.id);
    }

    @Put(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'ویرایش کاتالوگ' })
    update(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: UpdateCatalogDto) {
        return this.catalogService.update(id, user.id, dto);
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'حذف کاتالوگ (soft delete)' })
    remove(@Param('id') id: string, @CurrentUser() user: any) {
        return this.catalogService.remove(id, user.id);
    }

    @Patch(':id/config')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'به‌روزرسانی تنظیمات کاتالوگ (واحدها و دسته‌ها)' })
    async updateConfig(
        @Param('id') id: string,
        @CurrentUser() user: any,
        @Body() dto: { units?: any[]; categoryTree?: any[] },
    ) {
        return this.catalogService.updateConfig(id, user.id, dto);
    }

    @Patch(':id/visit-card')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'ذخیره/حذف مشخصات کارت ویزیت کاتالوگ (JSON) — کارت کاربر گم نشود' })
    async saveVisitCard(
        @Param('id') id: string,
        @CurrentUser() user: any,
        @Body() dto: SaveVisitCardDto,
    ) {
        return this.catalogService.saveVisitCard(id, user.id, dto.spec);
    }

    // ─── تعاملات ───
    @Post(':catalogId/view')
    @UseGuards(OptionalJwtAuthGuard)
    @ApiOperation({ summary: 'ثبت بازدید کاتالوگ' })
    async trackView(
        @Param('catalogId') catalogId: string,
        @CurrentUser() user: any,
        @Req() req: Request,
    ) {
        return this.catalogService.trackView(catalogId, user?.id || null, req.ip);
    }

    @Post(':catalogId/save')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'ذخیره کاتالوگ' })
    async save(@Param('catalogId') catalogId: string, @CurrentUser() user: any) {
        return this.catalogService.save(catalogId, user.id);
    }

    @Delete(':catalogId/save')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'حذف از ذخیره کاتالوگ' })
    async unsave(@Param('catalogId') catalogId: string, @CurrentUser() user: any) {
        return this.catalogService.unsave(catalogId, user.id);
    }

    @Get(':catalogId/saved-status')
    @UseGuards(OptionalJwtAuthGuard)
    @ApiOperation({ summary: 'بررسی وضعیت ذخیره کاتالوگ' })
    async isSaved(@Param('catalogId') catalogId: string, @CurrentUser() user: any) {
        if (!user?.id) return { isSaved: false };
        return this.catalogService.isSaved(catalogId, user.id);
    }

    @Get(':catalogId/stats')
    @ApiOperation({ summary: 'آمار کاتالوگ' })
    async getStats(@Param('catalogId') catalogId: string) {
        return this.catalogService.getStats(catalogId);
    }

    @Post(':catalogId/share')
    @UseGuards(OptionalJwtAuthGuard)
    @ApiOperation({ summary: 'ثبت اشتراک‌گذاری کاتالوگ' })
    async trackShare(@Param('catalogId') catalogId: string, @CurrentUser() user: any) {
        return this.catalogService.trackShare(catalogId, user?.id || null);
    }

    @Get(':catalogId/ads')
    @ApiOperation({ summary: 'لیست کالاهای کاتالوگ (عمومی)' })
    async getCatalogAds(
        @Param('catalogId') catalogId: string,
        @Req() req: Request,
    ) {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 10;
        const search = req.query.search as string | undefined;
        return this.catalogService.getCatalogAds(catalogId, page, limit, search);
    }
}