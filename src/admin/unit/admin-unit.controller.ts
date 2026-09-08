// src/admin/unit/admin-unit.controller.ts
import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AdminUnitService } from './admin-unit.service';
import { CreateUnitDto, UpdateUnitDto } from './admin-unit.dto';
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../guards/admin.guard";

@ApiTags('admin/units')
@Controller('admin/units')
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiBearerAuth('access-token')
export class AdminUnitController {
    constructor(private unitService: AdminUnitService) {}

    @Post()
    @ApiOperation({ summary: 'ایجاد واحد جدید (فقط ادمین)' })
    @ApiResponse({ status: 201, description: 'واحد با موفقیت ایجاد شد' })
    @ApiResponse({ status: 409, description: 'واحد تکراری است' })
    create(@Body() dto: CreateUnitDto) {
        return this.unitService.create(dto);
    }

    @Get()
    @ApiOperation({ summary: 'لیست همه واحدها (فقط ادمین)' })
    findAll() {
        return this.unitService.findAll();
    }

    @Get(':id')
    @ApiOperation({ summary: 'دریافت یک واحد (فقط ادمین)' })
    @ApiResponse({ status: 404, description: 'واحد یافت نشد' })
    findOne(@Param('id') id: string) {
        return this.unitService.findOne(id);
    }

    @Put(':id')
    @ApiOperation({ summary: 'ویرایش واحد (فقط ادمین)' })
    @ApiResponse({ status: 200, description: 'واحد با موفقیت ویرایش شد' })
    @ApiResponse({ status: 404, description: 'واحد یافت نشد' })
    @ApiResponse({ status: 409, description: 'واحد تکراری است' })
    update(@Param('id') id: string, @Body() dto: UpdateUnitDto) {
        return this.unitService.update(id, dto);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'حذف واحد (فقط ادمین)' })
    @ApiResponse({ status: 200, description: 'واحد با موفقیت حذف شد' })
    @ApiResponse({ status: 404, description: 'واحد یافت نشد' })
    @ApiResponse({ status: 409, description: 'واحد در آگهی استفاده شده است' })
    remove(@Param('id') id: string) {
        return this.unitService.remove(id);
    }
}