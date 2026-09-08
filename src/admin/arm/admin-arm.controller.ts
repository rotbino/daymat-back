// src/admin/arm/admin-arm.controller.ts
import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminArmService } from './admin-arm.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../guards/admin.guard';

@ApiTags('admin/arms')
@Controller('admin/arms')
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiBearerAuth('access-token')
export class AdminArmController {
    constructor(private adminArmService: AdminArmService) {}

    @Get()
    @ApiOperation({ summary: 'دریافت لیست بازارها (ادمین)' })
    async getArmsList(@Query() query: any) {
        return this.adminArmService.getArmsList(query);
    }

    @Get('stats')
    @ApiOperation({ summary: 'دریافت آمار کلی بازارها' })
    async getStats() {
        return this.adminArmService.getStats();
    }

    @Get(':id')
    @ApiOperation({ summary: 'دریافت یک بازار با id (ادمین)' })
    async getArmById(@Param('id') id: string) {
        return this.adminArmService.getArmById(id);
    }

    @Put(':id')
    @ApiOperation({ summary: 'به‌روزرسانی بازار (ادمین)' })
    async updateArm(@Param('id') id: string, @Body() data: any) {
        return this.adminArmService.updateArm(id, data);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'حذف نرم بازار (ادمین)' })
    async deleteArm(@Param('id') id: string) {
        return this.adminArmService.deleteArm(id);
    }

    @Get('dashboard/stats')  // ✅ مسیر جدید برای آمار داشبورد
    @ApiOperation({ summary: 'دریافت آمار کامل داشبورد ادمین' })
    async getDashboardStats() {
        return this.adminArmService.getDashboardStats();
    }


}