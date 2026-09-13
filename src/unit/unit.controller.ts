// src/unit/unit.controller.ts
import { Controller, Get, Query, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { UnitService } from './unit.service';
import { CreateUserUnitDto } from './unit.dto';
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from '../common/decorators/custom.decorators';

@ApiTags('unit')
@Controller('unit')
export class UnitController {
    constructor(private unitService: UnitService) {}

    @Get('all')
    @ApiOperation({ summary: 'همهٔ واحدها (عمومی — برای فرم ثبت کالای کاتالوگ)' })
    @ApiQuery({ name: 'ids', required: false, description: 'فیلتر با شناسه‌ها (comma-separated) — برای واحدهای پیشنهادی یک دسته' })
    async getAll(@Query('ids') ids?: string) {
        const idList = ids ? ids.split(',') : undefined;
        return this.unitService.getAll(idList);
    }

    @Post()
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'ثبت واحد جدید توسط کاربر (مدال واحدهای ویزارد) — عنوان تکراری ممنوع' })
    async create(@CurrentUser() user: any, @Body() dto: CreateUserUnitDto) {
        return this.unitService.createForUser(user.id, dto);
    }
}
