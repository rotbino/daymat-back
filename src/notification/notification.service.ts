// src/notification/notification.service.ts
// 🔔 اعلان‌های درون‌برنامه‌ای — رویدادهای عضویت/ارتباط تجاری
//    هر رویدادِ مهمِ چرخهٔ عضویت یک اعلان می‌سازد؛ href آمادهٔ کلیک در فرانت است.
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationService {
    private readonly logger = new Logger(NotificationService.name);

    constructor(private prisma: PrismaService) {}

    /**
     * ساخت اعلان برای چند گیرنده — بی‌صدا شکست می‌خورد (اعلان هرگز نباید جریان اصلی را بشکند)
     * notify({ userIds, type, title, body, actorUserId, href, catalogId, businessId })
     */
    async notify(input: {
        userIds: (string | null | undefined)[];
        type: string;
        title: string;
        body?: string;
        actorUserId?: string | null;
        href?: string | null;
        catalogId?: string | null;
        businessId?: string | null;
    }) {
        const uniq = Array.from(new Set((input.userIds || []).filter(Boolean) as string[]));
        if (!uniq.length) return;
        try {
            await this.prisma.notification.createMany({
                data: uniq.map((userId) => ({
                    userId,
                    type: input.type,
                    title: input.title,
                    body: input.body || null,
                    actorUserId: input.actorUserId || null,
                    href: input.href || null,
                    catalogId: input.catalogId || null,
                    businessId: input.businessId || null,
                })),
            });
        } catch (err) {
            this.logger.warn(`notify(${input.type}) failed: ${err?.message}`);
        }
    }

    /** لیست اعلان‌های من — جدیدترین اول */
    async list(userId: string, limit = 30, offset = 0) {
        const [items, unreadCount] = await Promise.all([
            this.prisma.notification.findMany({
                where: { userId },
                orderBy: { createdAt: 'desc' },
                take: Math.min(Number(limit) || 30, 100),
                skip: Number(offset) || 0,
            }),
            this.prisma.notification.count({ where: { userId, isRead: false } }),
        ]);
        return { items, unreadCount };
    }

    async unreadCount(userId: string) {
        const count = await this.prisma.notification.count({ where: { userId, isRead: false } });
        return { count };
    }

    async markRead(userId: string, id: string) {
        await this.prisma.notification.updateMany({
            where: { id, userId, isRead: false },
            data: { isRead: true, readAt: new Date() },
        });
        return { success: true };
    }

    async markAllRead(userId: string) {
        const res = await this.prisma.notification.updateMany({
            where: { userId, isRead: false },
            data: { isRead: true, readAt: new Date() },
        });
        return { success: true, updated: res.count };
    }
}
