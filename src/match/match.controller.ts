// src/match/match.controller.ts
// مچینگ دوطرفه — مسیرها
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MatchService } from './match.service';
import { RevealContactDto } from './match.dto';
import { CurrentUser } from '../common/decorators/custom.decorators';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('match')
@Controller('match')
export class MatchController {
    constructor(private matchService: MatchService) {}

    @Get('catalog/:catalogId/buyer-counts')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'شمارش خریدارانِ فعالِ هر کالای بازوی فروش — چیپ «خریداران این کالا (n)»' })
    async buyerCounts(@Param('catalogId') catalogId: string, @CurrentUser() user: any) {
        return this.matchService.buyerCountsForCatalog(catalogId, user.id);
    }

    @Get('ad/:adId/buyers')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'خریدارانِ یک کالا — مدال «خریداران این کالا» در بازوی فروش' })
    async adBuyers(@Param('adId') adId: string, @CurrentUser() user: any) {
        return this.matchService.buyersForAd(adId, user.id);
    }

    @Post('reveal')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'افشای شمارهٔ تماس با ثبت در دفتر مچینگ — خریدار↔تامین‌کننده' })
    async reveal(@Body() dto: RevealContactDto, @CurrentUser() user: any) {
        return this.matchService.revealContact(user.id, dto);
    }
}
