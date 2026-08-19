// src/admin/guards/admin.guard.ts
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Observable } from 'rxjs';

@Injectable()
export class AdminGuard implements CanActivate {
    canActivate(
        context: ExecutionContext,
    ): boolean | Promise<boolean> | Observable<boolean> {
        const request = context.switchToHttp().getRequest();
        const user = request.user;

        if (!user) {
            throw new ForbiddenException({
                errorCode: 'FORBIDDEN',
                message: 'شما به این بخش دسترسی ندارید',
            });
        }

        if (user.role !== 'system_admin') {
            throw new ForbiddenException({
                errorCode: 'FORBIDDEN',
                message: 'این بخش فقط برای ادمین سیستم در دسترس است',
            });
        }

        return true;
    }
}