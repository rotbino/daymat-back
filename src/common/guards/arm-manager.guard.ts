// src/common/guards/arm-manager.guard.ts
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ArmManagerGuard implements CanActivate {
    constructor(private prisma: PrismaService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const user = request.user;

        if (!user || !user.id) {
            throw new ForbiddenException({
                errorCode: 'FORBIDDEN',
                message: 'شما اجازه دسترسی به این بخش را ندارید',
            });
        }

        // ۱. اول از توکن بخوان (سریع)
        if (user.role === 'system_admin') {
            return true;
        }

        // ۲. اگر توکن نقش نداشت یا معتبر نبود، از دیتابیس چک کن (امن)
        const dbUser = await this.prisma.user.findUnique({
            where: { id: user.id },
            select: { role: true },
        });

        if (!dbUser || dbUser.role !== 'system_admin') {
            throw new ForbiddenException({
                errorCode: 'FORBIDDEN',
                message: 'شما اجازه مدیریت بازارها را ندارید',
            });
        }

        return true;
    }
}