// src/product-reference/product-reference.controller.ts
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { ProductReferenceService } from './product-reference.service';
import { CreateProductDto, UpdateProductDto } from './product-reference.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../common/decorators/custom.decorators';

@ApiTags('product-reference')
@Controller('products')
export class ProductReferenceController {
    constructor(private productService: ProductReferenceService) {}

    // ✅ جستجوی کالا — public
    @Get('search')
    @UseGuards(OptionalJwtAuthGuard)
    @ApiOperation({ summary: 'جستجوی کالای مرجع برای autocomplete' })
    @ApiQuery({ name: 'q', required: true })
    @ApiQuery({ name: 'category', required: false })
    @ApiQuery({ name: 'limit', required: false })
    async search(
        @Query('q') q: string,
        @Query('category') category?: string,
        @Query('limit') limit = '20',
    ) {
        return this.productService.search(q, category, +limit);
    }

    // ✅ لیست همه‌ی کالاها — برای DropSelector با search client-side
    @Get('list')
    @UseGuards(OptionalJwtAuthGuard)
    @ApiOperation({ summary: 'لیست همه‌ی کالاها برای DropSelector' })
    @ApiQuery({ name: 'category', required: false })
    @ApiQuery({ name: 'confirmed', required: false, type: Boolean })
    async list(
        @Query('category') category?: string,
        @Query('confirmed') confirmed?: string,
    ) {
        return this.productService.listForSelector(category, confirmed === 'true');
    }

    // ✅ ایجاد کالای جدید — نیاز به لاگین
    @Post()
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'ایجاد کالای مرجع جدید (auto-create)' })
    async create(@CurrentUser() user: any, @Body() dto: CreateProductDto) {
        return this.productService.create(dto, user.id);
    }

    // ✅ به‌روزرسانی کالا
    @Patch(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'به‌روزرسانی کالای مرجع' })
    async update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
        return this.productService.update(id, dto);
    }
}
