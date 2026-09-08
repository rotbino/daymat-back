// src/common/dto/error-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class ErrorResponseDto {
    @ApiProperty({ example: 400, description: 'کد وضعیت HTTP' })
    statusCode: number;

    @ApiProperty({ example: 'VALIDATION_ERROR', description: 'کد خطای داخلی' })
    errorCode: string;

    @ApiProperty({ example: 'داده‌های ارسال شده معتبر نیستند.', description: 'پیام خطا' })
    message: string;

    @ApiProperty({ example: 'phone', required: false, description: 'نام فیلد (در صورت وجود)' })
    field?: string;

    @ApiProperty({ example: '2025-07-11T12:27:42.000Z', description: 'زمان وقوع خطا' })
    timestamp: string;

    @ApiProperty({ example: '/auth/register', description: 'مسیر درخواست' })
    path: string;
}