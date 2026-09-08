// src/admin/location/admin-location.controller.ts
import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminLocationService } from './admin-location.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ArmManagerGuard } from '../../common/guards/arm-manager.guard';
import { ArmAdminOrOwnerReadGuard } from '../../common/guards/arm-admin-or-owner-read.guard';

@ApiTags('admin/locations')
@Controller('admin/locations')
@ApiBearerAuth('access-token')
export class AdminLocationController {
    constructor(private locationService: AdminLocationService) {}

    // ✅ عملیات خواندنی - هم ادمین و هم مالک (فقط مشاهده)
    @Get('countries')
    @UseGuards(JwtAuthGuard, ArmAdminOrOwnerReadGuard)
    @ApiOperation({ summary: 'لیست کشورها' })
    async getCountries() { return this.locationService.getCountries(); }

    @Get('tree')
    @UseGuards(JwtAuthGuard, ArmAdminOrOwnerReadGuard)
    @ApiOperation({ summary: 'درخت کامل' })
    async getTree() { return this.locationService.getTree(); }

    @Get('flat')
    @UseGuards(JwtAuthGuard, ArmAdminOrOwnerReadGuard)
    @ApiOperation({ summary: 'لیست مسطح' })
    async getFlat() { return this.locationService.getFlat(); }

    @Get(':id')
    @UseGuards(JwtAuthGuard, ArmAdminOrOwnerReadGuard)
    @ApiOperation({ summary: 'یک موقعیت' })
    async getOne(@Param('id') id: string) { return this.locationService.getOne(id); }

    @Get(':id/children')
    @UseGuards(JwtAuthGuard, ArmAdminOrOwnerReadGuard)
    @ApiOperation({ summary: 'زیرمجموعه‌ها' })
    async getChildren(@Param('id') id: string) { return this.locationService.getChildren(id); }

    // ❌ عملیات نوشتاری - فقط ادمین سیستم
    @Post()
    @UseGuards(JwtAuthGuard, ArmManagerGuard)
    @ApiOperation({ summary: 'ایجاد موقعیت جدید' })
    async create(@Body() dto: any) { return this.locationService.create(dto); }

    @Put(':id')
    @UseGuards(JwtAuthGuard, ArmManagerGuard)
    @ApiOperation({ summary: 'ویرایش موقعیت' })
    async update(@Param('id') id: string, @Body() dto: any) { return this.locationService.update(id, dto); }

    @Delete(':id')
    @UseGuards(JwtAuthGuard, ArmManagerGuard)
    @ApiOperation({ summary: 'حذف موقعیت' })
    async remove(@Param('id') id: string) { return this.locationService.remove(id); }
}