import {
    Controller,
    Get,
    Put,
    Body,
    Param,
    Query,
    UseGuards, Post,
} from '@nestjs/common';
import {
    ApiTags,
    ApiOperation,
    ApiBearerAuth,
    ApiQuery,
} from '@nestjs/swagger';
import { MembersService } from './members.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ArmAdminGuard } from '../../common/guards/arm-admin.guard';
import {CurrentUser} from "../../common/decorators/custom.decorators";
import {ArmRole} from "../../common/enums/prisma-enums"; // ← اضافه شده

@ApiTags('arm-admin/members')
@Controller('arm-admin/:slug/members')
@UseGuards(JwtAuthGuard, ArmAdminGuard)
@ApiBearerAuth('access-token')
export class MembersController {
    constructor(private membersService: MembersService) {}

    // ============================================================
    // دریافت لیست اعضا
    // ============================================================
    @Get()
    @ApiOperation({ summary: 'دریافت لیست اعضای بازار' })
    @ApiQuery({ name: 'page', required: false, type: Number })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    @ApiQuery({ name: 'search', required: false, type: String })
    @ApiQuery({ name: 'role', required: false, enum: ArmRole }) // ← تغییر
    @ApiQuery({ name: 'status', required: false, enum: ['active', 'paused', 'banned'] })
    @ApiQuery({ name: 'sortBy', required: false, enum: ['name', 'phone', 'role', 'status', 'joinedAt'] })
    @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
    async getMembers(
        @Param('slug') slug: string,
        @Query('page') page: number = 1,
        @Query('limit') limit: number = 20,
        @Query('search') search?: string,
        @Query('role') role?: ArmRole, // ← تغییر
        @Query('status') status?: string,
        @Query('sortBy') sortBy?: string,
        @Query('sortOrder') sortOrder: 'asc' | 'desc' = 'desc',
    ) {
        return this.membersService.getMembers(
            slug,
            Number(page),
            Number(limit),
            search,
            role,
            status,
            sortBy,
            sortOrder,
        );
    }

    // ============================================================
    // دریافت یک عضو
    // ============================================================
    @Get(':userId')
    @ApiOperation({ summary: 'دریافت جزئیات یک عضو' })
    async getMember(
        @Param('slug') slug: string,
        @Param('userId') userId: string,
    ) {
        return this.membersService.getMember(slug, userId);
    }

    // ============================================================
    // تغییر نقش عضو
    // ============================================================
    @Put(':userId/role')
    @ApiOperation({ summary: 'تغییر نقش عضو' })
    async updateMemberRole(
        @Param('slug') slug: string,
        @Param('userId') userId: string,
        @Body('role') role: ArmRole, // ← تغییر
    ) {
        return this.membersService.updateMemberRole(slug, userId, role);
    }

    // ============================================================
    // تغییر وضعیت عضو
    // ============================================================
    @Put(':userId/status')
    @ApiOperation({ summary: 'تغییر وضعیت عضو' })
    async updateMemberStatus(
        @Param('slug') slug: string,
        @Param('userId') userId: string,
        @Body('status') status: string,
    ) {
        return this.membersService.updateMemberStatus(slug, userId, status);
    }

    // ============================================================
// تأیید پیوستن به
// ============================================================
    @Post(':userId/approve')
    @ApiOperation({ summary: 'تأیید پیوستن به کاربر' })
    async approveMember(
        @Param('slug') slug: string,
        @Param('userId') userId: string,
        @CurrentUser() admin: any,
    ) {
        return this.membersService.approveMember(slug, userId, admin.id);
    }

// ============================================================
// عدم تایید پیوستن به
// ============================================================
    @Post(':userId/reject')
    @ApiOperation({ summary: 'رد پیوستن به کاربر با دلیل' })
    async rejectMember(
        @Param('slug') slug: string,
        @Param('userId') userId: string,
        @Body('reason') reason: string,
        @CurrentUser() admin: any,
    ) {
        return this.membersService.rejectMember(slug, userId, reason, admin.id);
    }

    // ============================================================
// حذف کامل پیوستن به
// ============================================================
    @Post(':userId/remove')
    @ApiOperation({ summary: 'حذف کامل پیوستن به کاربر' })
    async removeMember(
        @Param('slug') slug: string,
        @Param('userId') userId: string,
        @CurrentUser() admin: any,
    ) {
        return this.membersService.removeMember(slug, userId, admin.id);
    }
}