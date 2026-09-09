// src/arm-admin/reference/arm-admin-reference.controller.ts
// ✅ مدیریت برندها و کالاهای مرجع بازار — مالک بازار (ArmAdminGuard)
// محدودهٔ دسترسی در سرویس چک می‌شود: فقط داده‌های ثبت‌شده از طریق همین بازار
import {
    Controller, Get, Put, Delete, Param, Query, Body, UseGuards, Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ArmAdminReferenceService } from './arm-admin-reference.service';
import { AdminUpdateProductDto } from '../../admin/product/admin-product.dto';
import { AdminUpdateBrandDto } from '../../admin/brand/admin-brand.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ArmAdminGuard } from '../../common/guards/arm-admin.guard';

@ApiTags('arm-admin/references')
@Controller('arm-admin/:slug/references')
@UseGuards(JwtAuthGuard, ArmAdminGuard)
@ApiBearerAuth('access-token')
export class ArmAdminReferenceController {
    constructor(private referenceService: ArmAdminReferenceService) {}

    // request.arm توسط ArmAdminGuard بعد از بررسی مالکیت پر می‌شود
    private armId(req: any): string {
        return req.arm?.id;
    }

    // ═══════════════ کالاهای مرجع ═══════════════

    @Get('products')
    @ApiOperation({ summary: 'لیست کالاهای مرجع ثبت‌شده از طریق این بازار' })
    async getProducts(
        @Req() req: any,
        @Query('q') q?: string,
        @Query('isActive') isActive?: string,
        @Query('confirmed') confirmed?: string,
        @Query('page') page = '1',
        @Query('limit') limit = '20',
        @Query('sortBy') sortBy?: string,
        @Query('sortOrder') sortOrder?: 'asc' | 'desc',
    ) {
        const toBool = (v?: string) => (v === 'true' ? true : v === 'false' ? false : undefined);
        return this.referenceService.getProducts(this.armId(req), {
            q, isActive: toBool(isActive), confirmed: toBool(confirmed),
            page: parseInt(page, 10) || 1, limit: parseInt(limit, 10) || 20, sortBy, sortOrder,
        });
    }

    @Get('products/:id')
    @ApiOperation({ summary: 'جزئیات کالای مرجع + آگهی‌های اخیر' })
    getProduct(@Req() req: any, @Param('id') id: string) {
        return this.referenceService.getProduct(this.armId(req), id);
    }

    @Get('products/:id/ads')
    @ApiOperation({ summary: 'آگهی‌های وصل به این کالای مرجع' })
    getProductAds(
        @Req() req: any,
        @Param('id') id: string,
        @Query('page') page = '1',
        @Query('limit') limit = '20',
    ) {
        return this.referenceService.getProductAds(this.armId(req), id, parseInt(page, 10) || 1, parseInt(limit, 10) || 20);
    }

    @Put('products/:id')
    @ApiOperation({ summary: 'ویرایش کالای مرجع بازار' })
    updateProduct(@Req() req: any, @Param('id') id: string, @Body() dto: AdminUpdateProductDto) {
        return this.referenceService.updateProduct(this.armId(req), id, dto);
    }

    @Delete('products/:id')
    @ApiOperation({ summary: 'حذف کالای مرجع بازار' })
    removeProduct(@Req() req: any, @Param('id') id: string) {
        return this.referenceService.removeProduct(this.armId(req), id);
    }

    // ═══════════════ برندها ═══════════════

    @Get('brands')
    @ApiOperation({ summary: 'لیست برندهای ثبت‌شده از طریق این بازار' })
    async getBrands(
        @Req() req: any,
        @Query('q') q?: string,
        @Query('isActive') isActive?: string,
        @Query('confirmed') confirmed?: string,
        @Query('page') page = '1',
        @Query('limit') limit = '20',
        @Query('sortBy') sortBy?: string,
        @Query('sortOrder') sortOrder?: 'asc' | 'desc',
    ) {
        const toBool = (v?: string) => (v === 'true' ? true : v === 'false' ? false : undefined);
        return this.referenceService.getBrands(this.armId(req), {
            q, isActive: toBool(isActive), confirmed: toBool(confirmed),
            page: parseInt(page, 10) || 1, limit: parseInt(limit, 10) || 20, sortBy, sortOrder,
        });
    }

    @Get('brands/:id')
    @ApiOperation({ summary: 'جزئیات برند + کالاها و آگهی‌های اخیر' })
    getBrand(@Req() req: any, @Param('id') id: string) {
        return this.referenceService.getBrand(this.armId(req), id);
    }

    @Get('brands/:id/ads')
    @ApiOperation({ summary: 'آگهی‌های وصل به این برند' })
    getBrandAds(
        @Req() req: any,
        @Param('id') id: string,
        @Query('page') page = '1',
        @Query('limit') limit = '20',
    ) {
        return this.referenceService.getBrandAds(this.armId(req), id, parseInt(page, 10) || 1, parseInt(limit, 10) || 20);
    }

    @Get('brands/:id/products')
    @ApiOperation({ summary: 'کالاهای مرجع وصل به این برند' })
    getBrandProducts(
        @Req() req: any,
        @Param('id') id: string,
        @Query('page') page = '1',
        @Query('limit') limit = '20',
    ) {
        return this.referenceService.getBrandProducts(this.armId(req), id, parseInt(page, 10) || 1, parseInt(limit, 10) || 20);
    }

    @Put('brands/:id')
    @ApiOperation({ summary: 'ویرایش برند بازار' })
    updateBrand(@Req() req: any, @Param('id') id: string, @Body() dto: AdminUpdateBrandDto) {
        return this.referenceService.updateBrand(this.armId(req), id, dto);
    }

    @Delete('brands/:id')
    @ApiOperation({ summary: 'حذف برند بازار' })
    removeBrand(@Req() req: any, @Param('id') id: string) {
        return this.referenceService.removeBrand(this.armId(req), id);
    }
}
