// src/admin/activity/admin-activity.controller.ts
import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminActivityService } from './admin-activity.service';
import { CreateActivityDto, UpdateActivityDto } from './admin-activity.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../guards/admin.guard';

@ApiTags('admin/activities')
@Controller('admin/activities')
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiBearerAuth('access-token')
export class AdminActivityController {
    constructor(private activityService: AdminActivityService) {}

    @Get('leaves')
    @ApiOperation({ summary: 'دریافت لیست فعالیت‌های برگ' })
    async getLeaves() { return this.activityService.getLeaves(); }

    @Get('tree')
    @ApiOperation({ summary: 'دریافت درخت کامل' })
    async getTree() { return this.activityService.getTree(); }

    @Get()
    @ApiOperation({ summary: 'دریافت همه (مسطح)' })
    async getAll() { return this.activityService.getAll(); }

    @Get(':id')
    @ApiOperation({ summary: 'دریافت یک فعالیت' })
    async getOne(@Param('id') id: string) { return this.activityService.getOne(id); }

    @Get(':id/children')
    @ApiOperation({ summary: 'دریافت زیرمجموعه‌ها' })
    async getChildren(@Param('id') id: string) { return this.activityService.getChildren(id); }

    @Get(':id/path')
    @ApiOperation({ summary: 'دریافت مسیر' })
    async getPath(@Param('id') id: string) { return this.activityService.getPath(id); }

    // 🆕
    @Post()
    @ApiOperation({ summary: 'ایجاد فعالیت جدید' })
    async create(@Body() dto: CreateActivityDto) { return this.activityService.create(dto); }

    @Put(':id')
    @ApiOperation({ summary: 'ویرایش فعالیت' })
    async update(@Param('id') id: string, @Body() dto: UpdateActivityDto) { return this.activityService.update(id, dto); }

    @Delete(':id')
    @ApiOperation({ summary: 'حذف فعالیت' })
    async remove(@Param('id') id: string) { return this.activityService.remove(id); }
}