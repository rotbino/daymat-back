// src/proforma/proforma.controller.ts
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/custom.decorators';
import { CreateProformaDto } from './proforma.dto';
import { ProformaService } from './proforma.service';

@ApiTags('proforma')
@Controller('proforma')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class ProformaController {
    constructor(private proformaService: ProformaService) {}

    @Post()
    @ApiOperation({ summary: 'ارسال پیش‌فاکتور به خریدار (تامین‌کننده)' })
    create(@CurrentUser() user: any, @Body() dto: CreateProformaDto) {
        return this.proformaService.create(user.id, dto);
    }

    @Get('sent')
    @ApiOperation({ summary: 'پیش‌فاکتورهای صادرشدهٔ من (فروشنده)' })
    sent(@CurrentUser() user: any) {
        return this.proformaService.sent(user.id);
    }

    @Get('received')
    @ApiOperation({ summary: 'پیش‌فاکتورهای دریافتی من (خریدار)' })
    received(@CurrentUser() user: any) {
        return this.proformaService.received(user.id);
    }

    @Get(':id')
    @ApiOperation({ summary: 'جزئیات یک پیش‌فاکتور — فقط طرفین' })
    getOne(@CurrentUser() user: any, @Param('id') id: string) {
        return this.proformaService.getOne(user.id, id);
    }

    @Post(':id/confirm')
    @ApiOperation({ summary: 'تایید پیش‌فاکتور توسط خریدار — معامله مُهر می‌شود' })
    confirm(@CurrentUser() user: any, @Param('id') id: string) {
        return this.proformaService.confirm(user.id, id);
    }

    @Post(':id/reject')
    @ApiOperation({ summary: 'رد پیش‌فاکتور توسط خریدار' })
    reject(@CurrentUser() user: any, @Param('id') id: string) {
        return this.proformaService.reject(user.id, id);
    }

    @Post(':id/cancel')
    @ApiOperation({ summary: 'لغو پیش‌فاکتور توسط صادرکننده (تا پیش از تصمیم خریدار)' })
    cancel(@CurrentUser() user: any, @Param('id') id: string) {
        return this.proformaService.cancel(user.id, id);
    }
}
