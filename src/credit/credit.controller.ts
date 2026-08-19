// src/credit/credit.controller.ts
import {
    Controller,
    Get,
    Post,
    Put,
    Body,
    Query,
    Res,
    UseGuards,
    BadRequestException,
    Param,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { Response } from 'express';
import { CreditService } from './credit.service';
import {
    PurchaseCreditDto,
    ManualPurchaseDto,
    VerifyManualPurchaseDto,
    CreditBalanceResponseDto,
    CreditPurchaseResponseDto,
    UpdateArmPaymentConfigDto,
} from './credit.dto';
import { CurrentUser } from '../common/decorators/custom.decorators';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ArmManagerGuard } from '../common/guards/arm-manager.guard';
import {ArmAdminGuard} from "../common/guards/arm-admin.guard";
// ⭐ تابع کمکی
function redirectHtml(url: string) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    return `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${frontendUrl}${url}"></head><body><p>در حال انتقال...</p></body></html>`;
}
@ApiTags('credit')
@Controller('credit')
export class CreditController {
    constructor(private creditService: CreditService) {}

    // ============================================================
    // 1. موجودی اعتبار کاربر
    // ============================================================
    @Get('balance')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'دریافت موجودی اعتبار کاربر' })
    async getBalance(@CurrentUser() user: any) {
        return this.creditService.getUserBalance(user.id);
    }

    // ============================================================
    // 2. خرید اعتبار (انتخاب روش توسط کاربر)
    // ============================================================

    @Post('purchase')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'خرید اعتبار (انتخاب روش توسط کاربر)' })
    async purchase(@CurrentUser() user: any, @Body() dto: PurchaseCreditDto) {
        const business = await this.creditService['prisma'].business.findFirst({
            where: { ownerUserId: user.id, status: 'active' },
        });

        if (!business) {
            throw new BadRequestException({
                errorCode: 'NO_ACTIVE_BUSINESS',
                message: 'ابتدا یک کسب‌وکار ثبت کنید',
            });
        }

        // خواندن تنظیمات ارز از بازار
        let currency = 'IRR';
        let creditPrice = 2000;

        if (dto.armId) {
            const arm = await this.creditService['prisma'].arm.findUnique({
                where: { id: dto.armId },
                select: { config: true },
            });

            if (arm?.config) {
                const config = arm.config as any;
                currency = config.economy?.currency || 'IRR';
                creditPrice = config.economy?.creditPrice || 2000;
            }
        }

        const creditCount = dto.creditCount || Math.floor(dto.amount / creditPrice);

        if (dto.paymentMethod === 'online') {
            return this.creditService.initiatePurchase(
                user.id,
                dto.amount,
                dto.armId,
                dto.callbackUrl,
                dto.description,
                creditCount,
                creditPrice,
                currency,
                dto.gateway,
            );
        } else if (dto.paymentMethod === 'manual') {
            return this.creditService.initiateManualPurchase(
                user.id,
                business.id,
                dto.amount,
                dto.armId,
                dto.receiptImage,
                dto.description,
                creditCount,
                creditPrice,
                currency,
            );
        }
    }



    // ============================================================
    // 4. تأیید پرداخت آنلاین (Callback)
    // ============================================================
    // ⭐ GET - برای درگاه‌هایی که با GET میان
    // ⭐ GET - برای درگاه‌هایی که با GET میان
    @Get('verify')
    @ApiOperation({ summary: 'تأیید پرداخت آنلاین (GET)' })
    async verifyPaymentGet(
        @Query('Authority') authority: string,
        @Query('Status') status: string,
        @Query('au') au: string,
        @Query('transid') transid: string,
        @Res() res: Response,
    ) {

        const gatewayReference = authority || au || transid;

        if (!gatewayReference) {
            return res.type('text/html').send(redirectHtml('/?payment=failed&message=no-ref'));
        }

        try {
            const result = await this.creditService.verifyPayment(gatewayReference, status || '1');

            if (result.success) {
                return res.type('text/html').send(redirectHtml('/?payment=success'));
            } else {
                return res.type('text/html').send(redirectHtml(`/?payment=failed&message=${encodeURIComponent(result.message || '')}`));
            }
        } catch (error) {
            return res.type('text/html').send(redirectHtml('/?payment=failed'));
        }
    }

// ⭐ POST - برای آقای پرداخت
    @Post('verify')
    async verifyPaymentPost(@Body() body: any, @Res() res: Response) {
        const transid = body.transid;
        const paymentStatus = body.status;
        const tracking_number = body.tracking_number || '';
        const bank = body.bank || '';

        if (!transid) {
            return res.type('text/html').send(redirectHtml('/credit/verify?status=0'));
        }

        if (paymentStatus === '0') {
            return res.type('text/html').send(redirectHtml(`/credit/verify?status=0&transid=${transid}`));
        }

        try {
            const result = await this.creditService.verifyPayment(transid, '1');

            if (result.success) {
                return res.type('text/html').send(
                    redirectHtml(`/credit/verify?status=1&transid=${transid}&tracking_number=${tracking_number}&bank=${bank}`)
                );
            } else {
                return res.type('text/html').send(
                    redirectHtml(`/credit/verify?status=0&transid=${transid}`)
                );
            }
        } catch (error) {
            return res.type('text/html').send(redirectHtml(`/credit/verify?status=0&transid=${transid}`));
        }
    }




// ============================================================
// دریافت اطلاعات پرداخت فیشی بازار
// ============================================================
    @Get('manual-info/:armId')
    @ApiOperation({ summary: 'دریافت اطلاعات پرداخت کارت به کارت بازار' })
    @ApiResponse({ status: 200, description: 'اطلاعات پرداخت فیشی' })
    async getManualPaymentInfo(@Param('armId') armId: string) {
        const paymentMethods = await this.creditService.getPaymentMethods(armId);

        if (!paymentMethods.manualAvailable) {
            throw new BadRequestException({
                errorCode: 'MANUAL_PAYMENT_NOT_AVAILABLE',
                message: 'پرداخت کارت به کارت در این بازار فعال نیست',
            });
        }

        return {
            cardNumber: paymentMethods.manualConfig.cardNumber,
            shebaNumber: paymentMethods.manualConfig.shebaNumber,
            accountOwner: paymentMethods.manualConfig.accountOwner,
            bankName: paymentMethods.manualConfig.bankName,
            instructions: paymentMethods.manualConfig.instructions,
        };
    }
    // ============================================================
    // 6. لیست درخواست‌های خرید دستی (فقط مدیر بازار)
    // ============================================================
    @Get('manual/requests/:armId')
    @UseGuards(JwtAuthGuard, ArmManagerGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'لیست درخواست‌های خرید دستی (فقط مدیر بازار)' })
    async getManualRequests(
        @Param('armId') armId: string,
        @CurrentUser() user: any,
        @Query('status') status?: 'pending' | 'approved' | 'rejected',
    ) {
        return this.creditService.getManualRequests(armId, user.id, status);
    }

    // ============================================================
    // 7. اطلاعات بانکی بازار (برای نمایش به کاربر)
    // ============================================================
    @Get('bank-info/:armId')
    @ApiOperation({ summary: 'دریافت اطلاعات بانکی بازار (برای پرداخت دستی)' })
    async getArmBankInfo(@Param('armId') armId: string) {
        return this.creditService.getArmBankInfo(armId);
    }

    // ============================================================
    // 8. به‌روزرسانی تنظیمات پرداخت بازار (فقط مدیر بازار)
    // ============================================================
    @Put('config/:armId')
    @UseGuards(JwtAuthGuard, ArmManagerGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'به‌روزرسانی تنظیمات پرداخت بازار (فقط مدیر بازار)' })
    async updatePaymentConfig(
        @Param('armId') armId: string,
        @CurrentUser() user: any,
        @Body() dto: UpdateArmPaymentConfigDto,
    ) {
        // ✅ استفاده از متد سرویس
        return this.creditService.updatePaymentConfig(armId, user.id, dto);
    }

    // ============================================================
    // 9. تاریخچه تراکنش‌های کاربر
    // ============================================================
    @Get('transactions')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'تاریخچه تراکنش‌های کاربر' })
    async getTransactions(
        @CurrentUser() user: any,
        @Query('limit') limit = 20,
        @Query('offset') offset = 0,
    ) {
        return this.creditService.getUserTransactions(user.id, Number(limit), Number(offset));
    }

    // ============================================================
    // 10. صفحه موفقیت
    // ============================================================
    @Get('success')
    @ApiOperation({ summary: 'صفحه موفقیت خرید اعتبار' })
    async paymentSuccess(
        @Query('transaction_id') transactionId: string,
        @Query('amount') amount: string,
        @Query('new_balance') newBalance: string,
        @Query('tracking_code') trackingCode: string,
        @Res() res: Response,
    ) {
        const html = `
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>خرید اعتبار موفق - دِیمَت</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Vazirmatn', 'Segoe UI', Tahoma, sans-serif;
            background: linear-gradient(135deg, #610000 0%, #8b0000 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .container {
            background: white;
            border-radius: 16px;
            padding: 40px;
            max-width: 500px;
            width: 100%;
            text-align: center;
            box-shadow: 0 20px 40px rgba(0,0,0,0.3);
        }
        .icon { font-size: 80px; color: #10b981; margin-bottom: 20px; }
        h1 { color: #059669; margin-bottom: 16px; font-size: 28px; }
        .info-card {
            background: #f8fafc;
            border: 2px solid #e2e8f0;
            border-radius: 12px;
            padding: 20px;
            margin: 20px 0;
            text-align: right;
        }
        .info-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #e2e8f0;
        }
        .info-row:last-child { border-bottom: none; }
        .info-label { color: #64748b; font-weight: 500; }
        .info-value { color: #1e293b; font-weight: 600; }
        .btn {
            display: inline-block;
            background: #610000;
            color: white;
            padding: 12px 32px;
            border-radius: 8px;
            text-decoration: none;
            font-weight: 600;
            margin: 8px;
            transition: all 0.3s ease;
        }
        .btn:hover { background: #8b0000; transform: translateY(-2px); }
        .btn-outline {
            background: transparent;
            color: #610000;
            border: 2px solid #610000;
        }
        .btn-outline:hover { background: #610000; color: white; }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">✅</div>
        <h1>خرید اعتبار موفق</h1>
        <div class="info-card">
            <div class="info-row">
                <span class="info-label">شناسه تراکنش:</span>
                <span class="info-value">${transactionId}</span>
            </div>
            <div class="info-row">
                <span class="info-label">مبلغ خریداری شده:</span>
                <span class="info-value">${Number(amount || 0).toLocaleString()} تومان</span>
            </div>
            <div class="info-row">
                <span class="info-label">موجودی جدید:</span>
                <span class="info-value" style="color: #059669;">${Number(newBalance || 0).toLocaleString()} تومان</span>
            </div>
            ${trackingCode ? `
            <div class="info-row">
                <span class="info-label">کد رهگیری:</span>
                <span class="info-value">${trackingCode}</span>
            </div>
            ` : ''}
        </div>
        <div>
            <a href="/dashboard" class="btn">رفتن به داشبورد</a>
            <a href="/" class="btn btn-outline">بازگشت به خانه</a>
        </div>
    </div>
</body>
</html>
    `;
        return res.send(html);
    }



    // ============================================================
    // 11. صفحه خطا
    // ============================================================
    @Get('failed')
    @ApiOperation({ summary: 'صفحه خطای خرید اعتبار' })
    async paymentFailed(
        @Query('transaction_id') transactionId: string,
        @Query('message') message: string,
        @Res() res: Response,
    ) {
        const errorMessage = message || 'خطای ناشناخته در پرداخت';

        const html = `
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>خطا در خرید اعتبار - دِیمَت</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Vazirmatn', 'Segoe UI', Tahoma, sans-serif;
            background: linear-gradient(135deg, #610000 0%, #8b0000 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .container {
            background: white;
            border-radius: 16px;
            padding: 40px;
            max-width: 500px;
            width: 100%;
            text-align: center;
        }
        .icon { font-size: 80px; color: #ef4444; margin-bottom: 20px; }
        h1 { color: #dc2626; margin-bottom: 16px; font-size: 28px; }
        .error-card {
            background: #fef2f2;
            border: 2px solid #fecaca;
            border-radius: 12px;
            padding: 20px;
            margin: 20px 0;
            text-align: right;
        }
        .error-message { color: #dc2626; font-weight: 500; line-height: 1.6; }
        .info-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #fecaca;
        }
        .info-row:last-child { border-bottom: none; }
        .info-label { color: #78716c; font-weight: 500; }
        .info-value { color: #1e293b; font-weight: 600; }
        .btn {
            display: inline-block;
            background: #610000;
            color: white;
            padding: 12px 32px;
            border-radius: 8px;
            text-decoration: none;
            font-weight: 600;
            margin: 8px;
        }
        .btn:hover { background: #8b0000; }
        .btn-outline {
            background: transparent;
            color: #610000;
            border: 2px solid #610000;
        }
        .btn-outline:hover { background: #610000; color: white; }
        .note {
            color: #78716c;
            margin: 16px 0;
            font-size: 14px;
            line-height: 1.6;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">❌</div>
        <h1>خطا در خرید اعتبار</h1>
        <div class="error-card">
            <div class="error-message">${errorMessage}</div>
            ${transactionId ? `
            <div class="info-row">
                <span class="info-label">شناسه تراکنش:</span>
                <span class="info-value">${transactionId}</span>
            </div>
            ` : ''}
        </div>
        <p class="note">در صورت کسر مبلغ از حساب شما، وجه پرداختی طی ۷۲ ساعت کاری به حساب شما بازگردانده خواهد شد.</p>
        <div>
            <a href="/credit/purchase" class="btn">تلاش مجدد</a>
            <a href="/" class="btn btn-outline">بازگشت به خانه</a>
        </div>
    </div>
</body>
</html>
    `;
        return res.send(html);
    }



// ============================================================
// 🔹 دریافت لیست فیش‌های بازار (مدیر بازار)
// ============================================================
    @Get('arm/:slug/payments')
    @UseGuards(JwtAuthGuard, ArmManagerGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'دریافت لیست فیش‌های بازار (مدیر بازار)' })
    async getArmPayments(
        @Param('slug') slug: string,
        @Query('status') status?: 'pending' | 'approved' | 'rejected',
    ) {
        return this.creditService.getArmPayments(slug, status);
    }

// ============================================================
// 🔹 دریافت آمار مالی بازار (مدیر بازار)
// ============================================================
    @Get('arm/:slug/financial/stats')
    @UseGuards(JwtAuthGuard, ArmAdminGuard) // ← ArmManagerGuard رو با ArmAdminGuard عوض کن
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'دریافت آمار مالی بازار (مدیر بازار)' })
    async getArmFinancialStats(@Param('slug') slug: string) {
        return this.creditService.getArmFinancialStats(slug);
    }

// src/credit/credit.controller.ts

// ============================================================
// گزارش پرداخت‌ها
// ============================================================
    @Get('payments')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'دریافت تاریخچه پرداخت‌های کاربر' })
    async getPaymentTransactions(
        @CurrentUser() user: any,
        @Query('limit') limit = 10,
        @Query('offset') offset = 0,
        @Query('paymentMethod') paymentMethod?: 'online' | 'manual',
        @Query('status') status?: 'pending' | 'success' | 'failed' | 'approved' | 'rejected',
    ) {
        return this.creditService.getPaymentTransactions(
            user.id,
            Number(limit),
            Number(offset),
            paymentMethod,
            status,
        );
    }

// ============================================================
// گزارش اعتبارات (تغییرات موجودی)
// ============================================================
    @Get('report')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'دریافت گزارش تغییرات موجودی اعتبار' })
    async getCreditReport(
        @CurrentUser() user: any,
        @Query('limit') limit = 10,
        @Query('offset') offset = 0,
        @Query('type') type?: 'purchase' | 'spend' | 'bonus' | 'refund',
    ) {
        return this.creditService.getCreditReport(
            user.id,
            Number(limit),
            Number(offset),
            type,
        );
    }
}


