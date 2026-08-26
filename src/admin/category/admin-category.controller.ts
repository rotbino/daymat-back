// src/admin/category/admin-category.controller.ts
import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AdminCategoryService } from './admin-category.service';
import { CreateCategoryDto, UpdateCategoryDto } from './admin-category.dto';
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { ArmManagerGuard } from '../../common/guards/arm-manager.guard';
import { ArmAdminOrOwnerReadGuard } from '../../common/guards/arm-admin-or-owner-read.guard';

@ApiTags('admin/categories')
@Controller('admin/categories')
@ApiBearerAuth('access-token')
export class AdminCategoryController {
    constructor(private categoryService: AdminCategoryService) {}

    // ❌ عملیات ایجاد - فقط ادمین سیستم
    @Post()
    @UseGuards(JwtAuthGuard, ArmManagerGuard)
    @ApiOperation({ summary: 'ایجاد دسته‌بندی جدید (فقط ادمین)' })
    create(@Body() dto: CreateCategoryDto) {
        return this.categoryService.create(dto);
    }

    // ✅ دریافت دسته‌بندی‌ها (ساختار درختی) - هم ادمین و هم مالک (فقط مشاهده)
    @Get()
    @UseGuards(JwtAuthGuard, ArmAdminOrOwnerReadGuard)
    @ApiOperation({ summary: 'لیست همه دسته‌بندی‌ها (ساختار درختی)' })
    findAll() {
        return this.categoryService.findAll();
    }

    // ✅ دریافت دسته‌بندی‌ها (مسطح) - هم ادمین و هم مالک (فقط مشاهده)
    @Get('flat')
    @UseGuards(JwtAuthGuard, ArmAdminOrOwnerReadGuard)
    @ApiOperation({ summary: 'لیست همه دسته‌بندی‌ها (مسطح)' })
    @ApiQuery({ name: 'slug', required: false, description: 'شناسه بازار (برای مالک بازار)' })
    findAllFlat(@Query('slug') slug?: string) {
        return this.categoryService.findAllFlat();
    }

    // ✅ دریافت یک دسته‌بندی - هم ادمین و هم مالک (فقط مشاهده)
    @Get(':id')
    @UseGuards(JwtAuthGuard, ArmAdminOrOwnerReadGuard)
    @ApiOperation({ summary: 'دریافت یک دسته‌بندی' })
    findOne(@Param('id') id: string) {
        return this.categoryService.findOne(id);
    }

    // ✅ دریافت زیرمجموعه‌های یک دسته‌بندی - هم ادمین و هم مالک (فقط مشاهده)
    @Get(':id/children')
    @UseGuards(JwtAuthGuard, ArmAdminOrOwnerReadGuard)
    getChildren(@Param('id') id: string) {
        return this.categoryService.getChildren(id);
    }

    // ✅ دریافت مسیر کامل یک دسته‌بندی
    @Get(':id/path')
    @UseGuards(JwtAuthGuard, ArmAdminOrOwnerReadGuard)
    getPath(@Param('id') id: string) {
        return this.categoryService.getPath(id);
    }

    // ❌ ویرایش دسته‌بندی - فقط ادمین سیستم
    @Put(':id')
    @UseGuards(JwtAuthGuard, ArmManagerGuard)
    update(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
        return this.categoryService.update(id, dto);
    }

    // ❌ حذف دسته‌بندی - فقط ادمین سیستم
    @Delete(':id')
    @UseGuards(JwtAuthGuard, ArmManagerGuard)
    remove(@Param('id') id: string) {
        return this.categoryService.remove(id);
    }
}