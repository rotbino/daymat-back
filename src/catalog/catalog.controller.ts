// src/catalog/catalog.controller.ts
import {
    Controller,
    Get,
    Post,
    Delete,
    Param,
    UseGuards,
    Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../common/decorators/custom.decorators';
import { CatalogService } from './catalog.service';
import { Request } from 'express';

@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
    constructor(private catalogService: CatalogService) {}

    // ═══════════════════════════════════════════════════════
    // ✅ ثبت بازدید کاتالوگ (عمومی)
    // ═══════════════════════════════════════════════════════
    @Post(':businessId/view')
    @UseGuards(OptionalJwtAuthGuard)
    @ApiOperation({ summary: 'ثبت بازدید کاتالوگ' })
    async trackView(
        @Param('businessId') businessId: string,
        @CurrentUser() user: any,
        @Req() req: Request,
    ) {
        return this.catalogService.trackView(
            businessId,
            user?.id || null,
            req.ip,
        );
    }

    // ═══════════════════════════════════════════════════════
    // ✅ ذخیره کاتالوگ
    // ═══════════════════════════════════════════════════════
    @Post(':businessId/save')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'ذخیره کاتالوگ' })
    async save(
        @Param('businessId') businessId: string,
        @CurrentUser() user: any,
    ) {
        return this.catalogService.save(businessId, user.id);
    }

    // ═══════════════════════════════════════════════════════
    // ✅ حذف از ذخیره
    // ═══════════════════════════════════════════════════════
    @Delete(':businessId/save')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'حذف از ذخیره کاتالوگ' })
    async unsave(
        @Param('businessId') businessId: string,
        @CurrentUser() user: any,
    ) {
        return this.catalogService.unsave(businessId, user.id);
    }

    // ═══════════════════════════════════════════════════════
    // ✅ بررسی وضعیت ذخیره
    // ═══════════════════════════════════════════════════════
    @Get(':businessId/saved-status')
    @UseGuards(OptionalJwtAuthGuard)
    @ApiOperation({ summary: 'بررسی وضعیت ذخیره کاتالوگ' })
    async isSaved(
        @Param('businessId') businessId: string,
        @CurrentUser() user: any,
    ) {
        if (!user?.id) return { isSaved: false };
        return this.catalogService.isSaved(businessId, user.id);
    }

    // ═══════════════════════════════════════════════════════
    // ✅ آمار کاتالوگ (عمومی)
    // ═══════════════════════════════════════════════════════
    @Get(':businessId/stats')
    @ApiOperation({ summary: 'آمار کاتالوگ' })
    async getStats(@Param('businessId') businessId: string) {
        return this.catalogService.getStats(businessId);
    }

    // ═══════════════════════════════════════════════════════
    // ✅ لیست کاتالوگ‌های ذخیره شده کاربر
    // ═══════════════════════════════════════════════════════
    @Get('saved/list')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'لیست کاتالوگ‌های ذخیره شده' })
    async getSavedList(@CurrentUser() user: any) {
        return this.catalogService.getSavedList(user.id);
    }

    // ═══════════════════════════════════════════════════════
    // ✅ لیست آگهی‌های کاتالوگ (عمومی)
    // ═══════════════════════════════════════════════════════
    @Get(':businessId/ads')
    @ApiOperation({ summary: 'لیست آگهی‌های کاتالوگ' })
    async getCatalogAds(
        @Param('businessId') businessId: string,
        @Req() req: Request,
    ) {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 10;
        const search = req.query.search as string | undefined;
        return this.catalogService.getCatalogAds(businessId, page, limit, search);
    }
}