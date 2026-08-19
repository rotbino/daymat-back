// src/ad/ad.controller.ts (نسخه نهایی با اعتبارسنجی)
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
import { ObjectId } from 'mongodb'; // یا 'bson'
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
    @ApiResponse({ status: 201, description: 'آگهی با موفقیت ثبت شد' })
    @ApiResponse({ status: 400, description: 'خطا در داده‌ها' })
    @ApiResponse({ status: 403, description: 'عضویت در بازار ندارید' })
    async create(@CurrentUser() user: any, @Body() dto: CreateAdDto) {
        return this.adService.create(user.id, dto);
    }

    // ============================================================
    // 2. تابلوی قیمت (ویترین زنده)
    // ============================================================
    @Get('arm/:slug')
    @ApiOperation({ summary: 'تابلوی قیمت (ویترین زنده)' })
    @ApiResponse({ status: 200, description: 'لیست آگهی‌ها' })
    @ApiResponse({ status: 404, description: 'بازار یافت نشد' })
    async getVitrine(@Param('slug') slug: string, @Query() query: AdListQueryDto) {
        return this.adService.getVitrine(slug, query);
    }

    // ============================================================
    // 3. لیست آگهی‌های یک کسب‌وکار (عمومی)
    // ============================================================
    @Get('business/:businessId')
    @UseGuards(OptionalJwtAuthGuard)
    @ApiOperation({ summary: 'لیست آگهی‌های یک کسب‌وکار' })
    @ApiResponse({ status: 200, description: 'لیست آگهی‌ها' })
    async getBusinessAds(@Param('businessId') businessId: string) {
        return this.adService.getBusinessAds(businessId);
    }

    // ============================================================
    // 4. ویرایش آگهی
    // ============================================================
    @Put(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'ویرایش آگهی (قیمت، توضیحات، اعتبار)' })
    @ApiResponse({ status: 200, description: 'آگهی با موفقیت ویرایش شد' })
    @ApiResponse({ status: 403, description: 'دسترسی غیرمجاز' })
    @ApiResponse({ status: 404, description: 'آگهی یافت نشد' })
    async update(
        @Param('id') id: string,
        @CurrentUser() user: any,
        @Body() dto: UpdateAdDto,
    ) {
        // ✅ اعتبارسنجی شناسه
        if (!ObjectId.isValid(id)) {
            throw new BadRequestException({
                errorCode: 'INVALID_AD_ID',
                message: 'شناسه آگهی نامعتبر است',
            });
        }
        return this.adService.update(id, user.id, dto);
    }

    // ============================================================
    // 5. تمدید آگهی
    // ============================================================
    @Post(':id/extend')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'تمدید آگهی (با همان قیمت)' })
    @ApiResponse({ status: 200, description: 'آگهی با موفقیت تمدید شد' })
    @ApiResponse({ status: 403, description: 'دسترسی غیرمجاز' })
    @ApiResponse({ status: 404, description: 'آگهی یافت نشد' })
    async extend(
        @Param('id') id: string,
        @CurrentUser() user: any,
        @Body() dto: ExtendAdDto,
    ) {
        if (!ObjectId.isValid(id)) {
            throw new BadRequestException({
                errorCode: 'INVALID_AD_ID',
                message: 'شناسه آگهی نامعتبر است',
            });
        }
        return this.adService.extend(id, user.id, dto);
    }

    // ============================================================
    // 6. حذف آگهی
    // ============================================================
    @Delete(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'حذف آگهی (soft delete)' })
    @ApiResponse({ status: 200, description: 'آگهی با موفقیت حذف شد' })
    @ApiResponse({ status: 403, description: 'دسترسی غیرمجاز' })
    @ApiResponse({ status: 404, description: 'آگهی یافت نشد' })
    async remove(@Param('id') id: string, @CurrentUser() user: any) {
        if (!ObjectId.isValid(id)) {
            throw new BadRequestException({
                errorCode: 'INVALID_AD_ID',
                message: 'شناسه آگهی نامعتبر است',
            });
        }
        return this.adService.remove(id, user.id);
    }

    // ============================================================
    // 7. نردبان (Bump)
    // ============================================================
    @Post(':id/bump')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'نردبان (ارتقا آگهی)' })
    @ApiResponse({ status: 200, description: 'نردبان با موفقیت انجام شد' })
    @ApiResponse({ status: 400, description: 'اعتبار کافی نیست' })
    @ApiResponse({ status: 403, description: 'دسترسی غیرمجاز' })
    @ApiResponse({ status: 404, description: 'آگهی یافت نشد' })
    async bump(@Param('id') id: string, @CurrentUser() user: any) {
        if (!ObjectId.isValid(id)) {
            throw new BadRequestException({
                errorCode: 'INVALID_AD_ID',
                message: 'شناسه آگهی نامعتبر است',
            });
        }
        return this.adService.bump(id, user.id);
    }

    // ============================================================
    // 8. تاریخچه قیمت آگهی
    // ============================================================
    @Get(':id/price-history')
    @ApiOperation({ summary: 'تاریخچه تغییرات قیمت آگهی' })
    @ApiResponse({ status: 200, description: 'تاریخچه قیمت' })
    @ApiResponse({ status: 404, description: 'آگهی یافت نشد' })
    async getPriceHistory(@Param('id') id: string, @CurrentUser() user?: any) {
        if (!ObjectId.isValid(id)) {
            throw new BadRequestException({
                errorCode: 'INVALID_AD_ID',
                message: 'شناسه آگهی نامعتبر است',
            });
        }
        return this.adService.getPriceHistory(id, user?.id);
    }

    // ============================================================
    // 9. دریافت شماره تماس آگهی (با محدودیت روزانه)
    // ============================================================
    @Get(':id/contact')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'دریافت شماره تماس آگهی (با محدودیت روزانه)' })
    @ApiResponse({ status: 200, description: 'شماره تماس با موفقیت دریافت شد' })
    @ApiResponse({ status: 400, description: 'محدودیت تماس روزانه تکمیل شده است' })
    @ApiResponse({ status: 403, description: 'دسترسی غیرمجاز' })
    @ApiResponse({ status: 404, description: 'آگهی یافت نشد' })
    async getContactInfo(@Param('id') id: string, @CurrentUser() user: any) {
        if (!ObjectId.isValid(id)) {
            throw new BadRequestException({
                errorCode: 'INVALID_AD_ID',
                message: 'شناسه آگهی نامعتبر است',
            });
        }
        return this.adService.getContactInfo(id, user.id);
    }

    // ============================================================
    // 10. به‌روزرسانی گروهی قیمت آگهی‌ها
    // ============================================================
    @Put('bulk-update')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'به‌روزرسانی گروهی قیمت آگهی‌ها' })
    async bulkUpdate(
        @CurrentUser() user: any,
        @Body() dto: { updates: { id: string; unitPrice: number }[] },
    ) {
        return this.adService.bulkUpdate(user.id, dto.updates);
    }

    // ============================================================
    // ✅ 11. لیست آگهی‌های ذخیره‌شده کاربر (باید پیش از :id باشد)
    // ============================================================
    @Get('saved')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'دریافت لیست آگهی‌های ذخیره‌شده کاربر' })
    async getSavedAds(@CurrentUser() user: any) {
        // اگر متد مربوطه در سرویس وجود دارد، صدا بزنید؛ در غیر این صورت از طریق prisma پیاده‌سازی کنید
        // مثال: return this.adService.getSavedAds(user.id);
        // فعلاً یک پیاده‌سازی ساده برگردانید
        const savedInteractions = await this.prisma.adInteraction.findMany({
            where: {
                userId: user.id,
                type: 'save',
            },
            include: {
                ad: {
                    include: {
                        category: { select: { id: true, title: true } },
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
    // 12. جزئیات کامل آگهی (صفحه جزئیات)
    // ============================================================
    @Get(':id/detail')
    @ApiOperation({ summary: 'دریافت جزئیات کامل آگهی با تمام اطلاعات مرتبط' })
    @ApiResponse({ status: 200, description: 'جزئیات کامل آگهی' })
    @ApiResponse({ status: 404, description: 'آگهی یافت نشد' })
    async getAdDetail(@Param('id') id: string) {
        if (!ObjectId.isValid(id)) {
            throw new BadRequestException({
                errorCode: 'INVALID_AD_ID',
                message: 'شناسه آگهی نامعتبر است',
            });
        }
        return this.adService.findOne(id);
    }

    // ============================================================
    // 13. جزئیات ساده آگهی (برای نمایش در لیست)
    // ============================================================
    @Get(':id')
    @ApiOperation({ summary: 'دریافت جزئیات ساده آگهی' })
    @ApiResponse({ status: 200, description: 'جزئیات آگهی' })
    @ApiResponse({ status: 404, description: 'آگهی یافت نشد' })
    async findOne(@Param('id') id: string) {
        if (!ObjectId.isValid(id)) {
            throw new BadRequestException({
                errorCode: 'INVALID_AD_ID',
                message: 'شناسه آگهی نامعتبر است',
            });
        }
        return this.adService.findOne(id);
    }

    // ============================================================
    // 14. ثبت تعامل (بازدید، ذخیره، تماس، کامنت، اشتراک)
    // ============================================================
    @Post(':id/interact')
    @UseGuards(OptionalJwtAuthGuard)
    @ApiOperation({ summary: 'ثبت تعامل کاربر با آگهی (بازدید، ذخیره، تماس، کامنت، اشتراک)' })
    async interact(
        @Param('id') id: string,
        @CurrentUser() user: any,
        @Body() body: { type: 'view' | 'save' | 'call' | 'comment' | 'share'; metadata?: any },
    ) {
        if (!ObjectId.isValid(id)) {
            throw new BadRequestException({
                errorCode: 'INVALID_AD_ID',
                message: 'شناسه آگهی نامعتبر است',
            });
        }
        return this.adService.trackInteraction(
            id,
            user?.id || null,
            body.type,
            { ...body.metadata, sessionId: user?.id ? null : 'anonymous-session' },
        );
    }

    // ============================================================
    // 15. دریافت آمار تعاملات آگهی (نسخه کامل شده با جزئیات)
    // ============================================================
    @Get(':id/stats')
    @ApiOperation({ summary: 'دریافت آمار تعاملات آگهی (بازدیدها، ذخیره‌ها، تماس‌ها + جزئیات کاربران)' })
    async getAdStats(@Param('id') id: string) {
        if (!ObjectId.isValid(id)) {
            throw new BadRequestException({
                errorCode: 'INVALID_AD_ID',
                message: 'شناسه آگهی نامعتبر است',
            });
        }
        return this.adService.getAdStats(id);
    }

    // ============================================================
    // 16. ذخیره آگهی (bookmark)
    // ============================================================
    @Post(':id/save')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'ذخیره کردن آگهی در لیست علاقه‌مندی‌ها' })
    async saveAd(@Param('id') id: string, @CurrentUser() user: any) {
        if (!ObjectId.isValid(id)) {
            throw new BadRequestException({
                errorCode: 'INVALID_AD_ID',
                message: 'شناسه آگهی نامعتبر است',
            });
        }
        return this.adService.trackInteraction(user.id, id, 'save');
    }

    // ============================================================
    // 17. حذف از لیست ذخیره‌ها
    // ============================================================
    @Delete(':id/save')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'حذف آگهی از لیست علاقه‌مندی‌ها' })
    async unsaveAd(@Param('id') id: string, @CurrentUser() user: any) {
        if (!ObjectId.isValid(id)) {
            throw new BadRequestException({
                errorCode: 'INVALID_AD_ID',
                message: 'شناسه آگهی نامعتبر است',
            });
        }
        await this.prisma.adInteraction.deleteMany({
            where: {
                adId: id,
                userId: user.id,
                type: 'save',
            },
        });
        return { success: true, message: 'آگهی از لیست ذخیره‌ها حذف شد' };
    }
}