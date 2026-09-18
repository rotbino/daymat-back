// src/notification/notification.service.ts
// 🔔 اعلان‌های درون‌برنامه‌ای + پوش واقعی PWA
//    هر رویدادِ مهم یک اعلان دیتابیسی می‌سازد و — اگر کاربر اشتراک پوش داده باشد —
//    همان لحظه web-push به دستگاهش می‌رود (شبیه پیام واتساپ، بدون بازکردن پنل).
//    پوش هرگز جریان اصلی را نمی‌شکند: بی‌صدا شکست می‌خورد و اشتراک‌های مُرده پاک می‌شوند.
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as webpush from 'web-push';

@Injectable()
export class NotificationService {
    private readonly logger = new Logger(NotificationService.name);
    private pushConfigured = false;

    constructor(
        private prisma: PrismaService,
        @Optional() private config?: ConfigService,
    ) {
        const publicKey = this.config?.get<string>('VAPID_PUBLIC_KEY');
        const privateKey = this.config?.get<string>('VAPID_PRIVATE_KEY');
        if (publicKey && privateKey) {
            try {
                webpush.setVapidDetails(
                    this.config?.get<string>('VAPID_SUBJECT') || 'mailto:support@imach.ir',
                    publicKey,
                    privateKey,
                );
                this.pushConfigured = true;
            } catch (err) {
                this.logger.warn(`web-push init failed: ${err?.message}`);
            }
        } else {
            this.logger.warn('VAPID keys missing — پوش غیرفعال است (فقط اعلان درون‌برنامه‌ای)');
        }
    }

    /** کلید عمومی VAPID برای فرانت — null یعنی سرور پوش ندارد */
    get publicKey(): string | null {
        return this.pushConfigured ? this.config?.get<string>('VAPID_PUBLIC_KEY') ?? null : null;
    }

    /**
     * ساخت اعلان برای چند گیرنده + ارسال پوش — بی‌صدا شکست می‌خورد
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

        // 🚀 پوش فوری — مستقل از دیتابیس اعلان؛ هر خطا بی‌صدا
        if (this.pushConfigured) {
            void this.pushToUsers(uniq, { title: input.title, body: input.body || '', href: input.href || null, type: input.type });
        }
    }

    /** اشتراک‌گذاری دستگاه از فرانت — upsert بر اساس endpoint */
    async subscribe(userId: string, dto: { endpoint: string; keys: { p256dh: string; auth: string }; userAgent?: string }) {
        if (!dto?.endpoint || !dto?.keys?.p256dh || !dto?.keys?.auth) {
            this.logger.warn('subscribe: incomplete payload');
            return { success: false };
        }
        await this.prisma.pushSubscription.upsert({
            where: { endpoint: dto.endpoint },
            update: { p256dh: dto.keys.p256dh, auth: dto.keys.auth, userId, userAgent: dto.userAgent ?? null },
            create: {
                userId,
                endpoint: dto.endpoint,
                p256dh: dto.keys.p256dh,
                auth: dto.keys.auth,
                userAgent: dto.userAgent ?? null,
            },
        });
        return { success: true };
    }

    /** خروج از پوش — فرانت خودش subscription را unsubscribe می‌کند، ما فقط ردیف را پاک می‌کنیم */
    async unsubscribe(userId: string, endpoint: string) {
        await this.prisma.pushSubscription.deleteMany({ where: { endpoint, userId } });
        return { success: true };
    }

    /** ارسال پوش به همهٔ دستگاه‌های چند کاربر — fire-and-forget */
    private async pushToUsers(userIds: string[], payload: { title: string; body: string; href: string | null; type: string }) {
        try {
            const subs = await this.prisma.pushSubscription.findMany({
                where: { userId: { in: userIds } },
            });
            if (!subs.length) return;

            const body = JSON.stringify({ title: payload.title, body: payload.body, href: payload.href, type: payload.type });
            const deadIds: string[] = [];

            await Promise.allSettled(
                subs.map(async (sub) => {
                    try {
                        await webpush.sendNotification(
                            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } } as any,
                            body,
                            { TTL: 3600 },
                        );
                    } catch (err: any) {
                        // 404/410 = اشتراک مُرده — پاکش کن تا ارسال‌های بعدی هدر نرود
                        if (err?.statusCode === 404 || err?.statusCode === 410) deadIds.push(sub.id);
                        else this.logger.warn(`push failed (${err?.statusCode}): ${err?.message}`);
                    }
                }),
            );

            if (deadIds.length) {
                await this.prisma.pushSubscription.deleteMany({ where: { id: { in: deadIds } } }).catch(() => undefined);
            }
        } catch (err) {
            this.logger.warn(`pushToUsers failed: ${err?.message}`);
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
