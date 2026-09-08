// src/common/guards/arm-admin.guard.ts
import { Injectable, CanActivate, ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ArmAdminGuard implements CanActivate {
    constructor(private prisma: PrismaService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const user = request.user;

        if (!user) {
            throw new ForbiddenException({ errorCode: 'UNAUTHORIZED', message: 'شما وارد نشده‌اید' });
        }

        let armId: string | null = null;

        // ۱. تلاش برای گرفتن slug از پارامترهای مسیر
        let slug = request.params.slug;
        if (!slug) {
            slug = request.query.armSlug;
        }

        if (slug) {
            // اگر slug موجود است، بازار را پیدا کن
            const arm = await this.prisma.arm.findUnique({
                where: { slug },
                select: { id: true, name: true },
            });
            if (!arm) {
                throw new NotFoundException({ errorCode: 'ARM_NOT_FOUND', message: 'بازار یافت نشد' });
            }
            armId = arm.id;
            request.arm = arm;
        } else {
            // اگر slug وجود نداشت، از شناسه آگهی استفاده کن (برای مسیرهایی مثل /arm-admin/ads/:id/status)
            const adId = request.params.id;
            if (adId) {
                const ad = await this.prisma.ad.findUnique({
                    where: { id: adId },
                    select: { armId: true },
                });
                if (!ad) {
                    throw new NotFoundException({ errorCode: 'AD_NOT_FOUND', message: 'آگهی یافت نشد' });
                }
                armId = ad.armId;
                // بازار را برای استفاده‌های بعدی در request ذخیره کن
                const arm = await this.prisma.arm.findUnique({
                    where: { id: armId },
                    select: { id: true, name: true, slug: true },
                });
                if (!arm) {
                    throw new NotFoundException({ errorCode: 'ARM_NOT_FOUND', message: 'بازار یافت نشد' });
                }
                request.arm = arm;
            } else {
                throw new NotFoundException({ errorCode: 'ARM_SLUG_REQUIRED', message: 'شناسه بازار الزامی است' });
            }
        }

        // حالا بررسی کن که کاربر مدیر این بازار است
        if (user.role === 'system_admin') {
            return true;
        }

        if (!user.id) {
            throw new ForbiddenException({ errorCode: 'USER_ID_MISSING', message: 'اطلاعات کاربر ناقص است' });
        }

        const membership = await this.prisma.armMembership.findFirst({
            where: {
                userId: user.id,
                armId: armId,
                role: 'arm_owner',
                status: 'active',
            },
        });

        if (membership) {
            return true;
        }

        throw new ForbiddenException({ errorCode: 'NOT_ARM_ADMIN', message: 'شما مدیر این بازار نیستید' });
    }
}