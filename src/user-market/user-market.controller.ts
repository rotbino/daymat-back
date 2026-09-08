// src/user-market/user-market.controller.ts
import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/custom.decorators';
import { ArmAdminCatalogsService } from '../arm-admin/catalogs/arm-admin-catalogs.service';

@ApiTags('user-market')
@Controller('user-market')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class UserMarketController {
    constructor(private catalogsService: ArmAdminCatalogsService) {}

    @Get('my-uncategorized')
    @ApiOperation({ summary: 'کالاهای منِ منتشرشده در بازار که دستهٔ بازاری ندارند' })
    async myNeeds(@CurrentUser() user: any) {
        return this.catalogsService.getMyNeedsCategory(user.id);
    }

    @Patch('ads/:adId/category')
    @ApiOperation({ summary: 'تعیین دستهٔ بازاری کالای خودم (از داشبورد کاتالوگ)' })
    async setCategory(
        @CurrentUser() user: any,
        @Param('adId') adId: string,
        @Body('categoryId') categoryId: string,
    ) {
        return this.catalogsService.setOwnAdCategory(user.id, adId, categoryId);
    }
}