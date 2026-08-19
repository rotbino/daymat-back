// src/location/location.controller.ts
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { LocationService } from './location.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

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

    @Get(':armId')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'دریافت درخت موقعیت‌های یک بازار' })
    @ApiResponse({ status: 200, description: 'درخت موقعیت‌های بازار' })
    async getArmLocations(@Param('armId') armId: string) {
        return this.locationService.getArmLocationTree(armId);
    }
}