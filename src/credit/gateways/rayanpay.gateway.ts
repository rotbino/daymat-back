// src/payment/gateways/rayanpay.gateway.ts
import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import {
    AbstractPaymentGateway,
    PaymentInitiateParams,
    PaymentInitiateResult,
    PaymentVerifyParams,
    PaymentVerifyResult,
    PaymentRefundParams,
    PaymentRefundResult,
    PaymentStatusResult,
} from './abstract-payment.gateway';

export interface RayanPayConfig {
    pin: string;
    callbackUrl: string;
    sandbox?: boolean;
}

interface RayanPayCreateResponse {
    status: string;
    code: string;
    transid: string;
    message?: string;
}

interface RayanPayVerifyResponse {
    status: string;
    code: string;
    card_hash?: string;
    card_pan?: string;
    ref_id?: number;
    message?: string;
}

@Injectable()
export class RayanPayGateway extends AbstractPaymentGateway {
    private readonly baseUrl: string;

    constructor(
        private readonly config: RayanPayConfig,
        private readonly httpService: HttpService,
    ) {
        super();
        this.baseUrl = 'https://panel.aqayepardakht.ir/api/v2/';


    }

    getName(): string {
        return 'RayanPay';
    }

    async initiatePayment(params: PaymentInitiateParams): Promise<PaymentInitiateResult> {
        try {
            this.validateAmount(params.amount);

            const requestData = {
                pin: this.config.pin,
                amount: params.amount,
                callback: params.callback_url || this.config.callbackUrl,
                invoice_id: String(params.order_id).slice(-10),
                mobile: params.metadata?.mobile || '',
            };



            const response = await firstValueFrom(
                this.httpService.post<RayanPayCreateResponse>(
                    `${this.baseUrl}create`,
                    requestData,
                    {
                        headers: { 'Content-Type': 'application/json' },
                    },
                ),
            );



            if (response.data.status === 'success' && response.data.transid) {
                const paymentUrl = this.config.sandbox
                    ? `https://panel.aqayepardakht.ir/startpay/sandbox/${response.data.transid}`
                    : `https://panel.aqayepardakht.ir/startpay/${response.data.transid}`;


                return {
                    success: true,
                    payment_url: paymentUrl,
                    transaction_id: params.order_id,
                    gateway_reference: response.data.transid,
                    amount: params.amount,
                };
            } else {

                return {
                    success: false,
                    payment_url: '',
                    transaction_id: params.order_id,
                    gateway_reference: '',
                    amount: params.amount,
                    error_code: response.data.code || 'unknown',
                    error_message: response.data.message || 'خطا در اتصال به درگاه',
                };
            }
        } catch (error) {


            return {
                success: false,
                payment_url: '',
                transaction_id: params.order_id,
                gateway_reference: '',
                amount: params.amount,
                error_code: String(error.response?.status || '500'),
                error_message: error.response?.data?.message || error.message || 'خطا در اتصال به درگاه پرداخت',
            };
        }
    }

    async verifyPayment(params: PaymentVerifyParams): Promise<PaymentVerifyResult> {
        try {
            const verifyData = {
                pin: this.config.pin,
                transid: params.gateway_reference,
                amount: params.amount,
            };



            const response = await firstValueFrom(
                this.httpService.post<RayanPayVerifyResponse>(
                    `${this.baseUrl}verify`,
                    verifyData,
                    {
                        headers: { 'Content-Type': 'application/json' },
                    },
                ),
            );


            if (response.data.status === 'success') {
                return {
                    success: true,
                    transaction_id: params.transaction_id,
                    amount: params.amount,
                    gateway_reference: params.gateway_reference,
                    card_hash: response.data.card_hash,
                    card_number: response.data.card_pan,
                    tracking_code: response.data.ref_id?.toString(),
                };
            } else {
                return {
                    success: false,
                    transaction_id: params.transaction_id,
                    amount: params.amount,
                    gateway_reference: params.gateway_reference,
                    error_code: response.data.code || 'unknown',
                    error_message: response.data.message || 'تأیید پرداخت ناموفق بود',
                };
            }
        } catch (error) {

            return {
                success: false,
                transaction_id: params.transaction_id,
                amount: params.amount,
                gateway_reference: params.gateway_reference,
                error_code: '500',
                error_message: error.message || 'خطا در تأیید پرداخت',
            };
        }
    }

    async refundPayment(params: PaymentRefundParams): Promise<PaymentRefundResult> {
        return {
            success: false,
            gateway_reference: params.transaction_id,
            error_code: 'NOT_SUPPORTED',
            error_message: 'بازگشت وجه از این درگاه پشتیبانی نمی‌شود',
        };
    }

    async getPaymentStatus(transactionId: string): Promise<PaymentStatusResult> {
        try {
            const response = await firstValueFrom(
                this.httpService.post(
                    `${this.baseUrl}inquiry`,
                    { pin: this.config.pin, transid: transactionId },
                    { headers: { 'Content-Type': 'application/json' } },
                ),
            );

            return {
                status: response.data.status === 'success' ? 'SUCCESS' : 'PENDING',
                amount: response.data.amount || 0,
                gateway_reference: transactionId,
                transaction_date: response.data.date ? new Date(response.data.date) : undefined,
            };
        } catch (error) {
            return { status: 'PENDING', amount: 0, gateway_reference: transactionId };
        }
    }
}