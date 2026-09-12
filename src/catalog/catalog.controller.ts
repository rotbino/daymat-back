// src/catalog/catalog.controller.ts
import {
    Controller, Get, Post, Put, Delete, Patch, Body, Param, UseGuards, Query, Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { CatalogService } from './catalog.service';
import { CatalogMemberService } from './catalog-member.service';
import { CreateCatalogDto, UpdateCatalogDto, SaveVisitCardDto } from './catalog.dto';
import { CoopJoinDto, AddCustomerDto, AssignCustomerDto, RejectCoopDto, DeclineCustomerDto, RegionDto, ApproveSellerDto, ApproveBuyerDto, SellerRoleDto } from './catalog-member.dto';
import { CurrentUser } from '../common/decorators/custom.decorators';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard';
import { Request } from 'express';

@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
    constructor(
        private catalogService: CatalogService,
        private catalogMemberService: CatalogMemberService,
    ) {}

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
    @ApiOperation({ summary: 'ثبت کاتالوگ جدید (روی هر کسب‌وکارِ فعال — مرجع/مشترک)' })
    create(@CurrentUser() user: any, @Body() dto: CreateCatalogDto) {
        return this.catalogService.create(user.id, dto);
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

    // ============================================================
    // تیم کاتالوگ — اونر / مدیر / عضوِ فروش (فروشنده/ویزیتور) / مشتری
    // ============================================================

    @Get('team/memberships')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'همهٔ عضویت‌های تیمی من در کاتالوگ‌ها (پروفایل/سوییچر)' })
    async getMyTeamMemberships(@CurrentUser() user: any) {
        return this.catalogMemberService.getMyMemberships(user.id);
    }

    @Get(':catalogId/team')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'نمای تیم کاتالوگ (مقیاس‌شده با نقش)' })
    async getTeam(@Param('catalogId') catalogId: string, @CurrentUser() user: any) {
        return this.catalogMemberService.getTeam(catalogId, user.id);
    }

    @Get(':catalogId/team/my')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'وضعیت من در تیم این کاتالوگ' })
    async getMyTeamMembership(@Param('catalogId') catalogId: string, @CurrentUser() user: any) {
        return this.catalogMemberService.getMyMembership(catalogId, user.id);
    }

    // ─── درخواست ارتباط تجاری (یک در برای هر سه نقش بیزینسی) ───

    @Post(':catalogId/team/join')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'درخواست ارتباط تجاری با کاتالوگ (همکار فروش | خریدار | تامین‌کننده)' })
    async joinCoop(@Param('catalogId') catalogId: string, @CurrentUser() user: any, @Body() dto: CoopJoinDto) {
        return this.catalogMemberService.joinCoop(catalogId, user.id, dto);
    }

    @Post(':catalogId/team/sellers/:memberId/approve')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'تایید درخواست همکار فروش + تعیین نقش بیزینسی (مالک/مدیر)' })
    async approveSeller(
        @Param('catalogId') catalogId: string,
        @Param('memberId') memberId: string,
        @CurrentUser() user: any,
        @Body() dto: ApproveSellerDto,
    ) {
        return this.catalogMemberService.approveSeller(catalogId, memberId, user.id, dto?.sellerRole);
    }

    @Post(':catalogId/team/sellers/:memberId/reject')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'رد درخواست ارتباط تجاری (مالک/مدیر)' })
    async rejectSeller(
        @Param('catalogId') catalogId: string,
        @Param('memberId') memberId: string,
        @CurrentUser() user: any,
        @Body() dto: RejectCoopDto,
    ) {
        return this.catalogMemberService.rejectSeller(catalogId, memberId, user.id, dto?.reason);
    }

    @Post(':catalogId/team/buyers/:memberId/approve')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'تایید درخواست ارتباط تجاریِ خریدار + انتساب اختیاری به مسئول فروش (مالک/مدیر)' })
    async approveBuyer(
        @Param('catalogId') catalogId: string,
        @Param('memberId') memberId: string,
        @CurrentUser() user: any,
        @Body() dto: ApproveBuyerDto,
    ) {
        return this.catalogMemberService.approveBuyer(catalogId, memberId, user.id, dto?.sellerUserId);
    }

    @Post(':catalogId/team/buyers/:memberId/reject')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'رد درخواست ارتباط تجاریِ خریدار (مالک/مدیر)' })
    async rejectBuyer(
        @Param('catalogId') catalogId: string,
        @Param('memberId') memberId: string,
        @CurrentUser() user: any,
        @Body() dto: RejectCoopDto,
    ) {
        return this.catalogMemberService.rejectBuyer(catalogId, memberId, user.id, dto?.reason);
    }

    @Post(':catalogId/team/suppliers/:memberId/approve')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'تایید درخواست تامین‌کننده (مالک/مدیر)' })
    async approveSupplier(
        @Param('catalogId') catalogId: string,
        @Param('memberId') memberId: string,
        @CurrentUser() user: any,
    ) {
        return this.catalogMemberService.approveSupplier(catalogId, memberId, user.id);
    }

    @Post(':catalogId/team/suppliers/:memberId/reject')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'رد درخواست تامین‌کننده (مالک/مدیر)' })
    async rejectSupplier(
        @Param('catalogId') catalogId: string,
        @Param('memberId') memberId: string,
        @CurrentUser() user: any,
        @Body() dto: RejectCoopDto,
    ) {
        return this.catalogMemberService.rejectSupplier(catalogId, memberId, user.id, dto?.reason);
    }

    @Delete(':catalogId/team/suppliers/:memberId')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'حذف تامین‌کنندهٔ فعال از کاتالوگ (مالک/مدیر)' })
    async removeSupplier(
        @Param('catalogId') catalogId: string,
        @Param('memberId') memberId: string,
        @CurrentUser() user: any,
        @Query('note') note?: string,
    ) {
        return this.catalogMemberService.removeSupplier(catalogId, memberId, user.id, note);
    }

    @Delete(':catalogId/team/sellers/:memberId')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'حذف عضوِ فروش از کاتالوگ (اونر/مدیر)' })
    async removeSeller(
        @Param('catalogId') catalogId: string,
        @Param('memberId') memberId: string,
        @CurrentUser() user: any,
        @Query('note') note?: string,
    ) {
        return this.catalogMemberService.removeSeller(catalogId, memberId, user.id, note);
    }

    @Post(':catalogId/team/leave-seller')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'خروج خودِ عضوِ فروش از کاتالوگ' })
    async leaveAsSeller(@Param('catalogId') catalogId: string, @CurrentUser() user: any) {
        return this.catalogMemberService.leaveAsSeller(catalogId, user.id);
    }

    @Patch(':catalogId/team/sellers/:memberId/region')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'ثبت/ویرایش منطقهٔ فروش عضوِ فروش (اونر/مدیر/خودش)' })
    async setSellerRegion(
        @Param('catalogId') catalogId: string,
        @Param('memberId') memberId: string,
        @CurrentUser() user: any,
        @Body() dto: RegionDto,
    ) {
        return this.catalogMemberService.setSellerRegion(catalogId, memberId, dto?.region, user.id);
    }

    @Patch(':catalogId/team/sellers/:memberId/role')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'تغییر نقش بیزینسی عضوِ فروش (فروشنده/ویزیتور) — اونر/مدیر' })
    async setSellerRole(
        @Param('catalogId') catalogId: string,
        @Param('memberId') memberId: string,
        @CurrentUser() user: any,
        @Body() dto: SellerRoleDto,
    ) {
        return this.catalogMemberService.setSellerRole(catalogId, memberId, dto.sellerRole, user.id);
    }

    // ─── نقش ادمین کاتالوگ ───

    @Post(':catalogId/team/members/:memberId/promote-admin')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'ارتقای عضو به ادمین کاتالوگ (فقط اونر)' })
    async promoteToAdmin(@Param('catalogId') catalogId: string, @Param('memberId') memberId: string, @CurrentUser() user: any) {
        return this.catalogMemberService.promoteToAdmin(catalogId, memberId, user.id);
    }

    @Post(':catalogId/team/members/:memberId/demote-admin')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'گرفتن نقش ادمین (فقط اونر)' })
    async demoteToMember(@Param('catalogId') catalogId: string, @Param('memberId') memberId: string, @CurrentUser() user: any) {
        return this.catalogMemberService.demoteToMember(catalogId, memberId, user.id);
    }

    // ─── لِین خریدار (مشتری) ───

    @Get(':catalogId/team/customer-candidates')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'جست‌وجوی کسب‌وکار برای ثبت مشتری' })
    @ApiQuery({ name: 'q', required: false })
    async customerCandidates(
        @Param('catalogId') catalogId: string,
        @CurrentUser() user: any,
        @Query('q') q?: string,
    ) {
        return this.catalogMemberService.customerCandidates(catalogId, user.id, q);
    }

    @Post(':catalogId/team/customers')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'ثبت خریدار توسط مسئول فروش — pending تا تایید صاحب کسب‌وکار' })
    async addCustomer(@Param('catalogId') catalogId: string, @CurrentUser() user: any, @Body() dto: AddCustomerDto) {
        return this.catalogMemberService.addCustomer(catalogId, user.id, dto);
    }

    @Post(':catalogId/team/customers/:memberId/confirm')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'تایید مشتری‌بودن (صاحب کسب‌وکار)' })
    async confirmCustomer(@Param('catalogId') catalogId: string, @Param('memberId') memberId: string, @CurrentUser() user: any) {
        return this.catalogMemberService.confirmCustomer(catalogId, memberId, user.id);
    }

    @Post(':catalogId/team/customers/:memberId/decline')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'ردِ ثبت مشتری (صاحب کسب‌وکار)' })
    async declineCustomer(
        @Param('catalogId') catalogId: string,
        @Param('memberId') memberId: string,
        @CurrentUser() user: any,
        @Body() dto: DeclineCustomerDto,
    ) {
        return this.catalogMemberService.declineCustomer(catalogId, memberId, user.id, dto?.reason);
    }

    @Patch(':catalogId/team/customers/:memberId/assign')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'تغییر مسئولِ مشتری (اونر/مدیر)' })
    async assignCustomer(
        @Param('catalogId') catalogId: string,
        @Param('memberId') memberId: string,
        @CurrentUser() user: any,
        @Body() dto: AssignCustomerDto,
    ) {
        return this.catalogMemberService.assignCustomer(catalogId, memberId, dto.sellerUserId, user.id);
    }

    @Delete(':catalogId/team/customers/:memberId')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'حذف مشتری (اونر/مدیر/مسئولِ منتسب)' })
    async removeCustomer(
        @Param('catalogId') catalogId: string,
        @Param('memberId') memberId: string,
        @CurrentUser() user: any,
        @Query('note') note?: string,
    ) {
        return this.catalogMemberService.removeCustomer(catalogId, memberId, user.id, note);
    }

    @Post(':catalogId/team/leave-customer')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'خروج خودِ مشتری از کاتالوگ' })
    async leaveAsCustomer(@Param('catalogId') catalogId: string, @CurrentUser() user: any) {
        return this.catalogMemberService.leaveAsCustomer(catalogId, user.id);
    }
}