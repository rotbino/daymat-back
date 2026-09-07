// src/arm-admin/catalogs/arm-admin-catalogs.controller.ts
import {
    Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ArmAdminCatalogsService } from './arm-admin-catalogs.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ArmAdminGuard } from '../../common/guards/arm-admin.guard';
import { CurrentUser } from '../../common/decorators/custom.decorators';

@ApiTags('arm-admin/memberships')
@Controller('arm-admin/:slug/memberships')
@UseGuards(JwtAuthGuard, ArmAdminGuard)
@ApiBearerAuth('access-token')
export class ArmAdminCatalogsController {
    constructor(private catalogsService: ArmAdminCatalogsService) {}

    // ═══ فروشندگان ═══

    @Get('sellers')
    @ApiOperation({ summary: 'فروشندگان بازار (کاتالوگ‌های عضو) — با جستجو/فیلتر/سورت' })
    @ApiQuery({ name: 'search', required: false })
    @ApiQuery({ name: 'ownerStatus', required: false, enum: ['all', 'active', 'paused'] })
    @ApiQuery({ name: 'sortBy', required: false, enum: ['joinedAt', 'updated', 'table', 'needs', 'name'] })
    @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
    async getSellers(
        @Param('slug') slug: string,
        @Query('search') search?: string,
        @Query('ownerStatus') ownerStatus?: string,
        @Query('sortBy') sortBy?: string,
        @Query('sortOrder') sortOrder?: string,
    ) {
        return this.catalogsService.getSellers(slug, {
            search,
            ownerStatus: (ownerStatus as any) || 'all',
            sortBy,
            sortOrder: (sortOrder as any) || 'desc',
        });
    }

    @Get('sellers/candidates')
    @ApiOperation({ summary: 'کاتالوگ‌های کاندید فروشنده' })
    @ApiQuery({ name: 'q', required: false })
    @ApiQuery({ name: 'myReferrals', required: false })
    async getSellerCandidates(
        @Param('slug') slug: string,
        @CurrentUser() user: any,
        @Query('q') q?: string,
        @Query('myReferrals') myReferrals?: string,
    ) {
        return this.catalogsService.getSellerCandidates(user.id, slug, q?.trim() || undefined, myReferrals === '1');
    }

    @Post('sellers')
    @ApiOperation({ summary: 'افزودن فروشنده (کاتالوگ) به بازار + مهر انتشار' })
    async addSeller(
        @Param('slug') slug: string,
        @Body('catalogId') catalogId: string,
    ) {
        return this.catalogsService.addSeller(slug, catalogId);
    }

    @Patch('sellers/:catalogId')
    @ApiOperation({ summary: 'توقف / ادامهٔ فروشنده' })
    async setSellerPaused(
        @Param('slug') slug: string,
        @Param('catalogId') catalogId: string,
        @Body('paused') paused: boolean,
    ) {
        return this.catalogsService.setCatalogPaused(slug, catalogId, paused === true);
    }

    @Delete('sellers/:catalogId')
    @ApiOperation({ summary: 'حذف فروشنده از بازار' })
    async removeSeller(
        @Param('slug') slug: string,
        @Param('catalogId') catalogId: string,
        @CurrentUser() user: any,
    ) {
        return this.catalogsService.removeCatalog(slug, catalogId, user.id);
    }

    @Patch('sellers/ads/:adId/category')
    @ApiOperation({ summary: 'تعیین دستهٔ بازاری یک کالا' })
    async setAdCategory(
        @Param('slug') slug: string,
        @Param('adId') adId: string,
        @Body('categoryId') categoryId: string,
    ) {
        return this.catalogsService.setAdCategory(slug, adId, categoryId);
    }

    @Get('needs-category')
    @ApiOperation({ summary: 'کالاهای منتشرشدهٔ بدون دستهٔ بازاری' })
    async getNeedsCategory(@Param('slug') slug: string) {
        return this.catalogsService.getNeedsCategory(slug);
    }

    // ═══ خریداران ═══

    @Get('buyers')
    @ApiOperation({ summary: 'خریداران بازار (کسب‌وکارهای عضو) — با جستجو/سورت' })
    @ApiQuery({ name: 'search', required: false })
    @ApiQuery({ name: 'ownerStatus', required: false, enum: ['all', 'active', 'paused'] })
    @ApiQuery({ name: 'sortBy', required: false })
    @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
    async getBuyers(
        @Param('slug') slug: string,
        @Query('search') search?: string,
        @Query('ownerStatus') ownerStatus?: string,
        @Query('sortBy') sortBy?: string,
        @Query('sortOrder') sortOrder?: string,
    ) {
        return this.catalogsService.getBuyers(slug, {
            search,
            ownerStatus: (ownerStatus as any) || 'all',
            sortBy,
            sortOrder: (sortOrder as any) || 'desc',
        });
    }

    @Get('buyers/candidates')
    @ApiOperation({ summary: 'کسب‌وکارهای کاندید خریدار' })
    @ApiQuery({ name: 'q', required: false })
    @ApiQuery({ name: 'myReferrals', required: false })
    async getBuyerCandidates(
        @Param('slug') slug: string,
        @CurrentUser() user: any,
        @Query('q') q?: string,
        @Query('myReferrals') myReferrals?: string,
    ) {
        return this.catalogsService.getBuyerCandidates(user.id, slug, q?.trim() || undefined, myReferrals === '1');
    }

    @Post('buyers')
    @ApiOperation({ summary: 'افزودن خریدار (کسب‌وکار) به بازار' })
    async addBuyer(
        @Param('slug') slug: string,
        @Body('businessId') businessId: string,
    ) {
        return this.catalogsService.addBuyer(slug, businessId);
    }

    @Delete('buyers/:membershipId')
    @ApiOperation({ summary: 'حذف نقش خریداری (arm_owner: فقط businessId پاک می‌شود)' })
    async removeBuyer(
        @Param('slug') slug: string,
        @Param('membershipId') membershipId: string,
        @CurrentUser() user: any,
    ) {
        return this.catalogsService.removeBuyer(slug, membershipId, user.id);
    }

    @Patch('buyers/:membershipId/pause')
    @ApiOperation({ summary: 'تعلیق موقت خریدار (pause/resume)' })
    async setBuyerPaused(
        @Param('slug') slug: string,
        @Param('membershipId') membershipId: string,
        @Body() body: { paused: boolean },
    ) {
        return this.catalogsService.setBuyerPaused(slug, membershipId, body.paused);
    }

    // ═══ رفرال ═══

    @Get('referral-stats')
    @ApiOperation({ summary: 'آمار جذب بازار (مجموع همهٔ مالک‌ها — دعوت مستقیم)' })
    async getReferralStats(@Param('slug') slug: string, @CurrentUser() user: any) {
        return this.catalogsService.getReferralStats(user.id, slug);
    }
}