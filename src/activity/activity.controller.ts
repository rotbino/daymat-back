// src/activity/activity.controller.ts
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ActivityService } from './activity.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('activity')
@Controller('activity') // ← مسیر اصلی
export class ActivityController {
    constructor(private activityService: ActivityService) {}

    @Get()
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'دریافت لیست همه فعالیت‌ها (مسطح)' })
    async getAll() {
        return this.activityService.getAll();
    }

    @Get('leaves') // ← مسیر: /activity/leaves
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'دریافت لیست فعالیت‌های برگ (قابل انتخاب)' })
    async getLeaves() {
        return this.activityService.getLeaves();
    }

    @Get('tree')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'دریافت درخت کامل فعالیت‌ها' })
    async getTree() {
        return this.activityService.getTree();
    }

    @Get(':id')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'دریافت یک فعالیت با id' })
    async getOne(@Param('id') id: string) {
        return this.activityService.getOne(id);
    }
}