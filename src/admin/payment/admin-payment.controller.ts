// src/admin/payment/admin-payment.controller.ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminPaymentService } from './admin-payment.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../guards/admin.guard';

@ApiTags('admin/payments')
@Controller('admin/payments')
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiBearerAuth('access-token')
export class AdminPaymentController {
    constructor(private paymentService: AdminPaymentService) {}

    @Get('stats')
    async getStats(@Query() query: any) { return this.paymentService.getStats(query); }

    @Get()
    async getPaymentRequests(@Query() query: any) { return this.paymentService.getPaymentRequests(query); }
}