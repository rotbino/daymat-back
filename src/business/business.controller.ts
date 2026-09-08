// src/business/business.controller.ts
import {
    Body, Controller, Delete, Get, Param, Post, Put, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BusinessService } from './business.service';
import { CreateBusinessDto, UpdateBusinessDto, RequestBusinessVerificationDto } from './business.dto';
import { CurrentUser } from '../common/decorators/custom.decorators';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('business')
@Controller('business')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class BusinessController {
    constructor(private businessService: BusinessService) {}

    @Post()
    @ApiOperation({ summary: 'ثبت کسب‌وکار (یک‌دقیقه‌ای)' })
    create(@CurrentUser() user: any, @Body() dto: CreateBusinessDto) {
        return this.businessService.create(user.id, dto);
    }

    @Get('my')
    @ApiOperation({ summary: 'کسب‌وکارهای من' })
    getMy(@CurrentUser() user: any) {
        return this.businessService.getMy(user.id);
    }

    @Get(':id')
    @ApiOperation({ summary: 'جزئیات کسب‌وکار (با کاتالوگ‌هایش)' })
    findOne(@Param('id') id: string, @CurrentUser() user: any) {
        return this.businessService.findOne(id, user.id);
    }

    @Put(':id')
    @ApiOperation({ summary: 'ویرایش کسب‌وکار' })
    update(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: UpdateBusinessDto) {
        return this.businessService.update(id, user.id, dto);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'حذف کسب‌وکار (فقط بدون کاتالوگ)' })
    remove(@Param('id') id: string, @CurrentUser() user: any) {
        return this.businessService.remove(id, user.id);
    }

    @Post(':id/attach-catalog/:catalogId')
    @ApiOperation({ summary: 'اتصال کاتالوگ به کسب‌وکار' })
    attachCatalog(
        @Param('id') id: string,
        @Param('catalogId') catalogId: string,
        @CurrentUser() user: any,
    ) {
        return this.businessService.attachCatalog(user.id, id, catalogId);
    }

    @Post(':id/verify')
    @ApiOperation({ summary: 'ارسال مدارک تیک اعتماد کسب‌وکار' })
    requestVerification(
        @Param('id') id: string,
        @CurrentUser() user: any,
        @Body() dto: RequestBusinessVerificationDto,
    ) {
        return this.businessService.requestVerification(id, user.id, dto);
    }

    @Get(':id/verify/status')
    @ApiOperation({ summary: 'وضعیت تیک اعتماد کسب‌وکار من' })
    getVerificationStatus(@Param('id') id: string, @CurrentUser() user: any) {
        return this.businessService.getMyVerification(id, user.id);
    }
}