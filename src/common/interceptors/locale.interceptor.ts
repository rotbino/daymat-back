// src/common/interceptors/locale.interceptor.ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';

@Injectable()
export class LocaleInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const request = context.switchToHttp().getRequest<any>();

        // ۱. اگر کاربر لاگین است، از توکن بخوان
        if (request.user?.locale) {
            request.locale = request.user.locale;
        } else {
            // ۲. اگر لاگین نیست، از هدر Accept-Language بگیر
            const headerLang = request.headers['accept-language'];
            request.locale = headerLang ? headerLang.split(',')[0].trim().substring(0, 2) : 'fa';
        }

        return next.handle();
    }
}