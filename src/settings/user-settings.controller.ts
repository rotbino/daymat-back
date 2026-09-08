// src/settings/user-settings.controller.ts
import { Controller, Get, Put, Body, Param, UseGuards } from '@nestjs/common'; // ✅ Param اضافه شد
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UserSettingsService } from './user-settings.service';
import { CurrentUser } from '../common/decorators/custom.decorators';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('user/settings')
@Controller('user/settings')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class UserSettingsController {
    constructor(private userSettings: UserSettingsService) {}

    @Get('appearance')
    @ApiOperation({ summary: 'دریافت تنظیمات ظاهری کاربر' })
    async getAppearance(@CurrentUser() user: any) {
        return this.userSettings.getAppearance(user.id);
    }

    @Put('appearance')
    @ApiOperation({ summary: 'به‌روزرسانی تنظیمات ظاهری کاربر' })
    async updateAppearance(
        @CurrentUser() user: any,
        @Body() data: { theme: string; font: string },
    ) {
        return this.userSettings.updateAppearance(user.id, data);
    }

    @Get(':key')
    @ApiOperation({ summary: 'دریافت یک تنظیمات کاربر' })
    async get(@CurrentUser() user: any, @Param('key') key: string) {
        return this.userSettings.get(user.id, key);
    }

    @Put(':key')
    @ApiOperation({ summary: 'تنظیم یک مقدار برای کاربر' })
    async set(
        @CurrentUser() user: any,
        @Param('key') key: string,
        @Body() body: { value: any },
    ) {
        return this.userSettings.set(user.id, key, body.value);
    }
}