// src/settings/system-settings.controller.ts
import { Controller, Get, Put, Body, Param, UseGuards } from '@nestjs/common'; // ✅ Param اضافه شد
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SystemSettingsService } from './system-settings.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../admin/guards/admin.guard';

@ApiTags('admin/settings')
@Controller('admin/settings')
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiBearerAuth('access-token')
export class SystemSettingsController {
    constructor(private systemSettings: SystemSettingsService) {}

    @Get('credit')
    @ApiOperation({ summary: 'دریافت تنظیمات اعتبار (فقط ادمین)' })
    async getCreditSettings() {
        return this.systemSettings.getCreditSettings();
    }

    @Put('credit')
    @ApiOperation({ summary: 'به‌روزرسانی تنظیمات اعتبار (فقط ادمین)' })
    async updateCreditSettings(@Body() data: any) {
        return this.systemSettings.updateCreditSettings(data);
    }

    @Get(':key')
    @ApiOperation({ summary: 'دریافت یک تنظیمات (فقط ادمین)' })
    async get(@Param('key') key: string) {
        return this.systemSettings.get(key);
    }

    @Put(':key')
    @ApiOperation({ summary: 'تنظیم یک مقدار (فقط ادمین)' })
    async set(
        @Param('key') key: string,
        @Body() body: { value: any; description?: string },
    ) {
        return this.systemSettings.set(key, body.value, body.description);
    }
}