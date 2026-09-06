// src/unit/unit.controller.ts
import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('unit')
@Controller('unit')
export class UnitController {
    constructor(private prisma: PrismaService) {}

    @Get('all')
    @ApiOperation({ summary: 'همهٔ واحدها (عمومی — برای فرم ثبت کالای کاتالوگ)' })
    @ApiQuery({ name: 'ids', required: false, description: 'فیلتر با شناسه‌ها (comma-separated) — برای واحدهای پیشنهادی یک دسته' })
    async getAll(@Query('ids') ids?: string) {
        const idList = ids
            ? ids.split(',').filter((s) => /^[0-9a-fA-F]{24}$/.test(s.trim()))
            : [];

        return this.prisma.unit.findMany({
            where: idList.length ? { id: { in: idList } } : {},
            orderBy: [{ containsQty: 'asc' }, { title: 'asc' }],
        });
    }
}