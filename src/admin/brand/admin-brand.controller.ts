// src/admin/brand/admin-brand.controller.ts
// ✅ مدیریت برندها — فقط ادمین سیستم
import { Controller, Get, Put, Delete, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminBrandService } from './admin-brand.service';
import { AdminUpdateBrandDto } from './admin-brand.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../guards/admin.guard';

@ApiTags('admin/brands')
@Controller('admin/brands')
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiBearerAuth('access-token')
export class AdminBrandController {
    constructor(private adminBrandService: AdminBrandService) {}

    @Get()
    @ApiOperation({ summary: 'لیست مدیریتی برندها (فیلتر + صفحه‌بندی)' })
    async findAll(
        @Query('q') q?: string,
        @Query('category') category?: string,
        @Query('armId') armId?: string,
        @Query('isActive') isActive?: string,
        @Query('confirmed') confirmed?: string,
        @Query('isByUser') isByUser?: string,
        @Query('hasProducts') hasProducts?: string,
        @Query('page') page = '1',
        @Query('limit') limit = '20',
        @Query('sortBy') sortBy?: string,
        @Query('sortOrder') sortOrder?: 'asc' | 'desc',
    ) {
        const toBool = (v?: string) => (v === 'true' ? true : v === 'false' ? false : undefined);
        return this.adminBrandService.findAll({
            q,
            category,
            armId,
            isActive: toBool(isActive),
            confirmed: toBool(confirmed),
            isByUser: toBool(isByUser),
            hasProducts: toBool(hasProducts),
            page: parseInt(page, 10) || 1,
            limit: parseInt(limit, 10) || 20,
            sortBy,
            sortOrder,
        });
    }

    @Get(':id')
    @ApiOperation({ summary: 'جزئیات برند + کالاهای مرجع و آگهی‌های اخیر' })
    findOne(@Param('id') id: string) {
        return this.adminBrandService.findOne(id);
    }

    @Get(':id/ads')
    @ApiOperation({ summary: 'لیست آگهی‌های وصل به این برند' })
    getAds(
        @Param('id') id: string,
        @Query('page') page = '1',
        @Query('limit') limit = '20',
    ) {
        return this.adminBrandService.getAds(id, parseInt(page, 10) || 1, parseInt(limit, 10) || 20);
    }

    @Get(':id/products')
    @ApiOperation({ summary: 'لیست کالاهای مرجع وصل به این برند' })
    getProducts(
        @Param('id') id: string,
        @Query('page') page = '1',
        @Query('limit') limit = '20',
    ) {
        return this.adminBrandService.getProducts(id, parseInt(page, 10) || 1, parseInt(limit, 10) || 20);
    }

    @Put(':id')
    @ApiOperation({ summary: 'ویرایش مدیریتی برند' })
    update(@Param('id') id: string, @Body() dto: AdminUpdateBrandDto) {
        return this.adminBrandService.update(id, dto);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'حذف برند — آگهی‌ها و کالاهای وصل جدا می‌شوند' })
    remove(@Param('id') id: string) {
        return this.adminBrandService.remove(id);
    }
}
