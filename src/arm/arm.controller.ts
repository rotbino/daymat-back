// src/arm/arm.controller.ts
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
    ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ArmService } from './arm.service';
import { CreateArmDto } from './dto/create-arm.dto';
import { CurrentUser } from '../common/decorators/custom.decorators';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ArmManagerGuard } from '../common/guards/arm-manager.guard';
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard';
import {ArmAdminGuard} from "../common/guards/arm-admin.guard";
import {PrismaService} from "../prisma/prisma.service";
@ApiTags('arm')
@Controller('arm')
export class ArmController {
    // داخل کلاس ArmController
    constructor(
        private armService: ArmService,
        private prisma: PrismaService,   // ← اضافه کنید
    ) {}

    // ============================================================
    // 1. ایجاد بازاری جدید (فقط مدیران سیستم)
    // ============================================================
    @Post()
    @UseGuards(JwtAuthGuard, ArmManagerGuard) // ArmManagerGuard فقط نقش 'system_admin' یا 'arm_admin' را اجازه می‌دهد
    @ApiBearerAuth('access-token')
    @ApiOperation({
        summary: 'ایجاد بازاری جدید (فقط مدیران سیستم)',
        description: 'ایجاد یک بازاری تخصصی با تنظیمات کامل در config',
    })
    @ApiResponse({ status: 201, description: 'بازار با موفقیت ساخته شد' })
    @ApiResponse({ status: 400, description: 'داده‌های ورودی نامعتبر' })
    @ApiResponse({ status: 403, description: 'دسترسی غیرمجاز' })
    @ApiResponse({ status: 409, description: 'slug تکراری است' })
    async create(@CurrentUser() user: any, @Body() dto: CreateArmDto) {
        return this.armService.create(user.id, dto);
    }

    // ============================================================
    // 2. دریافت اطلاعات کامل بازار با slug (عمومی)
    // ============================================================
    @Get(':slug')
    @UseGuards(OptionalJwtAuthGuard) // ← این رو اضافه کن
    @ApiOperation({ summary: 'دریافت اطلاعات کامل بازار با slug' })
    @ApiResponse({ status: 200, description: 'اطلاعات بازار' })
    @ApiResponse({ status: 404, description: 'بازار یافت نشد' })
    async findBySlug(
        @Param('slug') slug: string,
        @CurrentUser() user?: any,
    ) {
        console.log('🔍 user from CurrentUser:', user);
        return this.armService.findBySlug(slug, user?.id);
    }

    // ============================================================
    // 3. دریافت آمار بازار (عمومی)
    // ============================================================
    @Get(':slug/stats')
    @ApiOperation({ summary: 'دریافت آمار بازار (تعداد اعضا و آگهی‌ها)' })
    @ApiResponse({ status: 200, description: 'آمار بازار' })
    @ApiResponse({ status: 404, description: 'بازار یافت نشد' })
    async getStats(@Param('slug') slug: string) {
        return this.armService.getStats(slug);
    }

    // ============================================================
    // 4. عضویت در بازار (نیاز به احراز هویت)
    // ============================================================
// src/arm/arm.controller.ts

    @Post(':slug/join')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'عضویت در بازار' })
    @ApiResponse({ status: 200, description: 'عضویت با موفقیت انجام شد' })
    @ApiResponse({ status: 400, description: 'قبلاً عضو هستید یا خطا در اعتبارسنجی' })
    @ApiResponse({ status: 404, description: 'بازار یافت نشد' })
    async join(
        @Param('slug') slug: string,
        @CurrentUser() user: any,
        @Body() body?: { roleType?: 'seller' | 'buyer'; businessId?: string }, // ✅ ? اضافه شد
    ) {
        return this.armService.join(
            user.id,
            slug,
            body?.roleType,    // ✅ optional chaining
            body?.businessId   // ✅ optional chaining
        );
    }

    // ============================================================
    // 5. خروج از بازار (نیاز به احراز هویت)
    // ============================================================
    @Delete(':slug/leave')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'خروج از بازار' })
    @ApiResponse({ status: 200, description: 'خروج با موفقیت انجام شد' })
    @ApiResponse({ status: 400, description: 'عضو نیستید' })
    @ApiResponse({ status: 404, description: 'بازار یافت نشد' })
    async leave(@Param('slug') slug: string, @CurrentUser() user: any) {
        return this.armService.leave(user.id, slug);
    }

    // ============================================================
    // 6. لیست بازارهای کاربر (نیاز به احراز هویت)
    // ============================================================
    @Get('user/my-arms')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'لیست بازارهایی که کاربر در آنها عضو است' })
    @ApiResponse({ status: 200, description: 'لیست بازارها' })
    async getUserArms(@CurrentUser() user: any) {
        return this.armService.getUserArms(user.id);
    }

    // ============================================================
    // 7. دریافت درخت دسته‌بندی بازار (از config) - عمومی
    // ============================================================
    @Get(':slug/categories')
    @ApiOperation({ summary: 'دریافت درخت دسته‌بندی بازار (از config)' })
    @ApiQuery({ name: 'nodeId', required: false, description: 'شناسه گره (اگر ارسال شود، فقط زیردرخت آن گره برگردانده می‌شود)' })
    @ApiResponse({ status: 200, description: 'درخت دسته‌بندی' })
    @ApiResponse({ status: 404, description: 'بازار یافت نشد' })
    async getArmCategoryTree(
        @Param('slug') slug: string,
        @Query('nodeId') nodeId?: string,
    ) {
        return this.armService.getArmCategoryTree(slug, nodeId);
    }

    // ============================================================
    // 8. دریافت درخت موقعیت‌های بازار (از config) - عمومی
    // ============================================================
    @Get(':slug/locations')
    @ApiOperation({ summary: 'دریافت درخت موقعیت‌های جغرافیایی بازار (از config)' })
    @ApiResponse({ status: 200, description: 'درخت موقعیت‌ها' })
    @ApiResponse({ status: 404, description: 'بازار یافت نشد' })
    async getArmLocations(@Param('slug') slug: string) {
        return this.armService.getArmLocationTree(slug);
    }

    // ============================================================
    // 9. به‌روزرسانی بازار (فقط مدیر بازار یا مدیر سیستم)
    // ============================================================
    @Put(':id')
    @UseGuards(JwtAuthGuard, ArmManagerGuard) // ArmManagerGuard فقط نقش 'system_admin' یا 'arm_admin' را اجازه می‌دهد، ولی در سرویس هم چک می‌شود
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'به‌روزرسانی بازار (فقط مدیر بازار یا مدیر سیستم)' })
    @ApiResponse({ status: 200, description: 'بازار با موفقیت به‌روزرسانی شد' })
    @ApiResponse({ status: 400, description: 'داده‌های ورودی نامعتبر' })
    @ApiResponse({ status: 403, description: 'دسترسی غیرمجاز' })
    @ApiResponse({ status: 404, description: 'بازار یافت نشد' })

    async updateArm(
        @Param('id') id: string,
        @CurrentUser() user: any,
        @Body() dto: Partial<CreateArmDto>,
    ) {
        return this.armService.updateArm(id, user.id, dto);
    }

    // ============================================================
    // 10. حذف بازار (فقط مدیر بازار یا مدیر سیستم) - Soft Delete
    // ============================================================
    @Delete(':id')
    @UseGuards(JwtAuthGuard, ArmManagerGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'حذف نرم بازار (فقط مدیر بازار یا مدیر سیستم)' })
    @ApiResponse({ status: 200, description: 'بازار با موفقیت حذف شد' })
    @ApiResponse({ status: 403, description: 'دسترسی غیرمجاز' })
    @ApiResponse({ status: 404, description: 'بازار یافت نشد' })
    async deleteArm(@Param('id') id: string, @CurrentUser() user: any) {
        return this.armService.deleteArm(id, user.id);
    }

    // ============================================================
    // 11. (فقط توسعه) حذف کامل بازار و تمام وابسته‌ها - Hard Delete
    // ============================================================
    @Delete(':id/hard')
    @UseGuards(JwtAuthGuard, ArmManagerGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({
        summary: '⚠️ حذف کامل بازار (فقط توسعه)',
        description: 'این متد تمام دیتاهای مرتبط با بازار را به طور کامل حذف می‌کند. فقط در محیط توسعه قابل استفاده است.',
    })
    @ApiResponse({ status: 200, description: 'بازار و تمام وابسته‌ها حذف شدند' })
    @ApiResponse({ status: 403, description: 'دسترسی غیرمجاز یا محیط تولید' })
    @ApiResponse({ status: 404, description: 'بازار یافت نشد' })
    async hardDelete(@Param('id') id: string, @CurrentUser() user: any) {
        if (process.env.NODE_ENV === 'production') {
            throw new ForbiddenException({
                errorCode: 'FORBIDDEN',
                message: 'این عملیات در محیط تولید غیرفعال است',
            });
        }
        return this.armService.hardDelete(id, user.id);
    }

    @Get('by-id/:id')
    @ApiOperation({ summary: 'دریافت بازار با id' })
    @UseGuards(JwtAuthGuard, ArmAdminGuard)
    async findById(@Param('id') id: string) {
        return this.armService.findById(id);
    }

    @Get('categories/flat')
    @UseGuards(JwtAuthGuard)   // فقط کاربر لاگین‌شده (می‌توانید OptionalJwtAuthGuard بگذارید)
    @ApiOperation({ summary: 'دریافت لیست تخت همه دسته‌بندی‌های فعال (عمومی)' })
    async getCategoriesFlat() {
        return this.prisma.productCategory.findMany({
            where: { isActive: true },
            orderBy: { path: 'asc' },
        });
    }
}