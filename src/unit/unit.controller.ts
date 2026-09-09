// src/unit/unit.controller.ts
import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { UnitService } from './unit.service';

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
}
