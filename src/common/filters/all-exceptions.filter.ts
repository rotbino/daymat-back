// src/common/filters/all-exceptions.filter.ts
import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, BadRequestException } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { I18nService } from '../services/i18n.service';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
    constructor(private i18nService: I18nService) {}

    catch(exception: unknown, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<FastifyReply>();
        const request = ctx.getRequest<FastifyRequest & { locale?: string }>();
        const locale = request.locale || 'fa';

        let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
        let errorCode = 'INTERNAL_SERVER_ERROR';
        let message = this.i18nService.translate('INTERNAL_SERVER_ERROR', locale);
        let field: string | undefined = undefined;

        if (exception instanceof BadRequestException) {
            const res = exception.getResponse() as any;
            statusCode = exception.getStatus();
            errorCode = res.errorCode || 'VALIDATION_ERROR';
            message = res.message || this.i18nService.translate(errorCode, locale);
            field = res.field;
        } else if (exception instanceof HttpException) {
            const res = exception.getResponse() as any;
            statusCode = exception.getStatus();
            errorCode = res.errorCode || `HTTP_${statusCode}`;
            message = res.message || this.i18nService.translate(errorCode, locale);
        } else {
            console.error('🔥 Unhandled Exception:', exception);
            message = this.i18nService.translate('INTERNAL_SERVER_ERROR', locale);
        }

        response.status(statusCode).send({
            statusCode,
            errorCode,
            message,
            field,
            timestamp: new Date().toISOString(),
            path: request.url,
        });
    }
}