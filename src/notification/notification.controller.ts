// src/notification/notification.controller.ts
import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/custom.decorators';
import { NotificationService } from './notification.service';

@ApiTags('notification')
@Controller('notification')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class NotificationController {
    constructor(private notificationService: NotificationService) {}

    @Get()
    @ApiOperation({ summary: 'لیست اعلان‌های من — جدیدترین اول + شمارندهٔ خوانده‌نشده' })
    list(@CurrentUser() user: any, @Query('limit') limit?: string, @Query('offset') offset?: string) {
        return this.notificationService.list(user.id, Number(limit) || 30, Number(offset) || 0);
    }

    @Get('unread-count')
    @ApiOperation({ summary: 'تعداد اعلان‌های خوانده‌نشدهٔ من — برای بج' })
    unreadCount(@CurrentUser() user: any) {
        return this.notificationService.unreadCount(user.id);
    }

    @Post('read-all')
    @ApiOperation({ summary: 'خواندن همهٔ اعلان‌های من' })
    markAllRead(@CurrentUser() user: any) {
        return this.notificationService.markAllRead(user.id);
    }

    @Post(':id/read')
    @ApiOperation({ summary: 'خواندن یک اعلان' })
    markRead(@CurrentUser() user: any, @Param('id') id: string) {
        return this.notificationService.markRead(user.id, id);
    }
}
