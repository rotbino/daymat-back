// src/admin/feedback/admin-feedback.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminFeedbackService {
    constructor(private prisma: PrismaService) {}

    async findAll(query: {
        armSlug?: string;
        page?: number;
        limit?: number;
        type?: string;
        status?: string;
    }) {
        const { armSlug, page = 1, limit = 20, type, status } = query;
        const where: any = { parentId: null };

        if (armSlug) {
            const arm = await this.prisma.arm.findUnique({ where: { slug: armSlug } });
            if (!arm) throw new NotFoundException('بازار یافت نشد');
            where.armId = arm.id;
        }

        if (type) where.type = type;
        if (status) where.status = status;

        const [items, total] = await Promise.all([
            this.prisma.feedback.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
                include: {
                    user: { select: { id: true, fullName: true, avatarUrl: true } },
                    arm: { select: { id: true, slug: true, name: true } },
                    _count: { select: { replies: true } },
                },
            }),
            this.prisma.feedback.count({ where }),
        ]);

        return {
            items,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        };
    }

    async getReplies(parentId: string) {
        return this.prisma.feedback.findMany({
            where: { parentId },
            orderBy: { createdAt: 'asc' },
            include: { user: { select: { id: true, fullName: true, avatarUrl: true } } },
        });
    }

    async reply(userId: string, parentId: string, content: string) {
        const parent = await this.prisma.feedback.findUnique({ where: { id: parentId } });
        if (!parent) throw new NotFoundException('بازخورد والد یافت نشد');

        return this.prisma.feedback.create({
            data: {
                armId: parent.armId,
                userId,
                parentId,
                content,
                type: 'suggestion',
                status: 'open',
            },
            include: { user: { select: { id: true, fullName: true } } },
        });
    }

    async updateStatus(id: string, status: string) {
        return this.prisma.feedback.update({
            where: { id },
            data: { status },
        });
    }
}