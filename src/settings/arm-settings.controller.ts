// src/settings/arm-settings.controller.ts
import { Controller, Get, Put, Body, Param, UseGuards } from '@nestjs/common'; // ✅ Param اضافه شد
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ArmSettingsService } from './arm-settings.service';
import { CurrentUser } from '../common/decorators/custom.decorators';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('arm/settings')
@Controller('arm/settings')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class ArmSettingsController {
    constructor(private armSettings: ArmSettingsService) {}

    @Get(':armId/economy')
    @ApiOperation({ summary: 'دریافت تنظیمات اقتصادی بازار (مدیر بازار)' })
    async getEconomy(@Param('armId') armId: string, @CurrentUser() user: any) {
        return this.armSettings.getEconomySettings(armId, user.id);
    }

    @Put(':armId/economy')
    @ApiOperation({ summary: 'به‌روزرسانی تنظیمات اقتصادی بازار (مدیر بازار)' })
    async updateEconomy(
        @Param('armId') armId: string,
        @CurrentUser() user: any,
        @Body() data: { currency: string; bumpCost: number },
    ) {
        return this.armSettings.updateEconomySettings(armId, user.id, data);
    }

    @Get(':armId/:key')
    @ApiOperation({ summary: 'دریافت یک تنظیمات بازار (مدیر بازار)' })
    async get(
        @Param('armId') armId: string,
        @Param('key') key: string,
        @CurrentUser() user: any,
    ) {
        return this.armSettings.get(armId, user.id, key);
    }

    @Put(':armId/:key')
    @ApiOperation({ summary: 'تنظیم یک مقدار برای بازار (مدیر بازار)' })
    async set(
        @Param('armId') armId: string,
        @Param('key') key: string,
        @CurrentUser() user: any,
        @Body() body: { value: any },
    ) {
        return this.armSettings.set(armId, user.id, key, body.value);
    }
}