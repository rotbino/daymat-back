// src/inquiry/inquiry.controller.ts
// کاتالوگ خرید (استعلام قیمت) — کنترلر
import {
    Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { InquiryService } from './inquiry.service';
import { CreateInquiryDto, UpdateInquiryDto, CreateOfferDto, UpdateOfferDto, InquiryItemDto, UpdateInquiryItemDto, AddInquiryMemberDto, RequestInquiryAccessDto, DecideInquiryMemberDto } from './inquiry.dto';
import { CurrentUser } from '../common/decorators/custom.decorators';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard';

@ApiTags('inquiry')
@Controller('inquiry')
export class InquiryController {
    constructor(private inquiryService: InquiryService) {}

    // ─── عمومی: دیوار کاتالوگ‌های خرید ───
    @Get('public')
    @ApiOperation({ summary: 'دیوار عمومی کاتالوگ‌های خرید باز (بدون نیاز به ورود)' })
    @ApiQuery({ name: 'q', required: false })
    @ApiQuery({ name: 'city', required: false })
    @ApiQuery({ name: 'tag', required: false })
    @ApiQuery({ name: 'page', required: false })
    @ApiQuery({ name: 'limit', required: false })
    publicList(
        @Query('q') q?: string,
        @Query('city') city?: string,
        @Query('tag') tag?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        return this.inquiryService.publicList({
            q, city, tag,
            page: page ? Number(page) : 1,
            limit: limit ? Number(limit) : 20,
        });
    }

    // ─── احراز هویت‌دار ───
    @Post()
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'ساخت کاتالوگ خرید جدید' })
    create(@CurrentUser() user: any, @Body() dto: CreateInquiryDto) {
        return this.inquiryService.create(user.id, dto);
    }

    @Get('mine')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'کاتالوگ‌های خرید من' })
    mine(@CurrentUser() user: any) {
        return this.inquiryService.mine(user.id);
    }

    @Get('my-offers')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'پیشنهادهایی که من فرستاده‌ام (سمت تامین‌کننده)' })
    myOffers(@CurrentUser() user: any) {
        return this.inquiryService.myOffers(user.id);
    }

    // ⚠️ قبل از :idOrSlug — وگرنه greedy می‌شود
    @Get('opportunities')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'فرصت‌های فروش تامین‌کننده — دعوت‌ها + اعلام خریدهای فوریِ کاتالوگ‌های خریدِ عضوش' })
    opportunities(@CurrentUser() user: any) {
        return this.inquiryService.opportunities(user.id);
    }

    @Get(':idOrSlug')
    @UseGuards(OptionalJwtAuthGuard)
    @ApiOperation({ summary: 'جزئیات کاتالوگ خرید با شناسه یا اسلاگ (مالک: با پیشنهادها)' })
    findByIdOrSlug(@Param('idOrSlug') idOrSlug: string, @CurrentUser() user?: any) {
        return this.inquiryService.findByIdOrSlug(idOrSlug, user?.id);
    }

    @Patch(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'ویرایش کاتالوگ خرید (مالک)' })
    update(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: UpdateInquiryDto) {
        return this.inquiryService.update(id, user.id, dto);
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'حذف کاتالوگ خرید (مالک)' })
    remove(@Param('id') id: string, @CurrentUser() user: any) {
        return this.inquiryService.remove(id, user.id);
    }

    // ─── مدیریت قلم‌به‌قلم (پنل) ───
    @Post(':id/items')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'افزودن یک قلم به کاتالوگ خرید (مالک — هر بار یک کالا)' })
    addItem(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: InquiryItemDto) {
        return this.inquiryService.addItem(id, user.id, dto);
    }

    @Patch(':id/items/:itemId')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'ویرایش یک قلم (مالک) — شامل تاگل اعلام خرید' })
    updateItem(@Param('id') id: string, @Param('itemId') itemId: string, @CurrentUser() user: any, @Body() dto: UpdateInquiryItemDto) {
        return this.inquiryService.updateItem(id, itemId, user.id, dto);
    }

    @Delete(':id/items/:itemId')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'حذف یک قلم (مالک)' })
    removeItem(@Param('id') id: string, @Param('itemId') itemId: string, @CurrentUser() user: any) {
        return this.inquiryService.removeItem(id, itemId, user.id);
    }

    // ─── پیشنهاد قیمت ───
    @Post(':id/offers')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'ثبت پیشنهاد قیمت روی کاتالوگ خرید' })
    addOffer(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: CreateOfferDto) {
        return this.inquiryService.addOffer(id, user.id, dto);
    }

    @Get(':id/offers')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'پیشنهادهای دریافتی (فقط مالک)' })
    getOffers(@Param('id') id: string, @CurrentUser() user: any) {
        return this.inquiryService.getOffers(id, user.id);
    }

    @Patch('offers/:offerId')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'تغییر وضعیت پیشنهاد — پذیرش/رد (مالک) یا انصراف (پیشنهاددهنده)' })
    updateOffer(@Param('offerId') offerId: string, @CurrentUser() user: any, @Body() dto: UpdateOfferDto) {
        return this.inquiryService.updateOffer(offerId, user.id, dto);
    }

    // ─── اعضای کاتالوگ خرید — تامین‌کننده‌های تاییدشده (شبکهٔ خرید↔فروش) ───

    @Get(':id/members')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'فهرست تامین‌کننده‌های این کاتالوگ خرید (مالک)' })
    getMembers(@Param('id') id: string, @CurrentUser() user: any) {
        return this.inquiryService.getMembers(id, user.id);
    }

    @Get(':id/supplier-candidates')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'جست‌وجوی کاتالوگ فروش برای دعوت تامین‌کننده (مالک)' })
    supplierCandidates(@Param('id') id: string, @CurrentUser() user: any, @Query('q') q?: string) {
        return this.inquiryService.supplierCandidates(id, user.id, q);
    }

    @Post(':id/members')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'دعوت تامین‌کننده توسط خریدار — تایید نهایی با تامین‌کننده' })
    addMember(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: AddInquiryMemberDto) {
        return this.inquiryService.addMember(id, user.id, dto);
    }

    @Post(':id/request-access')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'درخواست عضویت تامین‌کننده با کاتالوگ فروشش — تایید با خریدار' })
    requestAccess(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: RequestInquiryAccessDto) {
        return this.inquiryService.requestAccess(id, user.id, dto);
    }

    @Patch(':id/members/:memberId')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'تایید/رد/حذف عضو — نقش مجاز بسته به مسیر دعوت/درخواست' })
    decideMember(@Param('id') id: string, @Param('memberId') memberId: string, @CurrentUser() user: any, @Body() dto: DecideInquiryMemberDto) {
        return this.inquiryService.decideMember(id, memberId, user.id, dto.status);
    }

    @Delete(':id/members/:memberId')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'حذف عضو (خریدار) یا خروج (خود تامین‌کننده)' })
    removeMember(@Param('id') id: string, @Param('memberId') memberId: string, @CurrentUser() user: any) {
        return this.inquiryService.decideMember(id, memberId, user.id, 'removed');
    }
}
