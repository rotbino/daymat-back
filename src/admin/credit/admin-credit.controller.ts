// src/admin/credit/admin-credit.controller.ts
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AdminCreditService } from './admin-credit.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../guards/admin.guard';

@ApiTags('admin/credits')
@Controller('admin/credits')
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiBearerAuth('access-token')
export class AdminCreditController {
    constructor(private creditService: AdminCreditService) {}

    @Get('arms')
    @ApiOperation({ summary: 'لیست بازارها برای فیلتر' })
    async getArms() { return this.creditService.getArmsForFilter(); }

    @Get('stats')
    @ApiOperation({ summary: 'آمار تراکنش‌ها' })
    @ApiQuery({ name: 'armSlug', required: false })
    @ApiQuery({ name: 'startDate', required: false })
    @ApiQuery({ name: 'endDate', required: false })
    async getStats(@Query() query: any) { return this.creditService.getStats(query); }

    @Get()
    @ApiOperation({ summary: 'لیست تراکنش‌ها' })
    async getTransactions(@Query() query: any) { return this.creditService.getTransactions(query); }

    @Get(':id')
    @ApiOperation({ summary: 'جزئیات تراکنش' })
    async getDetail(@Param('id') id: string) { return this.creditService.getTransactionDetail(id); }
}