// src/payment/gateways/zarinpal.gateway.ts
import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AbstractPaymentGateway, PaymentInitiateParams, PaymentInitiateResult, PaymentVerifyParams, PaymentVerifyResult, PaymentRefundParams, PaymentRefundResult, PaymentStatusResult } from './abstract-payment.gateway';

export interface ZarinpalConfig {
    merchantId: string;
    sandbox?: boolean;
    callbackUrl: string;
}

interface ZarinpalRequestResponse {
    data: {
        code: number;
        message: string;
        authority: string;
        fee_type: string;
        fee: number;
    };
}

interface ZarinpalVerifyResponse {
    data: {
        code: number;
        message: string;
        card_hash: string;
        card_pan: string;
        ref_id: number;
        fee_type: string;
        fee: number;
    };
}

@Injectable()
export class ZarinpalGateway extends AbstractPaymentGateway {
    private readonly baseUrl: string;

    constructor(
        private readonly config: ZarinpalConfig,
        private readonly httpService: HttpService,
    ) {
        super();
        this.baseUrl = config.sandbox
            ? 'https://sandbox.zarinpal.com/pg/rest/WebGate/'
            : 'https://api.zarinpal.com/pg/rest/WebGate/';
    }

    getName(): string {
        return 'Zarinpal';
    }

    async initiatePayment(params: PaymentInitiateParams): Promise<PaymentInitiateResult> {
        try {
            this.validateAmount(params.amount);

            const requestData = {
                merchant_id: this.config.merchantId,
                amount: params.amount / 10,
                callback_url: params.callback_url || this.config.callbackUrl,
                description: params.description || `Payment for order ${params.order_id}`,
                metadata: {
                    order_id: params.order_id,
                    user_id: params.user_id,
                    ...params.metadata
                }
            };

            const response = await firstValueFrom(
                this.httpService.post<ZarinpalRequestResponse>(
                    `${this.baseUrl}PaymentRequest.json`,
                    requestData
                )
            );

            if (response.data.data.code === 100) {
                const paymentUrl = this.config.sandbox
                    ? `https://sandbox.zarinpal.com/pg/StartPay/${response.data.data.authority}`
                    : `https://www.zarinpal.com/pg/StartPay/${response.data.data.authority}`;

                return {
                    success: true,
                    payment_url: paymentUrl,
                    transaction_id: params.order_id,
                    gateway_reference: response.data.data.authority,
                    amount: params.amount
                };
            } else {
                return {
                    success: false,
                    payment_url: '',
                    transaction_id: params.order_id,
                    gateway_reference: '',
                    amount: params.amount,
                    error_code: response.data.data.code.toString(),
                    error_message: this.getErrorMessage(response.data.data.code)
                };
            }
        } catch (error) {
            return {
                success: false,
                payment_url: '',
                transaction_id: params.order_id,
                gateway_reference: '',
                amount: params.amount,
                error_code: '500',
                error_message: error.message
            };
        }
    }

    async verifyPayment(params: PaymentVerifyParams): Promise<PaymentVerifyResult> {
        try {
            const verifyData = {
                merchant_id: this.config.merchantId,
                authority: params.gateway_reference,
                amount: params.amount / 10,
            };

            const response = await firstValueFrom(
                this.httpService.post<ZarinpalVerifyResponse>(
                    `${this.baseUrl}PaymentVerification.json`,
                    verifyData
                )
            );

            if (response.data.data.code === 100 || response.data.data.code === 101) {
                return {
                    success: true,
                    transaction_id: params.transaction_id,
                    amount: params.amount,
                    gateway_reference: params.gateway_reference,
                    card_hash: response.data.data.card_hash,
                    card_number: response.data.data.card_pan,
                    tracking_code: response.data.data.ref_id.toString()
                };
            } else {
                return {
                    success: false,
                    transaction_id: params.transaction_id,
                    amount: params.amount,
                    gateway_reference: params.gateway_reference,
                    error_code: response.data.data.code.toString(),
                    error_message: this.getErrorMessage(response.data.data.code)
                };
            }
        } catch (error) {
            return {
                success: false,
                transaction_id: params.transaction_id,
                amount: params.amount,
                gateway_reference: params.gateway_reference,
                error_code: '500',
                error_message: error.message
            };
        }
    }

    async refundPayment(params: PaymentRefundParams): Promise<PaymentRefundResult> {
        return {
            success: false,
            gateway_reference: params.transaction_id,
            error_code: 'NOT_SUPPORTED',
            error_message: 'Refund is not supported by this gateway. Please use merchant panel.'
        };
    }

    async getPaymentStatus(transactionId: string): Promise<PaymentStatusResult> {
        return {
            status: 'PENDING',
            amount: 0,
            gateway_reference: transactionId
        };
    }

    private getErrorMessage(code: number): string {
        const errors = {
            100: 'تراکنش با موفقیت انجام شد',
            '-9': 'خطای اعتبار سنجی',
            '-10': 'آی پی یا مرچنت کد پذیرنده صحیح نیست',
            '-11': 'مرچنت کد پذیرنده صحیح نیست',
            '-12': 'اطلاعات درخواستی صحیح نیست',
            '-15': 'تراکنش قبلا برگشت خورده است',
            '-16': 'سیستم موقتا قطع شده است',
            '-17': 'ثبت تراکنش ناموفق بود',
            '-18': 'آدرس بازگشت مشخص نشده است',
            '-19': 'فرمت درخواستی صحیح نیست',
            '-20': 'پذیرنده فعال نیست',
            '-21': 'درخواست از سمت آی پی نا معتبر ارسال شده است',
            '-22': 'درگاه پرداختی برای پذیرنده وجود ندارد',
            '-23': 'اطلاعات پذیرنده صحیح نیست',
            '-24': 'مبلغ تراکنش کمتر از حد مجاز است',
            '-25': 'مبلغ تراکنش بیشتر از حد مجاز است',
            '-26': 'درخواست تکراری است',
            '-27': 'توکن منقضی شده است',
            '-30': 'اجازه دسترسی به تسویه اشتراکی را ندارید',
            '-31': 'حساب بانکی تسویه را به پنل خود اضافه کنید',
            '-32': 'مبلغ تسویه بیشتر از موجودی است',
            '-33': 'درخواست تسویه برای این تراکنش قبلا ثبت شده است',
            '-34': 'کد تراکنش صحیح نیست'
        };

        return errors[code] || `خطای ناشناخته: ${code}`;
    }
}