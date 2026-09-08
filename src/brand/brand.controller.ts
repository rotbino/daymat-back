// src/brand/brand.controller.ts
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
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

    // ✅ جستجوی برند — public (با optional auth)
    @Get('search')
    @UseGuards(OptionalJwtAuthGuard)
    @ApiOperation({ summary: 'جستجوی برند برای autocomplete' })
    @ApiQuery({ name: 'q', required: true })
    @ApiQuery({ name: 'category', required: false })
    @ApiQuery({ name: 'limit', required: false })
    async search(
        @Query('q') q: string,
        @Query('category') category?: string,
        @Query('limit') limit = '20',
    ) {
        return this.brandService.search(q, category, +limit);
    }

    // ✅ ایجاد برند — نیاز به لاگین
    @Post()
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'ایجاد برند جدید (auto-create)' })
    async create(@CurrentUser() user: any, @Body() dto: CreateBrandDto) {
        return this.brandService.create(dto, user.id);
    }

    // ✅ به‌روزرسانی برند — فعلا برای ادمین
    @Patch(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'به‌روزرسانی برند' })
    async update(@Param('id') id: string, @Body() dto: UpdateBrandDto) {
        return this.brandService.update(id, dto);
    }
}
