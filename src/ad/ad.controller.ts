// src/ad/ad.controller.ts
import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Body,
    Param,
    Query,
    UseGuards,
    BadRequestException,
} from '@nestjs/common';
import {
    ApiTags,
    ApiOperation,
    ApiResponse,
    ApiBearerAuth,
} from '@nestjs/swagger';
import { ObjectId } from 'mongodb';
import { AdService } from './ad.service';
import {
    CreateAdDto,
    UpdateAdDto,
    AdListQueryDto,
    ExtendAdDto,
} from './ad.dto';
import { CurrentUser } from '../common/decorators/custom.decorators';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('ad')
@Controller('ad')
export class AdController {
    constructor(
        private adService: AdService,
        private prisma: PrismaService,
    ) {}

    // ============================================================
    // 1. ثبت آگهی جدید
    // ============================================================
    @Post()
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'ثبت آگهی قیمت جدید' })
    async create(@CurrentUser() user: any, @Body() dto: CreateAdDto) {
        return this.adService.create(user.id, dto);
    }

    // ============================================================
    // 2. تابلوی قیمت (ویترین زنده)
    // ============================================================
    @Get('arm/:slug')
    @ApiOperation({ summary: 'تابلوی قیمت (ویترین زنده)' })
    async getVitrine(@Param('slug') slug: string, @Query() query: AdListQueryDto) {
        return this.adService.getVitrine(slug, query);
    }

    // ============================================================
    // 3. لیست آگهی‌های یک کسب‌وکار
    // ============================================================
    @Get('business/:businessId')
    @UseGuards(OptionalJwtAuthGuard)
    @ApiOperation({ summary: 'لیست آگهی‌های یک کسب‌وکار' })
    async getBusinessAds(@Param('businessId') businessId: string) {
        return this.adService.getBusinessAds(businessId);
    }

    // ============================================================
    // 4. ویرایش آگهی
    // ============================================================
    @Put(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'ویرایش آگهی' })
    async update(
        @Param('id') id: string,
        @CurrentUser() user: any,
        @Body() dto: UpdateAdDto,
    ) {
        if (!ObjectId.isValid(id)) {
            throw new BadRequestException({ errorCode: 'INVALID_AD_ID', message: 'شناسه آگهی نامعتبر است' });
        }
        return this.adService.update(id, user.id, dto);
    }

    // ============================================================
    // 5. تمدید آگهی
    // ============================================================
    @Post(':id/extend')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'تمدید آگهی' })
    async extend(
        @Param('id') id: string,
        @CurrentUser() user: any,
        @Body() dto: ExtendAdDto,
    ) {
        if (!ObjectId.isValid(id)) {
            throw new BadRequestException({ errorCode: 'INVALID_AD_ID', message: 'شناسه آگهی نامعتبر است' });
        }
        return this.adService.extend(id, user.id, dto);
    }

    // ============================================================
    // 6. حذف آگهی
    // ============================================================
    @Delete(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'حذف آگهی' })
    async remove(@Param('id') id: string, @CurrentUser() user: any) {
        if (!ObjectId.isValid(id)) {
            throw new BadRequestException({ errorCode: 'INVALID_AD_ID', message: 'شناسه آگهی نامعتبر است' });
        }
        return this.adService.remove(id, user.id);
    }

    // ============================================================
    // 7. نردبان
    // ============================================================
    @Post(':id/bump')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'نردبان آگهی' })
    async bump(@Param('id') id: string, @CurrentUser() user: any) {
        if (!ObjectId.isValid(id)) {
            throw new BadRequestException({ errorCode: 'INVALID_AD_ID', message: 'شناسه آگهی نامعتبر است' });
        }
        return this.adService.bump(id, user.id);
    }

    // ============================================================
    // 8. تاریخچه قیمت
    // ============================================================
    @Get(':id/price-history')
    @ApiOperation({ summary: 'تاریخچه قیمت آگهی' })
    async getPriceHistory(@Param('id') id: string, @CurrentUser() user?: any) {
        if (!ObjectId.isValid(id)) {
            throw new BadRequestException({ errorCode: 'INVALID_AD_ID', message: 'شناسه آگهی نامعتبر است' });
        }
        return this.adService.getPriceHistory(id, user?.id);
    }

    // ============================================================
    // 9. دریافت شماره تماس
    // ============================================================
    @Get(':id/contact')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'دریافت شماره تماس آگهی' })
    async getContactInfo(@Param('id') id: string, @CurrentUser() user: any) {
        if (!ObjectId.isValid(id)) {
            throw new BadRequestException({ errorCode: 'INVALID_AD_ID', message: 'شناسه آگهی نامعتبر است' });
        }
        return this.adService.getContactInfo(id, user.id);
    }

    // ============================================================
    // 10. به‌روزرسانی گروهی
    // ============================================================
    @Put('bulk-update')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'به‌روزرسانی گروهی قیمت' })
    async bulkUpdate(
        @CurrentUser() user: any,
        @Body() dto: { updates: { id: string; unitPrice: number }[] },
    ) {
        return this.adService.bulkUpdate(user.id, dto.updates);
    }

    // ============================================================
    // 11. آگهی‌های ذخیره‌شده
    // ============================================================
    @Get('saved')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'لیست آگهی‌های ذخیره‌شده' })
    async getSavedAds(@CurrentUser() user: any) {
        const savedInteractions = await this.prisma.adInteraction.findMany({
            where: { userId: user.id, type: 'save' },
            include: {
                ad: {
                    include: {
                        unit: { select: { id: true, title: true, shortCode: true } },
                        files: {
                            where: { relatedModel: 'Ad' },
                            select: { id: true, path: true, thumbnailPath: true },
                        },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        return savedInteractions.map((item: any) => item.ad);
    }

    // ============================================================
    // 12. جزئیات کامل آگهی
    // ============================================================
    @Get(':id/detail')
    @ApiOperation({ summary: 'جزئیات کامل آگهی' })
    async getAdDetail(@Param('id') id: string) {
        if (!ObjectId.isValid(id)) {
            throw new BadRequestException({ errorCode: 'INVALID_AD_ID', message: 'شناسه آگهی نامعتبر است' });
        }
        return this.adService.findOne(id);
    }

    // ============================================================
    // 13. جزئیات ساده آگهی
    // ============================================================
    @Get(':id')
    @ApiOperation({ summary: 'جزئیات ساده آگهی' })
    async findOne(@Param('id') id: string) {
        if (!ObjectId.isValid(id)) {
            throw new BadRequestException({ errorCode: 'INVALID_AD_ID', message: 'شناسه آگهی نامعتبر است' });
        }
        return this.adService.findOne(id);
    }

    // ============================================================
    // 14. ثبت تعامل
    // ============================================================
    @Post(':id/interact')
    @UseGuards(OptionalJwtAuthGuard)
    @ApiOperation({ summary: 'ثبت تعامل کاربر' })
    async interact(
        @Param('id') id: string,
        @CurrentUser() user: any,
        @Body() body: { type: 'view' | 'save' | 'call' | 'comment' | 'share'; metadata?: any },
    ) {
        if (!ObjectId.isValid(id)) {
            throw new BadRequestException({ errorCode: 'INVALID_AD_ID', message: 'شناسه آگهی نامعتبر است' });
        }
        // ✅ اصلاح ترتیب پارامترها
        return this.adService.trackInteraction(
            id,  // adId
            user?.id || null,  // userId
            body.type,
            { ...body.metadata, sessionId: user?.id ? null : 'anonymous-session' },
        );
    }

    // ============================================================
    // 15. آمار تعاملات
    // ============================================================
    @Get(':id/stats')
    @ApiOperation({ summary: 'آمار تعاملات آگهی' })
    async getAdStats(@Param('id') id: string) {
        if (!ObjectId.isValid(id)) {
            throw new BadRequestException({ errorCode: 'INVALID_AD_ID', message: 'شناسه آگهی نامعتبر است' });
        }
        return this.adService.getAdStats(id);
    }

    // ============================================================
    // 16. بوکمارک آگهی
    // ============================================================
    @Post(':id/save')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'ذخیره آگهی' })
    async saveAd(@Param('id') id: string, @CurrentUser() user: any) {
        if (!ObjectId.isValid(id)) {
            throw new BadRequestException({ errorCode: 'INVALID_AD_ID', message: 'شناسه آگهی نامعتبر است' });
        }
        // ✅ اصلاح ترتیب پارامترها: adId اول، userId دوم
        return this.adService.trackInteraction(id, user.id, 'save');
    }

    // ============================================================
    // 17. حذف از ذخیره‌ها
    // ============================================================
    @Delete(':id/save')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'حذف از ذخیره‌ها' })
    async unsaveAd(@Param('id') id: string, @CurrentUser() user: any) {
        if (!ObjectId.isValid(id)) {
            throw new BadRequestException({ errorCode: 'INVALID_AD_ID', message: 'شناسه آگهی نامعتبر است' });
        }
        await this.prisma.adInteraction.deleteMany({
            where: { adId: id, userId: user.id, type: 'save' },
        });
        return { success: true, message: 'آگهی از لیست ذخیره‌ها حذف شد' };
    }

    @Get(':id/saved-status')
    @UseGuards(OptionalJwtAuthGuard)
    @ApiOperation({ summary: 'بررسی وضعیت ذخیره آگهی' })
    async isSaved(@Param('id') id: string, @CurrentUser() user: any) {
        if (!ObjectId.isValid(id)) {
            throw new BadRequestException({ errorCode: 'INVALID_AD_ID', message: 'شناسه آگهی نامعتبر است' });
        }
        return this.adService.isAdSaved(id, user?.id || null);
    }
}