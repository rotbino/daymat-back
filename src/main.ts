// src/main.ts
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LocaleInterceptor } from './common/interceptors/locale.interceptor';
import { I18nService } from './common/services/i18n.service';
import fastifyMultipart from '@fastify/multipart';

async function bootstrap() {
    const app = await NestFactory.create<NestFastifyApplication>(
        AppModule,
        new FastifyAdapter({ logger: true }),
    );

    // ✅ ثبت multipart برای Fastify
    const fastifyInstance = app.getHttpAdapter().getInstance();
    await (fastifyInstance as any).register(fastifyMultipart as any, {
        limits: { fileSize: 10 * 1024 * 1024 },
    });

    // ============================================================
    // I18n Service
    // ============================================================
    const i18nService = app.get(I18nService);

    // ============================================================
    // فیلتر سراسری خطا
    // ============================================================
    app.useGlobalFilters(new AllExceptionsFilter(i18nService));

    // ============================================================
    // اینترسپتور زبان
    // ============================================================
    app.useGlobalInterceptors(new LocaleInterceptor());

    // ============================================================
    // Validation Pipe
    // ============================================================
    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
            exceptionFactory: (errors) => {
                const firstError = errors[0];
                const field = firstError?.property || 'unknown';
                const message = firstError?.constraints
                    ? Object.values(firstError.constraints)[0]
                    : 'خطای اعتبارسنجی';
                return new BadRequestException({
                    errorCode: 'VALIDATION_ERROR',
                    message,
                    field
                });
            },
        }),
    );

    // ============================================================
    // CORS
    // ============================================================
    app.enableCors({
        origin: [
            'https://www.daymat.ir',
            'https://daymat.vercel.app',
            'https://sarnakh.vercel.app',
            'https://uniqu.vercel.app',
            'https://uniqu.ir',
            'http://localhost:3000',
            'http://localhost:5173',
            'http://localhost:3011',
            process.env.FRONTEND_URL, // URL فرانت‌اند
        ].filter(Boolean),
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    });

    // ============================================================
    // Swagger Documentation
    // ============================================================
    const config = new DocumentBuilder()
        .setTitle('Daymat API')
        .setDescription('B2B specialized market platform')
        .setVersion('1.0')
        .addBearerAuth(
            { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
            'access-token',
        )
        .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);

    // ============================================================
    // شروع سرور
    // ============================================================
    const port = process.env.PORT || 3011;
    await app.listen(port, '0.0.0.0');
    console.log(`🚀 Daymat API running on: http://localhost:${port}`);
    console.log(`📚 Swagger docs: http://localhost:${port}/api/docs`);
}

bootstrap();