// src/business/business.controller.ts
import {
    Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BusinessService } from './business.service';
import {
    CreateBusinessDto, UpdateBusinessDto, RequestBusinessVerificationDto, SetBusinessActivitiesDto,
    AddBusinessMemberDto, UpdateBusinessMemberDto,
} from './business.dto';
import { CurrentUser } from '../common/decorators/custom.decorators';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard';

@ApiTags('business')
@Controller('business')
export class BusinessController {
    constructor(private businessService: BusinessService) {}

    // ─── عمومی (لاگین اختیاری) — باید قبل از روتِ :id باشد ───
    @Get('search')
    @UseGuards(OptionalJwtAuthGuard)
    @ApiOperation({ summary: 'جستجوی کسب‌وکارها (عمومی) — اول جستجو کن، تکراری ثبت نکن' })
    search(
        @Query('q') q?: string,
        @Query('provinceCode') provinceCode?: string,
        @Query('cityCode') cityCode?: string,
        @Query('limit') limit?: string,
        @Query('offset') offset?: string,
        @Query('ids') ids?: string,
    ) {
        const idList = (ids || '')
            .split(',')
            .map((s) => s.trim())
            .filter((s) => /^[a-f\d]{24}$/i.test(s));
        return this.businessService.search(
            q || '',
            provinceCode || undefined,
            cityCode || undefined,
            Number(limit) || 12,
            Number(offset) || 0,
            idList.length ? idList : undefined,
        );
    }

    @Post()
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'ثبت کسب‌وکار جدید (شما ثبت‌کنندهٔ اول می‌شوید — نه لزوماً مالک)' })
    create(@CurrentUser() user: any, @Body() dto: CreateBusinessDto) {
        return this.businessService.create(user.id, dto);
    }

    @Get('my')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'کسب‌وکارهای من (ثبت‌کننده/مالک قدیمی/عضو تیم) — با پرچم canEdit' })
    getMy(@CurrentUser() user: any) {
        return this.businessService.getMy(user.id);
    }

    @Get('search-users')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'جستجوی کاربر ثبت‌نام‌شدهٔ دیمت برای افزودن به تیم — با نام یا شماره موبایل' })
    searchTeamUsers(@Query('q') q?: string) {
        return this.businessService.searchTeamUsers(q || '');
    }

    @Get(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'جزئیات کسب‌وکار (با کاتالوگ‌ها و تیمش) — فقط ثبت‌کننده/مالک' })
    findOne(@Param('id') id: string, @CurrentUser() user: any) {
        return this.businessService.findOne(id, user.id);
    }

    // ─── تیم کاری کسب‌وکار — دو سطح نقش (سیستمی admin/member + نقش شرکتی) ───

    @Get(':id/my-membership')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'عضویت من در این کسب‌وکار — نقش شرکتی/سیستمی + canManageTeam (فرم کاتالوگ)' })
    getMyMembership(@Param('id') id: string, @CurrentUser() user: any) {
        return this.businessService.getMyMembership(id, user.id);
    }

    @Get(':id/members')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'لیست تیم کاری کسب‌وکار — فقط مدیر' })
    listMembers(@Param('id') id: string, @CurrentUser() user: any) {
        return this.businessService.listMembers(id, user.id);
    }

    @Post(':id/members')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'افزودن عضو تیم با شماره موبایل — فقط مدیر' })
    addMember(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: AddBusinessMemberDto) {
        return this.businessService.addMember(id, user.id, dto);
    }

    @Patch(':id/members/:memberId')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'ویرایش عضو — نقش شرکتی/سیستمی (memberId=me برای خود)' })
    updateMember(
        @Param('id') id: string,
        @Param('memberId') memberId: string,
        @CurrentUser() user: any,
        @Body() dto: UpdateBusinessMemberDto,
    ) {
        return this.businessService.updateMember(id, user.id, memberId, dto);
    }

    @Delete(':id/members/:memberId')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'حذف عضو از تیم — فقط مدیر' })
    removeMember(@Param('id') id: string, @Param('memberId') memberId: string, @CurrentUser() user: any) {
        return this.businessService.removeMember(id, user.id, memberId);
    }

    @Put(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'ویرایش کسب‌وکار (فقط ثبت‌کنندهٔ اول یا مالک قدیمی)' })
    update(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: UpdateBusinessDto) {
        return this.businessService.update(id, user.id, dto);
    }

    @Put(':id/activities')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'تنظیم زمینه‌های فعالیت کسب‌وکار (جایگزینی کامل لیست)' })
    setActivities(
        @Param('id') id: string,
        @CurrentUser() user: any,
        @Body() dto: SetBusinessActivitiesDto,
    ) {
        return this.businessService.setActivities(id, user.id, dto);
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'حذف کسب‌وکار (فقط بدون کاتالوگ)' })
    remove(@Param('id') id: string, @CurrentUser() user: any) {
        return this.businessService.remove(id, user.id);
    }

    @Post(':id/verify')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'ارسال مدارک تیک اعتماد کسب‌وکار' })
    requestVerification(
        @Param('id') id: string,
        @CurrentUser() user: any,
        @Body() dto: RequestBusinessVerificationDto,
    ) {
        return this.businessService.requestVerification(id, user.id, dto);
    }

    @Get(':id/verify/status')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'وضعیت تیک اعتماد کسب‌وکار من' })
    getVerificationStatus(@Param('id') id: string, @CurrentUser() user: any) {
        return this.businessService.getMyVerification(id, user.id);
    }
}
