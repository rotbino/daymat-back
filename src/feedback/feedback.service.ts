import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FeedbackService {
    constructor(private prisma: PrismaService) {}

    async create(userId: string, dto: { armSlug?: string; content: string; type?: string; parentId?: string }) {
        let armId: string | null = null;
        if (dto.armSlug) {
            const arm = await this.prisma.arm.findUnique({ where: { slug: dto.armSlug } });
            if (!arm) throw new NotFoundException('بازار یافت نشد');
            armId = arm.id;
        }
        if (dto.parentId) {
            const parent = await this.prisma.feedback.findUnique({ where: { id: dto.parentId } });
            if (!parent) throw new NotFoundException('نظر والد یافت نشد');
            // اطمینان از همان بازار
            if (parent.armId !== armId) throw new BadRequestException('بازار مطابقت ندارد');
        }

        return this.prisma.feedback.create({
            data: {
                armId,
                userId,
                content: dto.content,
                type: dto.type || 'suggestion',
                parentId: dto.parentId || null,
            },
            include: { user: { select: { id: true, fullName: true, avatarUrl: true } } },
        });
    }

    async findByArm(armSlug: string, page = 1, limit = 20) {
        const arm = await this.prisma.arm.findUnique({ where: { slug: armSlug } });
        if (!arm) throw new NotFoundException('بازار یافت نشد');
        const where = { armId: arm.id, parentId: null }; // فقط سرشاخه‌ها
        const [items, total] = await Promise.all([
            this.prisma.feedback.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
                include: {
                    user: { select: { id: true, fullName: true, avatarUrl: true } },
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

    // (اختیاری) تغییر وضعیت توسط مدیر
    async updateStatus(id: string, status: string) {
        return this.prisma.feedback.update({ where: { id }, data: { status } });
    }
}