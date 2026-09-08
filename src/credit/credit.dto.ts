// src/credit/credit.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString, Min, Max, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

// src/credit/credit.dto.ts

// src/credit/credit.dto.ts

export class PurchaseCreditDto {
    @ApiProperty({ example: 100000 })
    @IsNotEmpty()
    @Type(() => Number)
    @IsNumber()
    @Min(1000)
    amount: number;

    @ApiProperty({ example: 'online', enum: ['online', 'manual'] })
    @IsNotEmpty()
    @IsEnum(['online', 'manual'])
    paymentMethod: 'online' | 'manual';

    @ApiProperty({ required: false })
    @IsOptional()
    @IsString()
    callbackUrl?: string;

    @ApiProperty({ required: false })
    @IsOptional()
    @IsString()
    description?: string;

    @ApiProperty({ required: false })
    @IsOptional()
    @IsString()
    armId?: string;

    @ApiProperty({ required: false })
    @IsOptional()
    @IsString()
    receiptImage?: string;

    @ApiProperty({ required: false })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    creditCount?: number;

    // ✅ اضافه کردن gateway
    @ApiProperty({
        required: false,
        enum: ['pec', 'zarinpal', 'rayanpay'],
        description: 'نام درگاه پرداخت (اختیاری)'
    })
    @IsOptional()
    @IsString()
    gateway?: string;
}
export class ManualPurchaseDto {
    @ApiProperty({ example: 100000, description: 'مقدار اعتبار' })
    @IsNotEmpty()
    @Type(() => Number)
    @IsNumber()
    @Min(1000)
    amount: number;

    @ApiProperty({ type: 'string', format: 'binary', description: 'تصویر رسید پرداخت' })
    @IsOptional()
    receiptImage?: any;

    @ApiProperty({ example: 'رسید شماره 1234 - تاریخ 1402/01/01', description: 'توضیحات کاربر', required: false })
    @IsOptional()
    @IsString()
    receiptNote?: string;
}

export class VerifyManualPurchaseDto {
    @ApiProperty({ example: '67a1b2c3d4e5f67890123456', description: 'شناسه درخواست' })
    @IsNotEmpty()
    @IsString()
    requestId: string;

    @ApiProperty({ example: 'approved', description: 'approved | rejected', enum: ['approved', 'rejected'] })
    @IsNotEmpty()
    @IsEnum(['approved', 'rejected'])
    status: 'approved' | 'rejected';

    @ApiProperty({ example: 'رسید صحیح است', description: 'دلیل رد (اختیاری)', required: false })
    @IsOptional()
    @IsString()
    reason?: string;
}

export class UpdateArmPaymentConfigDto {
    @ApiProperty({
        example: ['online', 'manual'],
        description: 'لیست روش‌های پرداخت فعال',
        enum: ['online', 'manual'],
        isArray: true,
    })
    @IsNotEmpty()
    @IsEnum(['online', 'manual'], { each: true })
    paymentMethods: ('online' | 'manual')[];

    @ApiProperty({ example: '6037-9912-3456-7890', description: 'شماره کارت (برای پرداخت دستی)', required: false })
    @IsOptional()
    @IsString()
    bankAccountNumber?: string;

    @ApiProperty({ example: 'IR12-3456-7890-1234-5678-9012', description: 'شماره شبا (برای پرداخت دستی)', required: false })
    @IsOptional()
    @IsString()
    bankShebaNumber?: string;

    @ApiProperty({ example: 'علی محمدی', description: 'نام صاحب حساب', required: false })
    @IsOptional()
    @IsString()
    bankAccountOwner?: string;
}

export class CreditBalanceResponseDto {
    @ApiProperty({ example: 150000 })
    balance: number;
    @ApiProperty({ example: 'IRR' })
    currency: string;
}

export class CreditPurchaseResponseDto {
    @ApiProperty({ example: '67a1b2c3d4e5f67890123456' })
    transaction_id: string;
    @ApiProperty({ example: 'https://panel.aqayepardakht.ir/api/pay/authority' })
    payment_url?: string;
    @ApiProperty({ example: '987654321' })
    gateway_reference?: string;
    @ApiProperty({ example: 100000 })
    amount: number;
    @ApiProperty({ example: 'pending', description: 'وضعیت درخواست (برای پرداخت دستی)' })
    status?: string;
    @ApiProperty({ example: 'درخواست شما با موفقیت ثبت شد و منتظر تأیید مدیر است', description: 'پیام توضیحی' })
    message?: string;
}