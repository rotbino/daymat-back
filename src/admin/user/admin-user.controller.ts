// src/admin/user/admin-user.controller.ts
import { Controller, Get, Put, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AdminUserService } from './admin-user.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../guards/admin.guard';

@ApiTags('admin/users')
@Controller('admin/users')
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiBearerAuth('access-token')
export class AdminUserController {
    constructor(private adminUserService: AdminUserService) {}
// ✅ این اندپوینت را قبل از @Get(':id') قرار دهید
    @Put(':userId/arm-memberships/:armSlug/role')
    @ApiOperation({ summary: 'تغییر نقش کاربر در یک بازو' })
    async updateArmRole(
        @Param('userId') userId: string,
        @Param('armSlug') armSlug: string,
        @Body('role') role: string,
    ) {
        return this.adminUserService.updateArmMembershipRole(userId, armSlug, role);
    }
    @Get('arms')
    @ApiOperation({ summary: 'لیست بازارها برای فیلتر' })
    async getArms() {
        return this.adminUserService.getArmsForFilter();
    }

    @Get()
    @ApiOperation({ summary: 'لیست کاربران با فیلتر' })
    @ApiQuery({ name: 'page', required: false })
    @ApiQuery({ name: 'limit', required: false })
    @ApiQuery({ name: 'search', required: false })
    @ApiQuery({ name: 'status', required: false })
    @ApiQuery({ name: 'role', required: false })
    @ApiQuery({ name: 'armSlug', required: false })
    @ApiQuery({ name: 'isPhoneVerified', required: false })
    @ApiQuery({ name: 'membershipTier', required: false })
    @ApiQuery({ name: 'startDate', required: false })
    @ApiQuery({ name: 'endDate', required: false })
    @ApiQuery({ name: 'sortBy', required: false })
    @ApiQuery({ name: 'sortOrder', required: false })
    async getUsers(@Query() query: any) {
        return this.adminUserService.getUsers(query);
    }

    @Get(':id')
    @ApiOperation({ summary: 'جزئیات کامل کاربر' })
    async getUserDetail(@Param('id') id: string) {
        return this.adminUserService.getUserDetail(id);
    }

    @Put(':id/status')
    @ApiOperation({ summary: 'تغییر وضعیت کاربر' })
    async updateStatus(@Param('id') id: string, @Body('status') status: string) {
        return this.adminUserService.updateUserStatus(id, status);
    }

}