// src/admin/feedback/admin-feedback.controller.ts
import { Controller, Get, Post, Patch, Param, Query, Body, UseGuards } from '@nestjs/common';
import { AdminFeedbackService } from './admin-feedback.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../guards/admin.guard';
import { CurrentUser } from '../../common/decorators/custom.decorators';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('admin/feedbacks')
@Controller('admin/feedbacks')
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiBearerAuth('access-token')
export class AdminFeedbackController {
    constructor(private adminFeedbackService: AdminFeedbackService) {}

    @Get()
    @ApiOperation({ summary: 'دریافت لیست بازخوردها (قابل فیلتر بر اساس بازار، نوع و وضعیت)' })
    async findAll(
        @Query('armSlug') armSlug?: string,
        @Query('page') page?: number,
        @Query('type') type?: string,
        @Query('status') status?: string,
    ) {
        return this.adminFeedbackService.findAll({ armSlug, page, type, status });
    }

    @Get(':id/replies')
    @ApiOperation({ summary: 'دریافت پاسخ‌های یک بازخورد' })
    async getReplies(@Param('id') id: string) {
        return this.adminFeedbackService.getReplies(id);
    }

    @Post(':id/reply')
    @ApiOperation({ summary: 'ثبت پاسخ توسط ادمین' })
    async reply(
        @CurrentUser() user: any,
        @Param('id') id: string,
        @Body('content') content: string,
    ) {
        return this.adminFeedbackService.reply(user.id, id, content);
    }

    @Patch(':id/status')
    @ApiOperation({ summary: 'تغییر وضعیت بازخورد' })
    async updateStatus(@Param('id') id: string, @Body('status') status: string) {
        return this.adminFeedbackService.updateStatus(id, status);
    }
}