// src/location/location.controller.ts
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { LocationService } from './location.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard';

@ApiTags('location')
@Controller('location')
export class LocationController {
    constructor(private locationService: LocationService) {}

    @Get('tree')
    @ApiOperation({ summary: 'دریافت درخت کامل موقعیت‌ها' })
    @ApiResponse({ status: 200, description: 'درخت موقعیت‌ها' })
    async getFullTree() {
        return this.locationService.getFullTree();
    }

    // ✅ جستجوی شهر — عمومی، با cache طولانی
    @Get('cities/search')
    @UseGuards(OptionalJwtAuthGuard)
    @ApiOperation({ summary: 'جستجوی شهر با نام' })
    @ApiQuery({ name: 'q', required: true })
    @ApiQuery({ name: 'limit', required: false })
    async searchCities(
        @Query('q') q: string,
        @Query('limit') limit = '20',
    ) {
        return this.locationService.searchCities(q.trim(), +limit);
    }

    @Get(':armId')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'دریافت درخت موقعیت‌های یک بازار' })
    @ApiResponse({ status: 200, description: 'درخت موقعیت‌های بازار' })
    async getArmLocations(@Param('armId') armId: string) {
        return this.locationService.getArmLocationTree(armId);
    }
}