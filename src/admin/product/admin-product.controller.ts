// src/admin/product/admin-product.controller.ts
// ✅ مدیریت کالاهای مرجع — فقط ادمین سیستم
import { Controller, Get, Put, Delete, Param, Query, Body, UseGuards, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminProductService } from './admin-product.service';
import { AdminUpdateProductDto } from './admin-product.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../guards/admin.guard';

@ApiTags('admin/products')
@Controller('admin/products')
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiBearerAuth('access-token')
export class AdminProductController {
    constructor(private adminProductService: AdminProductService) {}

    @Get()
    @ApiOperation({ summary: 'لیست مدیریتی کالاهای مرجع (فیلتر + صفحه‌بندی)' })
    async findAll(
        @Query('q') q?: string,
        @Query('brandId') brandId?: string,
        @Query('category') category?: string,
        @Query('armId') armId?: string,
        @Query('isActive') isActive?: string,
        @Query('confirmed') confirmed?: string,
        @Query('isByUser') isByUser?: string,
        @Query('hasAds') hasAds?: string,
        @Query('page') page = '1',
        @Query('limit') limit = '20',
        @Query('sortBy') sortBy?: string,
        @Query('sortOrder') sortOrder?: 'asc' | 'desc',
    ) {
        const toBool = (v?: string) => (v === 'true' ? true : v === 'false' ? false : undefined);
        return this.adminProductService.findAll({
            q,
            brandId,
            category,
            armId,
            isActive: toBool(isActive),
            confirmed: toBool(confirmed),
            isByUser: toBool(isByUser),
            hasAds: toBool(hasAds),
            page: parseInt(page, 10) || 1,
            limit: parseInt(limit, 10) || 20,
            sortBy,
            sortOrder,
        });
    }

    @Get(':id')
    @ApiOperation({ summary: 'جزئیات کالای مرجع + آگهی‌های اخیر وصل‌شده' })
    findOne(@Param('id') id: string) {
        return this.adminProductService.findOne(id);
    }

    @Get(':id/ads')
    @ApiOperation({ summary: 'لیست آگهی‌های وصل به این کالای مرجع' })
    getAds(
        @Param('id') id: string,
        @Query('page') page = '1',
        @Query('limit') limit = '20',
    ) {
        return this.adminProductService.getAds(id, parseInt(page, 10) || 1, parseInt(limit, 10) || 20);
    }

    @Put(':id')
    @ApiOperation({ summary: 'ویرایش مدیریتی کالای مرجع (بدون محدودیت isNew)' })
    update(@Param('id') id: string, @Body() dto: AdminUpdateProductDto) {
        return this.adminProductService.update(id, dto);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'حذف کالای مرجع — آگهی‌های وصل جدا می‌شوند' })
    remove(@Param('id') id: string) {
        return this.adminProductService.remove(id);
    }
}
