// src/common/guards/arm-admin-or-owner-read.guard.ts
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ArmAdminOrOwnerReadGuard implements CanActivate {
    constructor(private prisma: PrismaService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const user = request.user;


        if (!user || !user.id) {
            throw new ForbiddenException({
                errorCode: 'UNAUTHORIZED',
                message: 'شما وارد نشده‌اید',
            });
        }

        // ۱. اگر ادمین سیستم باشه، اجازه بده
        if (user.role === 'system_admin') {
            return true;
        }

        // ۲. بررسی اینکه کاربر arm_owner هست (فقط برای مشاهده)
        // از slug در params یا query استفاده کن
        const slug = request.params.slug || request.query.slug;
        const armId = request.params.id || request.body?.armId || request.query.armId;

        // اگر slug یا armId وجود داشته باشه، بررسی کن
        if (slug) {
            const arm = await this.prisma.arm.findUnique({
                where: { slug },
                select: { id: true },
            });
            if (arm) {
                const membership = await this.prisma.armMembership.findFirst({
                    where: {
                        userId: user.id,
                        armId: arm.id,
                        role: 'arm_owner',
                        status: 'active',
                    },
                });
                if (membership) return true;
            }
        }

        if (armId) {
            const membership = await this.prisma.armMembership.findFirst({
                where: {
                    userId: user.id,
                    armId: armId,
                    role: 'arm_owner',
                    status: 'active',
                },
            });
            if (membership) return true;
        }

        // ❌ اگر هیچ slug یا armId ای وجود نداشت، اجازه نده
        // (اینجا می‌تونیم یه لیست از armهای کاربر رو بگیریم و بررسی کنیم)

        // ۳. اگر هیچ پارامتری وجود نداشت، بررسی کن کاربر حداقل یک بازار دارد که مالک آن است
        const membership = await this.prisma.armMembership.findFirst({
            where: {
                userId: user.id,
                role: 'arm_owner',
                status: 'active',
            },
            select: {
                armId: true,
            },
        });

        if (membership) {
            return true;
        }

        throw new ForbiddenException({
            errorCode: 'FORBIDDEN',
            message: 'شما دسترسی به این بخش را ندارید',
        });
    }
}