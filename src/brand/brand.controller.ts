// src/brand/brand.controller.ts
import { Body, Controller, Get, Param, Patch, Post, Delete, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { BrandService } from './brand.service';
import { CreateBrandDto, UpdateBrandDto } from './brand.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../common/decorators/custom.decorators';

@ApiTags('brand')
@Controller('brands')
export class BrandController {
    constructor(private brandService: BrandService) {}

    // ✅ جستجوی برند — با pagination
    // ✅ حداقل ۲ حرف برای سرچ
    // ✅ بدون سرچ: ۱۰ برند پراستفاده
    @Get('search')
    @UseGuards(OptionalJwtAuthGuard)
    @ApiOperation({ summary: 'جستجوی برند با pagination' })
    @ApiQuery({ name: 'q', required: false })
    @ApiQuery({ name: 'category', required: false })
    @ApiQuery({ name: 'page', required: false })
    @ApiQuery({ name: 'limit', required: false })
    async search(
        @Query('q') q?: string,
        @Query('category') category?: string,
        @Query('page') page = '1',
        @Query('limit') limit = '10',
    ) {
        return this.brandService.search({
            q,
            category,
            page: +page,
            limit: +limit,
        });
    }

    // ✅ ایجاد برند — نیاز به لاگین
    @Post()
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'ایجاد برند جدید (auto-create)' })
    async create(@CurrentUser() user: any, @Body() dto: CreateBrandDto) {
        return this.brandService.create(dto, user.id);
    }

    // ✅ به‌روزرسانی برند — فقط ادمین سیستم یا سازندهٔ برندِ تأییدنشده
    @Patch(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'به‌روزرسانی برند (ادمین یا سازندهٔ برندِ تأییدنشده)' })
    async update(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: UpdateBrandDto) {
        return this.brandService.update(id, dto, { id: user.id, role: user.role });
    }

    // ✅ حذف برند — فقط ادمین سیستم یا سازندهٔ برندِ تأییدنشده
    @Delete(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'حذف برند (ادمین یا سازندهٔ برندِ تأییدنشده)' })
    async delete(@CurrentUser() user: any, @Param('id') id: string) {
        return this.brandService.delete(id, { id: user.id, role: user.role });
    }
}
