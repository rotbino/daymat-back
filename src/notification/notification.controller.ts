// src/notification/notification.controller.ts
import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/custom.decorators';
import { NotificationService } from './notification.service';

class PushKeysDto {
    @IsString() p256dh!: string;
    @IsString() auth!: string;
}

class SubscribePushDto {
    @IsString() endpoint!: string;
    @ValidateNested()
    @Type(() => PushKeysDto)
    keys!: PushKeysDto;
    @IsString()
    userAgent?: string;
}

@ApiTags('notification')
@Controller('notification')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class NotificationController {
    constructor(private notificationService: NotificationService) {}

    @Get('push-public-key')
    @ApiOperation({ summary: 'کلید عمومی VAPID برای اشتراک پوش — null یعنی پوش فعال نیست' })
    pushPublicKey() {
        return { publicKey: this.notificationService.publicKey };
    }

    @Post('subscribe')
    @ApiOperation({ summary: 'ثبت اشتراک پوش این دستگاه' })
    subscribe(@CurrentUser() user: any, @Body() dto: SubscribePushDto) {
        return this.notificationService.subscribe(user.id, dto);
    }

    @Post('unsubscribe')
    @ApiOperation({ summary: 'حذف اشتراک پوش این دستگاه' })
    unsubscribe(@CurrentUser() user: any, @Body() dto: { endpoint: string }) {
        return this.notificationService.unsubscribe(user.id, dto?.endpoint);
    }

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
