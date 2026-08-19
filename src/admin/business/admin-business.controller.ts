// src/admin/business/admin-business.controller.ts
import { Controller, Get, Post, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AdminBusinessService } from './admin-business.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../guards/admin.guard';
import { CurrentUser } from '../../common/decorators/custom.decorators';

@ApiTags('admin/businesses')
@Controller('admin/businesses')
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiBearerAuth('access-token')
export class AdminBusinessController {
    constructor(private adminBusinessService: AdminBusinessService) {}

    @Get()
    @ApiOperation({ summary: 'لیست کسب‌وکارها با فیلتر و آمار' })
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
    async getBusinesses(@Query() query: any) {
        return this.adminBusinessService.getBusinesses(query);
    }

    @Get(':id')
    @ApiOperation({ summary: 'جزئیات کسب‌وکار (شامل مدارک تیک)' })
    async getBusinessDetail(@Param('id') id: string) {
        return this.adminBusinessService.getBusinessDetail(id);
    }

    @Post(':id/verify')
    @ApiOperation({ summary: 'تأیید یا رد درخواست تیک اعتماد' })
    async verifyBusiness(
        @Param('id') id: string,
        @CurrentUser() user: any,
        @Body() body: { action: 'approve' | 'reject'; tier?: string; reason?: string; verificationId?: string },
    ) {
        return this.adminBusinessService.verifyBusiness(id, user.id, body);
    }
}