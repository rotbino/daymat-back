// src/credit/credit.service.ts
import {
    Injectable,
    BadRequestException,
    NotFoundException,
    ForbiddenException,
    Inject,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../prisma/prisma.service';
import { AbstractPaymentGateway } from './gateways/abstract-payment.gateway';
import { ZarinpalGateway } from './gateways/zarinpal.gateway';
import { RayanPayGateway } from './gateways/rayanpay.gateway';
import { PecGateway } from './gateways/parsian.gateway';
import {UpdateArmPaymentConfigDto} from "./credit.dto";

@Injectable()
export class CreditService {
    private gateway: AbstractPaymentGateway;

    constructor(
        private prisma: PrismaService,
        private httpService: HttpService,
        @Inject('PAYMENT_CONFIG') private config: any,
    ) {
        this.initializeGateway();
    }

    private initializeGateway() {
        switch (this.config.defaultGateway) {
            case 'zarinpal':
                this.gateway = new ZarinpalGateway(
                    this.config.gateways.zarinpal,
                    this.httpService,
                );
                break;
            case 'rayanpay':
                this.gateway = new RayanPayGateway(
                    this.config.gateways.rayanpay,
                    this.httpService,
                );
                break;
            case 'pec':
                this.gateway = new PecGateway(
                    this.config.gateways.pec,
                    this.httpService,
                );
                break;
            default:
                throw new Error('Payment gateway not configured');
        }
    }


// ============================================================
// 1. موجودی اعتبار کاربر
// ============================================================

    async getUserBalance(userId: string): Promise<{ balance: number; currency: string }> {
        const result = await this.prisma.credit.aggregate({
            where: {
                userId,
                status: 'success',  // ✅ فقط رکوردهای موفق
            },
            _sum: { creditCount: true },
        });

        return {
            balance: result._sum.creditCount || 0,
            currency: 'IRR',
        };
    }





    // ============================================================
    // 3. تأیید پرداخت آنلاین (Callback)
    // ============================================================


    async verifyPayment(authority: string, status: string) {
        const transaction = await this.prisma.credit.findFirst({
            where: {
                relatedEntityType: authority,
                transactionType: 'purchase',
            },
            include: {
                user: true,
            },
        });

        if (!transaction) {
            return {
                success: false,
                message: 'تراکنش یافت نشد',
                transaction_id: 'unknown',
            };
        }

        const existingMetadata = (transaction.metadata as any) || {};

        // ⭐ قبول کردن هر دو فرمت status: هم "OK" (پارسیان) و هم "1" (آقای پرداخت)
        const isSuccess = status === 'OK' || status === '1';

        if (!isSuccess) {
            await this.prisma.credit.update({
                where: { id: transaction.id },
                data: {
                    status: 'failed',
                    metadata: {
                        ...existingMetadata,
                        failed_at: new Date().toISOString(),
                        status: 'FAILED',
                    },
                },
            });
            return {
                success: false,
                message: 'پرداخت توسط کاربر لغو یا ناموفق بود',
                transaction_id: transaction.id,
            };
        }

        const verifyParams = {
            transaction_id: transaction.id,
            gateway_reference: authority,
            amount: transaction.amount,
        };

        const verifyResult = await this.gateway.verifyPayment(verifyParams);

        // src/credit/credit.service.ts - verifyPayment (بخش موفقیت)

        if (verifyResult.success) {
            // src/credit/credit.service.ts - verifyPayment (بخش موفقیت)

            if (verifyResult.success) {
                await this.prisma.$transaction(async (prisma) => {
                    // ۱. به‌روزرسانی رکورد اولیه
                    await prisma.credit.update({
                        where: { id: transaction.id },
                        data: {
                            status: 'success',
                            metadata: {
                                ...existingMetadata,
                                verified_at: new Date().toISOString(),
                                tracking_code: verifyResult.tracking_code,
                                gateway_reference: authority,
                            },
                        },
                    });

                    // ۲. ایجاد رکورد جدید برای واریز اعتبار
                    const metadata = (transaction.metadata as any) || {};

                    await prisma.credit.create({
                        data: {
                            userId: transaction.userId,
                            businessId: transaction.businessId,
                            armId: transaction.armId,
                            amount: transaction.amount,
                            currency: transaction.currency || 'IRR',
                            creditCount: transaction.creditCount || 0,
                            pricePerCredit: transaction.pricePerCredit || 0,
                            creditType: 'purchased',
                            status: 'success',
                            transactionType: 'purchase',
                            description: transaction.description,
                            relatedEntityId: transaction.id,
                            relatedEntityType: 'Credit',
                            metadata: {
                                ...metadata,
                                verified_at: new Date().toISOString(),
                                tracking_code: verifyResult.tracking_code,
                                is_verified: true,
                            },
                        },
                    });
                });
            }


            const balance = await this.getUserBalance(transaction.userId);

            return {
                success: true,
                message: 'پرداخت با موفقیت انجام شد و اعتبار به کیف پول شما اضافه شد',
                transaction_id: transaction.id,
                amount: transaction.amount,
                newBalance: balance.balance,
                tracking_code: verifyResult.tracking_code,
            };
        } else {
            await this.prisma.credit.update({
                where: { id: transaction.id },
                data: {
                    metadata: {
                        ...existingMetadata,
                        error_code: verifyResult.error_code,
                        error_message: verifyResult.error_message,
                        failed_at: new Date().toISOString(),
                        status: 'FAILED',
                    },
                },
            });

            return {
                success: false,
                message: verifyResult.error_message || 'پرداخت ناموفق بود',
                transaction_id: transaction.id,
            };
        }
    }



// ============================================================
// 4. مصرف اعتبار (با تفکیک Business)
// ============================================================
    async spendCredit(
        userId: string,
        businessId: string | undefined,
        amount: number,
        transactionType: string,
        description: string,
        relatedEntityId?: string,
        relatedEntityType?: string,
    ) {
        const { balance } = await this.getUserBalance(userId);

        if (balance < amount) {
            throw new BadRequestException({
                errorCode: 'INSUFFICIENT_CREDIT',
                message: `اعتبار کافی نیست. موجودی: ${balance}، نیاز: ${amount}`,
            });
        }

        return this.prisma.credit.create({
            data: {
                userId: userId,
                businessId: businessId || null,
                armId: null,
                amount: 0,                              // ← مبلغ صفر (مصرف اعتبار)
                currency: 'IRR',                        // ← واحد پول
                creditCount: -amount,                   // ← منفی (مصرف)
                pricePerCredit: null,                   // ← قیمت هر اعتبار (برای مصرف مشخص نیست)
                creditType: 'purchased',                // ← از اعتبار خریداری شده استفاده میکنه
                transactionType: transactionType,
                description: description,
                relatedEntityId: relatedEntityId || null,
                relatedEntityType: relatedEntityType || null,
                metadata: {
                    spent_at: new Date().toISOString(),
                    amount: amount,
                    transactionType: transactionType,
                },
            },
        });
    }

    // ============================================================
    // 5. تاریخچه تراکنش‌های کاربر
    // ============================================================
    async getUserTransactions(userId: string, limit = 20, offset = 0) {
        const transactions = await this.prisma.credit.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: limit,
            skip: offset,
            include: {
                business: {
                    select: { id: true, name: true },
                },
            },
        });

        const total = await this.prisma.credit.count({
            where: { userId },
        });

        return {
            transactions,
            pagination: {
                limit,
                offset,
                total,
            },
        };
    }

    // ============================================================
    // 6. گزارش مصرف هر Business
    // ============================================================
    async getBusinessConsumption(businessId: string) {
        const result = await this.prisma.credit.aggregate({
            where: {
                businessId,
                amount: { lt: 0 },
            },
            _sum: { amount: true },
        });

        return {
            totalConsumed: Math.abs(result._sum.amount || 0),
        };
    }





    // ============================================================
    // 9. لیست درخواست‌های خرید دستی (برای مدیر)
    // ============================================================
    async getManualRequests(
        armId: string,
        adminUserId: string,
        status?: 'pending' | 'approved' | 'rejected',
    ) {
        // ۱. بررسی مدیر بودن
        const membership = await this.prisma.armMembership.findFirst({
            where: {
                armId,
                userId: adminUserId,
                role: 'arm_owner',
                status: 'active',
            },
        });

        if (!membership) {
            throw new ForbiddenException({
                errorCode: 'FORBIDDEN',
                message: 'شما دسترسی به این بخش ندارید',
            });
        }

        // ۲. دریافت درخواست‌ها
        return this.prisma.creditRequest.findMany({
            where: {
                armId,
                ...(status && { status }),
            },
            include: {
                user: {
                    select: { id: true, fullName: true, phone: true },
                },
                business: {
                    select: { id: true, name: true },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
    }


// ============================================================
// 10. دریافت اطلاعات بانکی بازار (برای نمایش به کاربر)
// ============================================================
    async getArmBankInfo(armId: string) {
        const arm = await this.prisma.arm.findUnique({
            where: { id: armId },
            select: { config: true },
        });

        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازار یافت نشد',
            });
        }

        const config = arm.config as any || {};
        const payment = config.payment || {};
        const manual = payment.manual || {};

        return {
            paymentMode: payment.paymentMode || 'both',
            manualEnabled: manual.enabled || false,
            cardNumber: manual.cardNumber || null,
            shebaNumber: manual.shebaNumber || null,
            accountOwner: manual.accountOwner || null,
            bankName: manual.bankName || null,
            instructions: manual.instructions || null,
        };
    }






















پپ

    // src/credit/credit.service.ts

// ============================================================
// 1. متد کمکی برای خواندن از config
// ============================================================
    private getConfigValue<T>(config: any, path: string, defaultValue: T): T {
        const keys = path.split('.');
        let value = config;
        for (const key of keys) {
            if (value === undefined || value === null) return defaultValue;
            value = value[key];
        }
        return value !== undefined && value !== null ? value : defaultValue;
    }

// ============================================================
// 2. دریافت تنظیمات پرداخت از config بازار
// ============================================================
    // src/credit/credit.service.ts

// ✅ متد getArmPaymentConfig
    async getArmPaymentConfig(armId: string) {
        const arm = await this.prisma.arm.findUnique({
            where: { id: armId },
            select: { config: true },
        });

        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازار یافت نشد',
            });
        }

        const config = arm.config as any || {};
        const paymentConfig = config.payment || {};

        return {
            defaultGateway: paymentConfig.defaultGateway || 'pec',
            gateways: paymentConfig.gateways || [],
            settlementAccount: paymentConfig.settlementAccount || null,
            currency: config.economy?.currency || 'IRR',
        };
    }

// ✅ متد getCallbackUrl
    private getCallbackUrl(gatewayConfig: any): string {
        return gatewayConfig?.callbackUrl || 'http://localhost:3000/credit/verify';
    }

// ✅ متد getDefaultGateway
    private getDefaultGateway(): AbstractPaymentGateway {
        const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3011';

        // ✅ اصلاح callbackUrl
        return new PecGateway(
            {
                pin: 'sandbox',
                callbackUrl: `${BACKEND_URL}/credit/verify`,
                sandbox: true,
            },
            this.httpService,
        );
    }

// ✅ متد createGateway
    private createGateway(gatewayConfig: any): AbstractPaymentGateway {
        const name = gatewayConfig.name || 'pec';
        switch (name) {
            case 'zarinpal':
                return new ZarinpalGateway(
                    {
                        merchantId: gatewayConfig.merchantId || '',
                        sandbox: gatewayConfig.sandbox ?? true,
                        callbackUrl: gatewayConfig.callbackUrl || '',
                    },
                    this.httpService,
                );
            case 'rayanpay':
                return new RayanPayGateway(
                    {
                        pin: gatewayConfig.pin || '',
                        sandbox: gatewayConfig.sandbox ?? true,
                        callbackUrl: gatewayConfig.callbackUrl || '',
                    },
                    this.httpService,
                );
            case 'pec':
            default:
                return new PecGateway(
                    {
                        pin: gatewayConfig.pin || '',
                        sandbox: gatewayConfig.sandbox ?? true,
                        callbackUrl: gatewayConfig.callbackUrl || '',
                    },
                    this.httpService,
                );
        }
    }

// ============================================================
// 3. خرید اعتبار (با تنظیمات پرداخت بازار)
// ============================================================
    // src/credit/credit.service.ts

// src/credit/credit.service.ts

    // src/credit/credit.service.ts

    // src/credit/credit.service.ts

    async initiatePurchase(
        userId: string,
        amount: number,
        armId?: string,
        callbackUrl?: string,
        description?: string,
        creditCount?: number,
        creditPrice?: number,
        currency?: string,
        gatewayName?: string,
    ) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
        });

        if (!user) {
            throw new NotFoundException({
                errorCode: 'USER_NOT_FOUND',
                message: 'کاربر یافت نشد',
            });
        }

        // خواندن تنظیمات پرداخت از بازار
        let gateway: AbstractPaymentGateway;
        let gatewayConfig: any = null;

        // خواندن تنظیمات ارز از بازار
        let finalCurrency = currency || 'IRR';
        let finalCreditPrice = creditPrice || 2000;

        if (armId) {
            const armPayment = await this.getArmPaymentConfig(armId);

            // ✅ اگر کاربر درگاه خاصی انتخاب کرده، از آن استفاده کن
            if (gatewayName) {
                gatewayConfig = armPayment.gateways.find(
                    (g: any) => g.name === gatewayName && g.enabled !== false
                );
            }

            // اگر درگاه انتخاب شده پیدا نشد یا کاربر انتخاب نکرده، از درگاه پیش‌فرض استفاده کن
            if (!gatewayConfig) {
                gatewayConfig = armPayment.gateways.find(
                    (g: any) => g.name === armPayment.defaultGateway && g.enabled !== false
                );
            }

            // اگر درگاه پیش‌فرض پیدا نشد، از اولین درگاه فعال استفاده کن
            if (!gatewayConfig) {
                gatewayConfig = armPayment.gateways.find(
                    (g: any) => g.enabled !== false
                );
            }

            if (gatewayConfig) {
                gateway = this.createGateway(gatewayConfig);
            } else {
                gatewayConfig = armPayment.gateways[0];
                if (gatewayConfig) {
                    gateway = this.createGateway(gatewayConfig);
                }
            }

            // خواندن تنظیمات ارز از بازار
            const arm = await this.prisma.arm.findUnique({
                where: { id: armId },
                select: { config: true },
            });
            if (arm?.config) {
                const config = arm.config as any;
                finalCurrency = config.economy?.currency || 'IRR';
                finalCreditPrice = config.economy?.creditPrice || 2000;
            }
        }

        if (!gateway) {
            gateway = this.getDefaultGateway();
            gatewayConfig = {
                name: gateway.getName(),
                callbackUrl: this.getCallbackUrl(null),
            };
        }

        // محاسبه تعداد اعتبار
        const finalCreditCount = creditCount || Math.floor(amount / finalCreditPrice);

        // ✅ ثبت تراکنش اولیه با فیلدهای جدید
        // src/credit/credit.service.ts - initiatePurchase

// ✅ ثبت تراکنش اولیه با وضعیت PENDING (هنوز اعتباری به کاربر اضافه نشده)
        // src/credit/credit.service.ts - initiatePurchase

        const transaction = await this.prisma.credit.create({
            data: {
                userId: userId,
                amount: amount,
                currency: finalCurrency,
                creditCount: finalCreditCount,
                pricePerCredit: finalCreditPrice,
                creditType: 'purchased',
                status: 'pending',  // ✅ وضعیت pending
                transactionType: 'purchase',
                description: description || `خرید ${finalCreditCount} اعتبار...`,
                armId: armId || null,
                relatedEntityId: null,
                relatedEntityType: null,
                metadata: {
                    gateway: gateway.getName(),
                    currency: finalCurrency,
                    initiated_at: new Date().toISOString(),
                    creditCount: finalCreditCount,
                    creditPrice: finalCreditPrice,
                    paymentMethod: 'online',
                    paymentMode: 'online',
                    product_type: 'credit',
                    requested_gateway: gatewayName || null,
                },
            },
        });

        // ✅ اعتبارسنجی کلید درگاه قبل از پرداخت
        if (gatewayConfig) {
            const isRayanPay = gatewayConfig.name === 'rayanpay';
            const isZarinpal = gatewayConfig.name === 'zarinpal';
            const isPec = gatewayConfig.name === 'pec';

            let hasValidKey = false;
            let missingField = '';

            if (isRayanPay) {
                // ⭐ توی sandbox پین 'sandbox' معتبره
                if (gatewayConfig.sandbox) {
                    hasValidKey = gatewayConfig.pin && gatewayConfig.pin !== '';
                } else {
                    hasValidKey = gatewayConfig.pin && gatewayConfig.pin !== '' && gatewayConfig.pin !== 'sandbox';
                }
                if (!hasValidKey) missingField = 'PIN';
            } else if (isZarinpal) {
                hasValidKey = gatewayConfig.merchantId && gatewayConfig.merchantId !== '';
                if (!hasValidKey) missingField = 'Merchant ID';
            } else if (isPec) {
                hasValidKey = gatewayConfig.pin && gatewayConfig.pin !== '';
                if (!hasValidKey) missingField = 'PIN';
            } else {
                // درگاه ناشناخته - فرض کن کلید معتبر نیست
                hasValidKey = false;
                missingField = 'کلید';
            }

            // ✅ اگر کلید معتبر نباشد، خطا بده
            if (!hasValidKey) {
                const gatewayNameMap: Record<string, string> = {
                    'rayanpay': 'رایان‌پی',
                    'zarinpal': 'زرین‌پال',
                    'pec': 'پارسیان',
                };

                const displayName = gatewayNameMap[gatewayConfig.name] || gatewayConfig.name;

                throw new BadRequestException({
                    errorCode: 'PAYMENT_GATEWAY_INVALID_KEY',
                    message: `مدیر بازار کلید درگاه ${displayName} (${missingField}) را تنظیم نکرده است. لطفاً از روش کارت به کارت استفاده کنید.`,
                    data: {
                        gateway: gatewayConfig.name,
                        missingField: missingField,
                        suggestion: 'manual_payment',
                    },
                });
            }
        }

        // ✅ آماده‌سازی پارامترهای پرداخت با BACKEND_URL
        const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3011';
        const finalCallbackUrl = callbackUrl || gatewayConfig?.callbackUrl || `${BACKEND_URL}/credit/verify`;

        const paymentParams = {
            amount: amount,
            order_id: transaction.id,
            user_id: userId,
            callback_url: finalCallbackUrl,
            description: description || `خرید ${finalCreditCount} اعتبار برای کاربر ${user.fullName}`,
            metadata: {
                user_id: userId,
                transaction_id: transaction.id,
                arm_id: armId,
                creditCount: finalCreditCount,
            },
        };

        try {
            // ✅ اجرای پرداخت با گیت‌وی انتخاب شده
            const paymentResult = await gateway.initiatePayment(paymentParams);

            if (!paymentResult.success) {
                // ✅ هندل کردن خطاهای درگاه
                const errorMessage = paymentResult.error_message || 'خطا در اتصال به درگاه پرداخت';

                // بررسی خطاهای خاص درگاه
                if (paymentResult.error_code === '403' ||
                    errorMessage.includes('403') ||
                    errorMessage.includes('دسترسی') ||
                    errorMessage.includes('مجاز') ||
                    errorMessage.includes('تراکنش توسط کاربر لغو شد')) {

                    throw new BadRequestException({
                        errorCode: 'PAYMENT_GATEWAY_ACCESS_DENIED',
                        message: 'ارتباط با درگاه پرداخت برقرار نشد. لطفاً از روش کارت به کارت استفاده کنید.',
                        data: {
                            gateway: gateway.getName(),
                            error_code: paymentResult.error_code,
                            suggestion: 'manual_payment',
                        },
                    });
                }

                throw new BadRequestException({
                    errorCode: 'PAYMENT_GATEWAY_ERROR',
                    message: errorMessage,
                    data: {
                        gateway: gateway.getName(),
                        error_code: paymentResult.error_code,
                    },
                });
            }

            // ✅ به‌روزرسانی تراکنش بعد از دریافت پاسخ از درگاه
            await this.prisma.credit.update({
                where: { id: transaction.id },
                data: {
                    relatedEntityType: paymentResult.gateway_reference, // ⭐ اضافه کن
                    relatedEntityId: null, // ⭐ اینو null کن
                    metadata: {
                        ...(transaction.metadata as any || {}),
                        gateway_reference: paymentResult.gateway_reference,
                        payment_url: paymentResult.payment_url,
                        status: 'PENDING',
                    },
                },
            });

            return {
                transaction_id: transaction.id,
                payment_url: paymentResult.payment_url,
                gateway_reference: paymentResult.gateway_reference,
                amount: amount,
                creditCount: finalCreditCount,
                currency: finalCurrency,
                creditPrice: finalCreditPrice,
                gateway: gateway.getName(),
            };
        } catch (error) {
            // ✅ هندل کردن خطاهای غیرمنتظره
            console.error('Payment initiation error:', error);

            // اگر خطا از نوع BadRequestException است، دوباره throw کن
            if (error instanceof BadRequestException) {
                throw error;
            }

            // خطای شبکه یا خطای دیگر
            throw new BadRequestException({
                errorCode: 'PAYMENT_INITIATION_FAILED',
                message: 'خطا در شروع فرآیند پرداخت. لطفاً مجدداً تلاش کنید یا از روش کارت به کارت استفاده کنید.',
                data: {
                    error: error.message,
                    suggestion: 'manual_payment',
                },
            });
        }
    }




// ============================================================
// به‌روزرسانی تنظیمات پرداخت بازار (فقط مدیر بازار)
// ============================================================
    async updatePaymentConfig(
        armId: string,
        userId: string,
        dto: UpdateArmPaymentConfigDto,
    ) {
        // ۱. بررسی مدیر بودن کاربر
        const membership = await this.prisma.armMembership.findFirst({
            where: {
                armId,
                userId,
                role: 'arm_owner',
                status: 'active',
            },
        });

        if (!membership) {
            throw new ForbiddenException({
                errorCode: 'NOT_ARM_ADMIN',
                message: 'شما مدیر این بازار نیستید',
            });
        }

        // ۲. دریافت config فعلی
        const arm = await this.prisma.arm.findUnique({
            where: { id: armId },
            select: { config: true },
        });

        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازار یافت نشد',
            });
        }

        const currentConfig = arm.config as any || {};

        // ۳. به‌روزرسانی بخش payment
        const updatedConfig = {
            ...currentConfig,
            payment: {
                ...currentConfig.payment,
                ...dto,
            },
        };

        return this.prisma.arm.update({
            where: { id: armId },
            data: { config: updatedConfig as any },
        });
    }
// src/credit/credit.service.ts

// ============================================================
// دریافت روش‌های پرداخت فعال بازار
// ============================================================
    async getPaymentMethods(armId: string) {
        const arm = await this.prisma.arm.findUnique({
            where: { id: armId },
            select: { config: true },
        });

        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازار یافت نشد',
            });
        }

        const config = arm.config as any || {};
        const payment = config.payment || {};
        const manual = payment.manual || {};

        return {
            paymentMode: payment.paymentMode || 'both',
            onlineAvailable: payment.paymentMode !== 'manual_only' && payment.gateways?.length > 0,
            manualAvailable: payment.paymentMode !== 'online_only' && manual.enabled === true,
            manualConfig: {
                cardNumber: manual.cardNumber || null,
                shebaNumber: manual.shebaNumber || null,
                accountOwner: manual.accountOwner || null,
                bankName: manual.bankName || null,
                instructions: manual.instructions || null,
            },
            gateways: payment.gateways || [],
            defaultGateway: payment.defaultGateway || null,
            settlementAccount: payment.settlementAccount || null,
        };
    }



// ============================================================
//  پرداخت کارت به کارت (فیشی)
// ============================================================
    // src/credit/credit.service.ts

    // src/credit/credit.service.ts

    // src/credit/credit.service.ts - initiateManualPurchase

    async initiateManualPurchase(
        userId: string,
        businessId: string,
        amount: number,
        armId?: string,
        receiptImage?: string,
        receiptNote?: string,
        creditCount?: number,
        creditPrice?: number,
        currency?: string,
    ) {
        // ۱. بررسی کسب‌وکار
        const business = await this.prisma.business.findFirst({
            where: { id: businessId, ownerUserId: userId },
        });
        if (!business) {
            throw new NotFoundException({
                errorCode: 'BUSINESS_NOT_FOUND',
                message: 'کسب‌وکار یافت نشد',
            });
        }

        // ۲. خواندن تنظیمات از بازار
        let finalCurrency = currency || 'IRR';
        let finalCreditPrice = creditPrice || 2000;

        if (armId) {
            const arm = await this.prisma.arm.findUnique({
                where: { id: armId },
                select: { config: true },
            });

            const config = arm?.config as any || {};
            const manual = config.payment?.manual || {};
            const paymentMode = config.payment?.paymentMode || 'both';
            const economy = config.economy || {};

            finalCurrency = economy.currency || 'IRR';
            finalCreditPrice = economy.creditPrice || 2000;

            if (paymentMode === 'online_only' || manual.enabled !== true) {
                throw new BadRequestException({
                    errorCode: 'MANUAL_PAYMENT_NOT_AVAILABLE',
                    message: 'روش پرداخت کارت به کارت در این بازار فعال نیست',
                });
            }
        }

        // ۳. بررسی وجود رسید
        if (!receiptImage) {
            throw new BadRequestException({
                errorCode: 'RECEIPT_REQUIRED',
                message: 'برای پرداخت کارت به کارت، ارسال تصویر رسید الزامی است',
            });
        }

        // ۴. محاسبه تعداد اعتبار
        const finalCreditCount = creditCount || Math.floor(amount / finalCreditPrice);
        const finalCreditPriceValue = creditPrice || (creditCount ? amount / creditCount : finalCreditPrice);

        // ۵. ✅ ایجاد درخواست خرید دستی (بدون واریز اعتبار)
        const request = await this.prisma.creditRequest.create({
            data: {
                userId,
                businessId,
                armId: armId || null,
                amount,
                status: 'pending',
                receiptImage,
                receiptNote: receiptNote || null,
                metadata: {
                    product_type: 'credit',
                    creditCount: finalCreditCount,
                    creditPrice: finalCreditPriceValue,
                    currency: finalCurrency,
                    paymentMethod: 'manual',
                    paymentMode: 'manual',
                    user_id: userId,
                    business_id: businessId,
                    requested_at: new Date().toISOString(),
                },
            },
        });

        return {
            request_id: request.id,
            status: 'pending',
            amount: amount,
            creditCount: finalCreditCount,
            currency: finalCurrency,
            creditPrice: finalCreditPriceValue,
            paymentMethod: 'manual',
            message: 'درخواست شما با موفقیت ثبت شد و منتظر تأیید مدیر است',
        };
    }

// ============================================================
// 🔹 ۱. دریافت لیست فیش‌های بازار
// ============================================================
    async getArmPayments(armSlug: string, status?: 'pending' | 'approved' | 'rejected') {
        const arm = await this.prisma.arm.findUnique({
            where: { slug: armSlug },
            select: { id: true },
        });

        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازار یافت نشد',
            });
        }

        return this.prisma.creditRequest.findMany({
            where: {
                armId: arm.id,
                ...(status && { status }),
            },
            include: {
                user: {
                    select: {
                        id: true,
                        fullName: true,
                        phone: true,
                    },
                },
                business: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
        });
    }

// ============================================================
// 🔹 ۲. دریافت آمار مالی بازار
// ============================================================
    // src/credit/credit.service.ts

    // src/credit/credit.service.ts

    async getArmFinancialStats(armSlug: string) {
        const arm = await this.prisma.arm.findUnique({
            where: { slug: armSlug },
            select: { id: true },
        });

        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازار یافت نشد',
            });
        }

        const purchaseTransactions = await this.prisma.credit.findMany({
            where: {
                armId: arm.id,
                transactionType: 'purchase',
            },
            select: {
                amount: true,
                creditCount: true,
                createdAt: true,
            },
        });

        let totalCredits = 0;
        let totalIncome = 0;
        let monthlyIncome = 0;
        let todayIncome = 0;
        let weekIncome = 0;

        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);
        const monthAgo = new Date(today);
        monthAgo.setDate(monthAgo.getDate() - 30);

        for (const tx of purchaseTransactions) {
            totalCredits += tx.creditCount || 0;
            totalIncome += tx.amount || 0;

            const txDate = new Date(tx.createdAt);
            if (txDate >= monthAgo) monthlyIncome += tx.amount || 0;
            if (txDate >= today) todayIncome += tx.amount || 0;
            if (txDate >= weekAgo) weekIncome += tx.amount || 0;
        }

        const pendingPayments = await this.prisma.creditRequest.count({
            where: {
                armId: arm.id,
                status: 'pending',
            },
        });

        // ✅ دریافت آخرین تراکنش‌ها بدون include
        const lastTransactionsRaw = await this.prisma.credit.findMany({
            where: { armId: arm.id },
            select: {
                id: true,
                creditCount: true,
                transactionType: true,
                createdAt: true,
                userId: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 10,
        });

        // ✅ واکشی جداگانه کاربران
        const userIds = [...new Set(lastTransactionsRaw.map(tx => tx.userId).filter(Boolean))];
        const users = await this.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, fullName: true },
        });
        const userMap = new Map(users.map(u => [u.id, u.fullName]));

        const lastTransactions = lastTransactionsRaw.map(tx => ({
            id: tx.id,
            amount: tx.creditCount || 0,
            type: tx.transactionType === 'purchase' ? 'purchase' : 'spend',
            user: userMap.get(tx.userId) || 'کاربر ناشناس',
            date: tx.createdAt,
            status: tx.transactionType === 'purchase' ? 'تکمیل شده' : 'مصرف شده',
        }));

        return {
            totalCredits,
            pendingPayments,
            totalIncome,
            monthlyIncome,
            todayIncome,
            weekIncome,
            lastTransactions,
        };
    }



// ============================================================
// دریافت تراکنش‌های پرداخت (خرید اعتبار)
// ============================================================

    // src/credit/credit.service.ts – بخش getPaymentTransactions

    async getPaymentTransactions(
        userId: string,
        limit: number = 10,
        offset: number = 0,
        paymentMethod?: 'online' | 'manual',
        status?: 'pending' | 'success' | 'failed' | 'approved' | 'rejected',
    ) {
        // ۱. تراکنش‌های خرید از جدول Credit (آنلاین و فیش‌های تایید شده)
        const creditWhere: any = {
            userId,
            transactionType: 'purchase',
        };
        if (status && ['pending', 'success', 'failed'].includes(status)) {
            creditWhere.status = status;
        }
        const onlinePurchases = await this.prisma.credit.findMany({
            where: creditWhere,
            select: {
                id: true,
                amount: true,
                creditCount: true,
                status: true,
                description: true,
                createdAt: true,
                metadata: true,
                armId: true,
            },
            orderBy: { createdAt: 'desc' },
        });

        // ۲. درخواست‌های فیشی از جدول CreditRequest (شامل rejectReason)
        const requestWhere: any = { userId };
        if (status && ['pending', 'approved', 'rejected'].includes(status)) {
            requestWhere.status = status;
        }
        const manualRequests = await this.prisma.creditRequest.findMany({
            where: requestWhere,
            select: {
                id: true,
                amount: true,
                status: true,
                createdAt: true,
                metadata: true,
                armId: true,
                receiptImage: true,
                receiptNote: true,
                rejectReason: true, // ✅ اضافه شد
            },
            orderBy: { createdAt: 'desc' },
        });

        // ۳. ترکیب داده‌ها
        let combined = [
            ...onlinePurchases.map(p => ({
                id: p.id,
                amount: p.amount,
                creditCount: p.creditCount,
                status: p.status,
                description: p.description || 'خرید اعتبار آنلاین',
                createdAt: p.createdAt,
                metadata: p.metadata || {},
                armId: p.armId,
                paymentMethod: (p.metadata as any)?.paymentMethod || 'online',
                isRequest: false,
            })),
            ...manualRequests.map(r => ({
                id: r.id,
                amount: r.amount,
                creditCount: (r.metadata as any)?.creditCount || 0,
                status: r.status,
                description: r.receiptNote || 'خرید اعتبار (فیش)',
                createdAt: r.createdAt,
                metadata: r.metadata || {},
                armId: r.armId,
                paymentMethod: 'manual',
                isRequest: true,
                rejectReason: r.rejectReason || null, // ✅ اضافه شد
            })),
        ];

        // ۴. فیلتر paymentMethod
        if (paymentMethod) {
            combined = combined.filter(tx => tx.paymentMethod === paymentMethod);
        }

        // ۵. مرتب‌سازی و صفحه‌بندی
        combined.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        const total = combined.length;
        const paginated = combined.slice(offset, offset + limit);

        return {
            transactions: paginated,
            pagination: { limit, offset, total },
        };
    }

// ============================================================
// گزارش تغییرات اعتبار (فقط تراکنش‌های موفق/تایید شده)
// ============================================================
    async getCreditReport(
        userId: string,
        limit: number = 10,
        offset: number = 0,
        type?: 'purchase' | 'spend' | 'bonus' | 'refund',
    ) {
        // ۱. دریافت تمام تراکنش‌های مؤثر بر موجودی (وضعیت success یا approved)
        const where: any = {
            userId,
            status: { in: ['success', 'approved'] },
        };
        if (type) {
            where.transactionType = type;
        }

        const credits = await this.prisma.credit.findMany({
            where,
            select: {
                id: true,
                amount: true,
                creditCount: true,
                transactionType: true,
                description: true,
                createdAt: true,
                metadata: true,
                armId: true,
            },
            orderBy: { createdAt: 'desc' },
        });

        // ۲. محاسبه مانده نهایی
        let runningBalance = 0;
        const transactionsWithBalance = credits.map(tx => {
            runningBalance += tx.creditCount;
            return {
                ...tx,
                balanceAfter: runningBalance,
            };
        });

        // ۳. صفحه‌بندی
        const total = transactionsWithBalance.length;
        const paginated = transactionsWithBalance.slice(offset, offset + limit);

        return {
            transactions: paginated,
            pagination: { limit, offset, total },
        };
    }



}