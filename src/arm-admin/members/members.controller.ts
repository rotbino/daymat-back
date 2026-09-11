import {
    Controller,
    Get,
    Put,
    Body,
    Param,
    Query,
    UseGuards, Post,
    Req,
    ForbiddenException,
} from '@nestjs/common';
import {
    ApiTags,
    ApiOperation,
    ApiBearerAuth,
    ApiQuery,
} from '@nestjs/swagger';
import { MembersService } from './members.service';
import { MembershipRequestService } from '../../arm/membership-request.service';
import { LeaveRequestService } from '../../arm/leave-request.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ArmAdminGuard } from '../../common/guards/arm-admin.guard';
import {CurrentUser} from "../../common/decorators/custom.decorators";
import {ArmRole} from "../../common/enums/prisma-enums"; // ← اضافه شده

@ApiTags('arm-admin/members')
@Controller('arm-admin/:slug/members')
@UseGuards(JwtAuthGuard, ArmAdminGuard)
@ApiBearerAuth('access-token')
export class MembersController {
    constructor(
        private membersService: MembersService,
        private membershipRequestService: MembershipRequestService,
        private leaveRequestService: LeaveRequestService,
    ) {}

    // ============================================================
    // درخواست‌های عضویت بازار خصوصی — باید قبل از @Get(':userId') باشد
    // ============================================================
    @Get('membership-requests')
    @ApiOperation({ summary: 'لیست درخواست‌های عضویت بازار (خصوصی)' })
    @ApiQuery({ name: 'status', required: false, enum: ['pending', 'approved', 'rejected'] })
    async getMembershipRequests(
        @Param('slug') slug: string,
        @Query('status') status?: string,
        @Query('page') page: number = 1,
        @Query('limit') limit: number = 20,
    ) {
        return this.membershipRequestService.listRequests(slug, status, Number(page), Number(limit));
    }

    @Post('membership-requests/:requestId/approve')
    @ApiOperation({ summary: 'تایید درخواست عضویت — ساخت عضویت فعال' })
    async approveMembershipRequest(
        @Param('slug') slug: string,
        @Param('requestId') requestId: string,
        @CurrentUser() admin: any,
    ) {
        return this.membershipRequestService.decideRequest(slug, requestId, 'approve', admin.id);
    }

    @Post('membership-requests/:requestId/reject')
    @ApiOperation({ summary: 'رد درخواست عضویت با دلیل' })
    async rejectMembershipRequest(
        @Param('slug') slug: string,
        @Param('requestId') requestId: string,
        @CurrentUser() admin: any,
        @Body('reason') reason: string,
    ) {
        return this.membershipRequestService.decideRequest(slug, requestId, 'reject', admin.id, reason);
    }

    // ============================================================
    // درخواست‌های لغو عضویت — خروجِ عضو فقط با تصمیمِ مالک/ادمینِ بازار
    // ============================================================
    @Get('leave-requests')
    @ApiOperation({ summary: 'لیست درخواست‌های لغو عضویت (درخواست‌های خروجِ اعضا)' })
    @ApiQuery({ name: 'status', required: false, enum: ['pending', 'approved', 'rejected', 'withdrawn'] })
    async getLeaveRequests(
        @Param('slug') slug: string,
        @Query('status') status?: string,
        @Query('page') page: number = 1,
        @Query('limit') limit: number = 20,
    ) {
        return this.leaveRequestService.listRequests(slug, status, Number(page), Number(limit));
    }

    @Post('leave-requests/:requestId/approve')
    @ApiOperation({ summary: 'تایید درخواست لغو — لغوِ عضویت اجرا می‌شود (تاریخ و عاملِ لغو ثبت می‌شود)' })
    async approveLeaveRequest(
        @Param('slug') slug: string,
        @Param('requestId') requestId: string,
        @CurrentUser() admin: any,
    ) {
        return this.leaveRequestService.decideRequest(slug, requestId, 'approve', admin.id);
    }

    @Post('leave-requests/:requestId/reject')
    @ApiOperation({ summary: 'رد درخواست لغو با دلیل — عضو می‌ماند' })
    async rejectLeaveRequest(
        @Param('slug') slug: string,
        @Param('requestId') requestId: string,
        @CurrentUser() admin: any,
        @Body('reason') reason: string,
    ) {
        return this.leaveRequestService.decideRequest(slug, requestId, 'reject', admin.id, reason);
    }

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
    // ادمین‌های بازار — انتصاب/عزل فقط مالک (ادمین فقط می‌بیند)
    // ⚠️ قبل از مسیرهای :userId declare شده تا «admins» با :userId قاطی نشود
    // ============================================================
    private assertArmOwner(req: any) {
        const isSystemAdmin = req?.user?.role === 'system_admin';
        const isOwner = req?.armMembership?.role === 'arm_owner';
        if (!isSystemAdmin && !isOwner) {
            throw new ForbiddenException({
                errorCode: 'ARM_OWNER_ONLY',
                message: 'فقط مالک بازار می‌تواند ادمین منصوب یا عزل کند',
            });
        }
    }

    @Get('admins')
    @ApiOperation({ summary: 'لیست ادمین‌های بازار' })
    async getAdmins(@Param('slug') slug: string) {
        return this.membersService.getAdmins(slug);
    }

    @Post('admins')
    @ApiOperation({ summary: 'انتصاب ادمین بازار با شماره موبایل (فقط مالک)' })
    async addAdmin(
        @Param('slug') slug: string,
        @Body('phone') phone: string,
        @Req() req: any,
    ) {
        this.assertArmOwner(req);
        if (!phone || !phone.trim()) {
            throw new ForbiddenException({ errorCode: 'PHONE_REQUIRED', message: 'شماره موبایل الزامی است' });
        }
        return this.membersService.addAdminByPhone(slug, phone.trim(), req.user?.id);
    }

    @Post('admins/:userId/remove')
    @ApiOperation({ summary: 'عزل ادمین بازار (فقط مالک)' })
    async removeAdmin(
        @Param('slug') slug: string,
        @Param('userId') userId: string,
        @Req() req: any,
    ) {
        this.assertArmOwner(req);
        return this.membersService.removeAdmin(slug, userId, req.user?.id);
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