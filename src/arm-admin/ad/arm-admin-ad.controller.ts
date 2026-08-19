// src/arm-admin/ad/arm-admin-ad.controller.ts
import {
    Controller, Get, Put, Delete, Param, Query, Body,
    UseGuards, BadRequestException, NotFoundException, Post,
} from '@nestjs/common';
import {ApiTags, ApiOperation, ApiBearerAuth, ApiResponse} from '@nestjs/swagger';
import { ArmAdminAdService } from './arm-admin-ad.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ArmAdminGuard } from '../../common/guards/arm-admin.guard';
import { CurrentUser } from '../../common/decorators/custom.decorators';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('arm-admin/ads')
@Controller('arm-admin/ads')
@UseGuards(JwtAuthGuard, ArmAdminGuard)
@ApiBearerAuth('access-token')
export class ArmAdminAdController {
    constructor(
        private adService: ArmAdminAdService,
        private prisma: PrismaService,
    ) {}

    @Get()
    @ApiOperation({ summary: 'لیست آگهی‌های بازار (فقط مالک بازار)' })
    async getAds(
        @CurrentUser() user: any,
        @Query('armSlug') armSlug?: string,
        @Query('page') page = 1,
        @Query('limit') limit = 20,
        @Query('status') status?: string,
        @Query('search') search?: string,
        @Query('categoryId') categoryId?: string,
        @Query('city') city?: string,
        @Query('sortBy') sortBy = 'createdAt',
        @Query('sortOrder') sortOrder: 'asc' | 'desc' = 'desc',
    ) {
        if (!armSlug) {
            throw new BadRequestException('شناسه بازار (armSlug) الزامی است');
        }

        // ✅ پیدا کردن بازار با اسلاگ
        const arm = await this.prisma.arm.findUnique({
            where: { slug: armSlug },
            select: { id: true },
        });

        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازار با این شناسه یافت نشد',
            });
        }

        // ✅ ارسال armId به سرویس
        return this.adService.getAds(arm.id, {
            page,
            limit,
            status,
            search,
            categoryId,
            city,
            sortBy,
            sortOrder,
        });
    }

    @Put(':id/status')
    @ApiOperation({ summary: 'تغییر وضعیت آگهی' })
    async updateStatus(@Param('id') id: string, @Body('status') status: string) {
        return this.adService.updateAdStatus(id, status);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'حذف آگهی' })
    async deleteAd(@Param('id') id: string) {
        return this.adService.deleteAd(id);
    }

    @Get(':id')
    @ApiOperation({ summary: 'جزئیات آگهی' })
    async getAdDetail(@Param('id') id: string) {
        return this.adService.getAdDetail(id);
    }

    // ✅ تایید آگهی
    @Post(':id/approve')
    @ApiOperation({ summary: 'تایید آگهی در انتظار تایید' })
    async approveAd(
        @Param('id') id: string,
        @CurrentUser() user: any,
    ) {
        return this.adService.approveAd(id);
    }

    // ✅ رد آگهی با دلیل
    @Post(':id/reject')
    @ApiOperation({ summary: 'رد آگهی در انتظار تایید با ذکر دلیل' })
    async rejectAd(
        @Param('id') id: string,
        @CurrentUser() user: any,
        @Body('reason') reason: string,
    ) {
        if (!reason || reason.trim().length === 0) {
            throw new BadRequestException({
                errorCode: 'REJECTION_REASON_REQUIRED',
                message: 'دلیل رد آگهی الزامی است',
            });
        }
        return this.adService.rejectAd(id, user.id, reason);
    }



}