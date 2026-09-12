// src/business/business.controller.ts
import {
    Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BusinessService } from './business.service';
import { CreateBusinessDto, UpdateBusinessDto, RequestBusinessVerificationDto } from './business.dto';
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

    @Get(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'جزئیات کسب‌وکار (با کاتالوگ‌ها و تیمش) — فقط ثبت‌کننده/مالک' })
    findOne(@Param('id') id: string, @CurrentUser() user: any) {
        return this.businessService.findOne(id, user.id);
    }

    @Put(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'ویرایش کسب‌وکار (فقط ثبت‌کنندهٔ اول یا مالک قدیمی)' })
    update(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: UpdateBusinessDto) {
        return this.businessService.update(id, user.id, dto);
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
