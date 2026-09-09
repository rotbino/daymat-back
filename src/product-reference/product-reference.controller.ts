// src/product-reference/product-reference.controller.ts
import { Body, Controller, Get, Param, Patch, Put, Post, Delete, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { ProductReferenceService } from './product-reference.service';
import { CreateProductDto, UpdateProductDto } from './product-reference.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard';
import { AdminGuard } from '../admin/guards/admin.guard';
import { CurrentUser } from '../common/decorators/custom.decorators';

@ApiTags('product-reference')
@Controller('products')
export class ProductReferenceController {
    constructor(private productService: ProductReferenceService) {}

    // ✅ جستجوی کالا — public (با optional auth)
    // ✅ pagination: page + limit (پیش‌فرض ۱۰)
    // ✅ mine: فقط کالاهای خود کاربر
    @Get('search')
    @UseGuards(OptionalJwtAuthGuard)
    @ApiOperation({ summary: 'جستجوی کالای مرجع با pagination' })
    @ApiQuery({ name: 'q', required: false })
    @ApiQuery({ name: 'category', required: false })
    @ApiQuery({ name: 'page', required: false })
    @ApiQuery({ name: 'limit', required: false })
    @ApiQuery({ name: 'mine', required: false, type: Boolean })
    async search(
        @Query('q') q?: string,
        @Query('category') category?: string,
        @Query('page') page = '1',
        @Query('limit') limit = '10',
        @Query('mine') mine?: string,
        @CurrentUser() user?: any,
    ) {
        return this.productService.search({
            q,
            category,
            page: +page,
            limit: +limit,
            mine: mine === 'true',
            userId: user?.id,
        });
    }

    // ✅ ایجاد کالای جدید — نیاز به لاگین
    @Post()
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'ایجاد کالای مرجع جدید (auto-create)' })
    async create(@CurrentUser() user: any, @Body() dto: CreateProductDto) {
        return this.productService.create(dto, user.id);
    }

    // ✅ به‌روزرسانی کالا — فقط سازنده + فقط isNew
    @Put(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'ویرایش کالای مرجع (فقط سازنده + فقط isNew)' })
    async update(@Param('id') id: string, @Body() dto: UpdateProductDto, @CurrentUser() user: any) {
        return this.productService.update(id, dto, user.id);
    }

    // ✅ admin update (بدون محدودیت isNew) — با PATCH — فقط ادمین سیستم
    @Patch(':id')
    @UseGuards(JwtAuthGuard, AdminGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'ویرایش کالا توسط ادمین سیستم' })
    async adminUpdate(@Param('id') id: string, @Body() dto: UpdateProductDto) {
        return this.productService.update(id, dto);
    }

    // ✅ حذف کالا — فقط سازنده + فقط isNew + فقط اگه استفاده نشده
    @Delete(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'حذف کالای مرجع (فقط سازنده + فقط isNew)' })
    async delete(@Param('id') id: string, @CurrentUser() user: any) {
        return this.productService.delete(id, user.id);
    }
}
