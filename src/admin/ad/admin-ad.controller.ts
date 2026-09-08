// src/admin/ad/admin-ad.controller.ts
import { Controller, Get, Put, Delete, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AdminAdService } from './admin-ad.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../guards/admin.guard';

@ApiTags('admin/ads')
@Controller('admin/ads')
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiBearerAuth('access-token')
export class AdminAdController {
    constructor(private adService: AdminAdService) {}

    @Get('categories')
    @ApiOperation({ summary: 'درخت دسته‌بندی برای آگهی‌ها' })
    @ApiQuery({ name: 'armSlug', required: false })
    async getCategories(@Query('armSlug') armSlug?: string) { return this.adService.getCategoryTreeForAds(armSlug); }

    // src/admin/ad/admin-ad.controller.ts - اضافه کن:

    @Get('locations')
    @ApiOperation({ summary: 'درخت موقعیت برای آگهی‌ها' })
    @ApiQuery({ name: 'armSlug', required: false })
    async getLocations(@Query('armSlug') armSlug?: string) {
        return this.adService.getLocationTreeForAds(armSlug);
    }

    @Get('arms')
    @ApiOperation({ summary: 'لیست بازارها برای فیلتر' })
    async getArms() { return this.adService.getArmsForFilter(); }

    @Get('stats')
    @ApiOperation({ summary: 'آمار آگهی‌ها' })
    async getStats(@Query() query: any) { return this.adService.getStats(query); }

    @Get()
    @ApiOperation({ summary: 'لیست آگهی‌ها با فیلتر' })
    async getAds(@Query() query: any) { return this.adService.getAds(query); }

    @Get(':id')
    @ApiOperation({ summary: 'جزئیات آگهی' })
    async getAdDetail(@Param('id') id: string) { return this.adService.getAdDetail(id); }

    @Put(':id/status')
    @ApiOperation({ summary: 'تغییر وضعیت آگهی' })
    async updateStatus(@Param('id') id: string, @Body('status') status: string) { return this.adService.updateAdStatus(id, status); }

    @Delete(':id')
    @ApiOperation({ summary: 'حذف آگهی' })
    async deleteAd(@Param('id') id: string) { return this.adService.deleteAd(id); }
}