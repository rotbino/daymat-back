// src/common/middlewares/domain-resolver.middleware.ts
import { Injectable, NestMiddleware, ForbiddenException } from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DomainResolverMiddleware implements NestMiddleware {
    constructor(private prisma: PrismaService) {}

    async use(req: FastifyRequest, res: FastifyReply, next: () => void) {
        const host = req.headers.host?.split(':')[0]; // حذف پورت

        // دامنه‌های لوکال و اصلی از slug عادی استفاده می‌کنند
        const localDomains = ['localhost', '127.0.0.1', 'daymat.com'];
        if (!host || localDomains.includes(host)) {
            return next();
        }

        // جست‌وجوی Arm بر اساس دامنه سفارشی
        const arm = await this.prisma.arm.findFirst({
            where: { customDomain: host },
            select: { slug: true, id: true },
        });

        if (!arm) {
            throw new ForbiddenException({
                errorCode: 'DOMAIN_NOT_REGISTERED',
                message: 'این دامنه به هیچ بازاری متصل نیست',
            });
        }

        // بازنویسی داخلی URL (مثلاً /products ➔ /barton/products)
        const originalUrl = req.url; // شامل query string هم هست
        req.raw.url = `/${arm.slug}${originalUrl === '/' ? '' : originalUrl}`; // ← تصحیح‌شده

        // ذخیره اطلاعات arm در request (اختیاری)
        (req as any).arm = arm;

        next();
    }
}