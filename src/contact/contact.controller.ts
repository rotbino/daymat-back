// src/contact/contact.controller.ts
import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/custom.decorators';
import { ContactService } from './contact.service';
import { SyncContactsDto } from './contact.dto';

@ApiTags('contact')
@Controller('contact')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class ContactController {
    constructor(private contactService: ContactService) {}

    @Post('sync')
    @ApiOperation({ summary: 'همگام‌سازی مخاطبین تلفن — نرمال + تطبیق با اعضای دی مچ + ذخیره (۵۰۰تا در هر درخواست)' })
    sync(@CurrentUser() user: any, @Body() dto: SyncContactsDto) {
        return this.contactService.sync(user.id, dto);
    }

    @Get()
    @ApiOperation({ summary: 'دفترچهٔ من — جستجو با نام/شماره + مشخصاتِ مخاطب‌های عضو دی مچ' })
    list(@CurrentUser() user: any, @Query('q') q?: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
        return this.contactService.list(user.id, q, Number(limit) || 500, Number(offset) || 0);
    }

    @Get('stats')
    @ApiOperation({ summary: 'خلاصهٔ دفترچه — total و matched برای بج' })
    stats(@CurrentUser() user: any) {
        return this.contactService.stats(user.id);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'حذف یک مخاطب از دفترچهٔ من' })
    remove(@CurrentUser() user: any, @Param('id') id: string) {
        return this.contactService.remove(user.id, id);
    }
}
