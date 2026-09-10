// src/health/health.controller.ts
// اندپوینت وضعیت برای فرانت:
// 200 → بک + دیتابیس سالم | 503 → بک بالا است ولی دیتابیس پاسخ نمی‌دهد
// نکته: پینگ دیتابیس با «مسابقهٔ زمانی» محدود می‌شود تا وقتی Atlas در دسترس
// نیست، درخواست هنگ نکند و حداکثر تا ۲.۵ ثانیه پاسخ قطعی بدهیم.
import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DB_PING_TIMEOUT_MS = 2500;

@Controller('health')
export class HealthController {
    constructor(private readonly prisma: PrismaService) {}

    @Get()
    async check() {
        const dbUp = await Promise.race([
            this.prisma.user
                .findMany({ take: 1, select: { id: true } })
                .then(() => true)
                .catch(() => false),
            new Promise<boolean>((resolve) =>
                setTimeout(() => resolve(false), DB_PING_TIMEOUT_MS),
            ),
        ]);

        if (!dbUp) {
            throw new ServiceUnavailableException({
                status: 'down',
                db: 'down',
                errorCode: 'DB_UNAVAILABLE',
            });
        }

        return { status: 'ok', db: 'up' };
    }
}
