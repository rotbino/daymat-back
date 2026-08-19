import { Controller, Get, Post, Param, Query, Body, UseGuards } from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/custom.decorators';

@Controller('feedback')
export class FeedbackController {
    constructor(private feedbackService: FeedbackService) {}

    // تغییر مسیر به /feedback/arm/:armSlug
    @Get('arm/:armSlug')
    async getList(@Param('armSlug') armSlug: string, @Query('page') page?: number) {
        return this.feedbackService.findByArm(armSlug, page || 1);
    }

    // تغییر مسیر به /feedback/replies/:parentId
    @Get('replies/:parentId')
    async getReplies(@Param('parentId') parentId: string) {
        return this.feedbackService.getReplies(parentId);
    }

    @Post()
    @UseGuards(JwtAuthGuard)
    async create(@CurrentUser() user: any, @Body() body: { armSlug?: string; content: string; type?: string; parentId?: string }) {
        return this.feedbackService.create(user.id, body);
    }
}