// src/auth/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(
        private configService: ConfigService,
        private prisma: PrismaService, // ← برای سنجش tokenVersion (لاگ‌اوت واقعی)
    ) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            // ⚠️ توکن‌ها بی‌انقضا صادر می‌شوند (مدل تلگرام) — انقضای JWT چک نمی‌شود.
            // کنترل عمر نشست کامل با tokenVersion است (باطل‌سازی سمت سرور).
            // توکن‌های قدیمی ۷روزهٔ قبل از این تغییر هم با این flag زنده می‌مانند.
            ignoreExpiration: true,
            secretOrKey: configService.get('jwtSecret'),
        });
    }

    /**
     * در هر درخواستِ احرازشده، توکن با دیتابیس سنجیده می‌شود:
     *  ۱. کاربر باید موجود باشد
     *  ۲. نسخهٔ توکن (tv) باید با tokenVersion فعلی کاربر برابر باشد
     *     → بعد از logout/تغییر رمز، توکن‌های قدیمی فوراً 401 می‌گیرند
     *  ۳. نقش و زبان از دیتابیس تازه خوانده می‌شود (نه از توکنِ شاید منقضی‌شده)
     */
    async validate(payload: any) {
        const user = await this.prisma.user.findUnique({
            where: { id: payload.sub },
            select: {
                id: true,
                phone: true,
                role: true,
                locale: true,
                status: true,
                tokenVersion: true,
            },
        });

        if (!user) {
            throw new UnauthorizedException({
                errorCode: 'USER_NOT_FOUND',
                message: 'کاربر یافت نشد. لطفاً مجدداً وارد شوید.',
            });
        }

        // ⚠️ لاگ‌اوت واقعی: توکن‌های قدیمی‌تر از آخرین خروج/تغییر رمز مردودند
        if ((payload.tv ?? 0) !== (user.tokenVersion ?? 0)) {
            throw new UnauthorizedException({
                errorCode: 'SESSION_REVOKED',
                message: 'نشست شما خاتمه یافته است. لطفاً مجدداً وارد شوید.',
            });
        }

        return {
            id: user.id,
            phone: user.phone,
            role: user.role,
            locale: user.locale || 'fa',
            status: user.status,
        };
    }
}
