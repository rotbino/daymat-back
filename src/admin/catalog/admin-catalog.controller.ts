// src/admin/catalog/admin-catalog.controller.ts
import { Controller, Get, Post, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AdminCatalogService } from './admin-catalog.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../guards/admin.guard';
import { CurrentUser } from '../../common/decorators/custom.decorators';

@ApiTags('admin/cataloges')
@Controller('admin/cataloges')
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiBearerAuth('access-token')
export class AdminCatalogController {
    constructor(private adminCatalogService: AdminCatalogService) {}

    @Get()
    @ApiOperation({ summary: 'لیست کاتالوگها با فیلتر و آمار' })
    @ApiQuery({ name: 'page', required: false })
    @ApiQuery({ name: 'limit', required: false })
    @ApiQuery({ name: 'search', required: false })
    @ApiQuery({ name: 'status', required: false })
    @ApiQuery({ name: 'type', required: false })
    @ApiQuery({ name: 'verificationTier', required: false })
    @ApiQuery({ name: 'verificationStatus', required: false })
    @ApiQuery({ name: 'provinceCode', required: false })
    @ApiQuery({ name: 'cityCode', required: false })
    @ApiQuery({ name: 'industryId', required: false })
    @ApiQuery({ name: 'activityId', required: false })
    @ApiQuery({ name: 'armSlug', required: false })
    @ApiQuery({ name: 'sortBy', required: false })
    @ApiQuery({ name: 'sortOrder', required: false })
    async getCataloges(@Query() query: any) {
        return this.adminCatalogService.getCataloges(query);
    }

    @Get(':id')
    @ApiOperation({ summary: 'جزئیات کاتالوگ (شامل مدارک تیک)' })
    async getCatalogDetail(@Param('id') id: string) {
        return this.adminCatalogService.getCatalogDetail(id);
    }

    @Post(':id/verify')
    @ApiOperation({ summary: 'تأیید یا رد درخواست تیک اعتماد' })
    async verifyCatalog(
        @Param('id') id: string,
        @CurrentUser() user: any,
        @Body() body: { action: 'approve' | 'reject'; tier?: string; reason?: string; verificationId?: string },
    ) {
        return this.adminCatalogService.verifyCatalog(id, user.id, body);
    }
}