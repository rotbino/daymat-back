// src/credit/gateways/parsian.gateway.ts
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

export interface PecConfig {
    pin: string; // شناسه پذیرنده
    callbackUrl: string;
    sandbox?: boolean;
}

interface PecSaleRequest {
    LoginAccount: string;
    OrderId: number;
    Amount: number;
    CallBackUrl: string;
    AdditionalData?: string;
    Originator?: string; // شماره موبایل برای ارسال پیامک
}

interface PecSaleResponse {
    Status: number;
    Message: string;
    Token?: number;
}

interface PecConfirmRequest {
    LoginAccount: string;
    Token: number;
}

interface PecConfirmResponse {
    Status: number;
    CardNumberMasked: string;
    Token: number;
    RRN: number;
}

interface PecReversalRequest {
    LoginAccount: string;
    Token: number;
}

interface PecReversalResponse {
    Status: number;
    Message: string;
    Token: number;
}

@Injectable()
export class PecGateway extends AbstractPaymentGateway {
    private readonly baseUrls = {
        sandbox: {
            sale: 'https://pec.shaparak.ir/NewIPGServices/Sale/SaleService.asmx',
            confirm: 'https://pec.shaparak.ir/NewIPGServices/Confirm/ConfirmService.asmx',
            reversal: 'https://pec.shaparak.ir/NewIPGServices/Reverse/ReversalService.asmx',
            payment: 'https://pec.shaparak.ir/NewIPG/'
        },
        production: {
            sale: 'https://pec.shaparak.ir/NewIPGServices/Sale/SaleService.asmx',
            confirm: 'https://pec.shaparak.ir/NewIPGServices/Confirm/ConfirmService.asmx',
            reversal: 'https://pec.shaparak.ir/NewIPGServices/Reverse/ReversalService.asmx',
            payment: 'https://pec.shaparak.ir/NewIPG/'
        }
    };

    private readonly endpoints = {
        sale: 'SalePayment',
        confirm: 'ConfirmPayment',
        reversal: 'ReversalRequest'
    };

    constructor(
        private readonly config: PecConfig,
        private readonly httpService: HttpService,
    ) {
        super();
    }

    getName(): string {
        return 'Pec';
    }

    async initiatePayment(params: PaymentInitiateParams): Promise<PaymentInitiateResult> {
        try {
            this.validateAmount(params.amount);

            const baseUrl = this.config.sandbox ? this.baseUrls.sandbox : this.baseUrls.production;

            const requestData: PecSaleRequest = {
                LoginAccount: this.config.pin,
                OrderId: this.generateOrderId(params.order_id),
                Amount: params.amount,
                CallBackUrl: params.callback_url || this.config.callbackUrl,
                AdditionalData: params.metadata?.additionalData,
                Originator: params.metadata?.mobile
            };

            // ساخت SOAP request برای درگاه پارسیان
            const soapRequest = this.buildSoapRequest(this.endpoints.sale, requestData);

            const response = await firstValueFrom(
                this.httpService.post(
                    baseUrl.sale,
                    soapRequest,
                    {
                        headers: {
                            'Content-Type': 'text/xml; charset=utf-8',
                            'SOAPAction': `http://tempuri.org/${this.endpoints.sale}`
                        }
                    }
                )
            );

            const result = this.parseSoapResponse<PecSaleResponse>(response.data, this.endpoints.sale);

            if (result.Status === 0 && result.Token && result.Token > 0) {
                const paymentUrl = `${baseUrl.payment}?Token=${result.Token}`;

                return {
                    success: true,
                    payment_url: paymentUrl,
                    transaction_id: params.order_id,
                    gateway_reference: result.Token.toString(),
                    amount: params.amount,
                };
            } else {
                return {
                    success: false,
                    payment_url: '',
                    transaction_id: params.order_id,
                    gateway_reference: '',
                    amount: params.amount,
                    error_code: result.Status.toString(),
                    error_message: this.getErrorMessage(result.Status) || result.Message,
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
                error_message: error.message,
            };
        }
    }

    async verifyPayment(params: PaymentVerifyParams): Promise<PaymentVerifyResult> {
        try {
            const baseUrl = this.config.sandbox ? this.baseUrls.sandbox : this.baseUrls.production;

            // ابتدا تراکنش را تأیید می‌کنیم
            const confirmRequest: PecConfirmRequest = {
                LoginAccount: this.config.pin,
                Token: parseInt(params.gateway_reference),
            };

            const soapRequest = this.buildSoapRequest(this.endpoints.confirm, confirmRequest);

            const response = await firstValueFrom(
                this.httpService.post(
                    baseUrl.confirm,
                    soapRequest,
                    {
                        headers: {
                            'Content-Type': 'text/xml; charset=utf-8',
                            'SOAPAction': `http://tempuri.org/${this.endpoints.confirm}`
                        }
                    }
                )
            );

            const result = this.parseSoapResponse<PecConfirmResponse>(response.data, this.endpoints.confirm);

            if (result.Status === 0) {
                return {
                    success: true,
                    transaction_id: params.transaction_id,
                    amount: params.amount,
                    gateway_reference: params.gateway_reference,
                    card_number: result.CardNumberMasked,
                    tracking_code: result.RRN.toString(),
                };
            } else {
                return {
                    success: false,
                    transaction_id: params.transaction_id,
                    amount: params.amount,
                    gateway_reference: params.gateway_reference,
                    error_code: result.Status.toString(),
                    error_message: this.getErrorMessage(result.Status),
                };
            }
        } catch (error) {
            return {
                success: false,
                transaction_id: params.transaction_id,
                amount: params.amount,
                gateway_reference: params.gateway_reference,
                error_code: '500',
                error_message: error.message,
            };
        }
    }

    async refundPayment(params: PaymentRefundParams): Promise<PaymentRefundResult> {
        try {
            const baseUrl = this.config.sandbox ? this.baseUrls.sandbox : this.baseUrls.production;

            const reversalRequest: PecReversalRequest = {
                LoginAccount: this.config.pin,
                Token: parseInt(params.transaction_id), // در پارسیان از Token برای برگشت استفاده می‌شود
            };

            const soapRequest = this.buildSoapRequest(this.endpoints.reversal, reversalRequest);

            const response = await firstValueFrom(
                this.httpService.post(
                    baseUrl.reversal,
                    soapRequest,
                    {
                        headers: {
                            'Content-Type': 'text/xml; charset=utf-8',
                            'SOAPAction': `http://tempuri.org/${this.endpoints.reversal}`
                        }
                    }
                )
            );

            const result = this.parseSoapResponse<PecReversalResponse>(response.data, this.endpoints.reversal);

            if (result.Status === 0) {
                return {
                    success: true,
                    refund_id: result.Token.toString(),
                    gateway_reference: params.transaction_id,
                };
            } else {
                return {
                    success: false,
                    gateway_reference: params.transaction_id,
                    error_code: result.Status.toString(),
                    error_message: this.getErrorMessage(result.Status) || result.Message,
                };
            }
        } catch (error) {
            return {
                success: false,
                gateway_reference: params.transaction_id,
                error_code: '500',
                error_message: error.message,
            };
        }
    }

    async getPaymentStatus(transactionId: string): Promise<PaymentStatusResult> {
        // درگاه پارسیان سرویس مستقیم برای استعلام وضعیت ندارد
        // می‌توان از سرویس GetSalePaymentInfo استفاده کرد
        return {
            status: 'PENDING',
            amount: 0,
            gateway_reference: transactionId
        };
    }

    // ==================== متدهای کمکی ====================

    private generateOrderId(orderId: string): number {
        // پارسیان فقط عدد برای OrderId می‌پذیرد
        const numericId = orderId.replace(/\D/g, '');
        return parseInt(numericId.slice(-9)) || Date.now();
    }

    private buildSoapRequest(method: string, data: any): string {
        let soapBody = '';

        for (const [key, value] of Object.entries(data)) {
            if (value !== undefined && value !== null) {
                soapBody += `<${key}>${value}</${key}>`;
            }
        }

        return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/">
  <soap:Body>
    <${method} xmlns="http://tempuri.org/">
      <requestData>
        ${soapBody}
      </requestData>
    </${method}>
  </soap:Body>
</soap:Envelope>`;
    }

    private parseSoapResponse<T>(xmlResponse: string, method: string): T {
        const match = xmlResponse.match(new RegExp(`<${method}Result>(.*?)</${method}Result>`));
        if (!match) {
            throw new Error('پاسخ SOAP نامعتبر است');
        }

        const resultXml = match[1];

        // پارس کردن ساده XML - در پروژه واقعی بهتر است از کتابخانه XML Parser استفاده شود
        const statusMatch = resultXml.match(/<Status>(-?\d+)<\/Status>/);
        const messageMatch = resultXml.match(/<Message>(.*?)<\/Message>/);
        const tokenMatch = resultXml.match(/<Token>(\d+)<\/Token>/);
        const rrnMatch = resultXml.match(/<RRN>(\d+)<\/RRN>/);
        const cardMatch = resultXml.match(/<CardNumberMasked>(.*?)<\/CardNumberMasked>/);

        const result: any = {
            Status: statusMatch ? parseInt(statusMatch[1]) : -1,
            Message: messageMatch ? messageMatch[1] : 'خطای ناشناخته'
        };

        if (tokenMatch) result.Token = parseInt(tokenMatch[1]);
        if (rrnMatch) result.RRN = parseInt(rrnMatch[1]);
        if (cardMatch) result.CardNumberMasked = cardMatch[1];

        return result as T;
    }

    private getErrorMessage(code: number): string {
        const errors = {
            0: 'تراکنش با موفقیت انجام شد',
            '-1': 'خطای سوییچ',
            '-2': 'خطای سوییچ',
            '-3': 'خطای سوییچ',
            '-4': 'خطای سوییچ',
            '-5': 'خطای سوییچ',
            '-6': 'خطای سوییچ',
            '-7': 'خطای سوییچ',
            '-8': 'خطای سوییچ',
            '-9': 'خطای سوییچ',
            '-10': 'خطای سوییچ',
            '-11': 'خطای سوییچ',
            '-12': 'خطای سوییچ',
            '-13': 'خطای سوییچ',
            '-14': 'خطای سوییچ',
            '-15': 'خطای سوییچ',
            '-16': 'خطای سوییچ',
            '-17': 'خطای سوییچ',
            '-18': 'خطای سوییچ',
            '-19': 'خطای سوییچ',
            '-20': 'خطای سوییچ',
            '-21': 'خطای سوییچ',
            '-22': 'خطای سوییچ',
            '-23': 'خطای سوییچ',
            '-24': 'خطای سوییچ',
            '-25': 'خطای سوییچ',
            '-26': 'خطای سوییچ',
            '-27': 'خطای سوییچ',
            '-28': 'خطای سوییچ',
            '-29': 'خطای سوییچ',
            '-30': 'خطای سوییچ',
            '-31': 'خطای سوییچ',
            '-32': 'خطای سوییچ',
            '-33': 'خطای سوییچ',
            '-34': 'خطای سوییچ',
            '-35': 'خطای سوییچ',
            '-36': 'خطای سوییچ',
            '-37': 'خطای سوییچ',
            '-38': 'خطای سوییچ',
            '-39': 'خطای سوییچ',
            '-40': 'خطای سوییچ',
            '-41': 'خطای سوییچ',
            '-42': 'خطای سوییچ',
            '-43': 'خطای سوییچ',
            '-44': 'خطای سوییچ',
            '-45': 'خطای سوییچ',
            '-46': 'خطای سوییچ',
            '-47': 'خطای سوییچ',
            '-48': 'خطای سوییچ',
            '-49': 'خطای سوییچ',
            '-50': 'خطای سوییچ',
            '-51': 'خطای سوییچ',
            '-52': 'خطای سوییچ',
            '-53': 'خطای سوییچ',
            '-54': 'خطای سوییچ',
            '-55': 'خطای سوییچ',
            '-56': 'خطای سوییچ',
            '-57': 'خطای سوییچ',
            '-58': 'خطای سوییچ',
            '-59': 'خطای سوییچ',
            '-60': 'خطای سوییچ',
            '-61': 'خطای سوییچ',
            '-62': 'خطای سوییچ',
            '-63': 'خطای سوییچ',
            '-64': 'خطای سوییچ',
            '-65': 'خطای سوییچ',
            '-66': 'خطای سوییچ',
            '-67': 'خطای سوییچ',
            '-68': 'خطای سوییچ',
            '-69': 'خطای سوییچ',
            '-70': 'خطای سوییچ',
            '-71': 'خطای سوییچ',
            '-72': 'خطای سوییچ',
            '-73': 'خطای سوییچ',
            '-74': 'خطای سوییچ',
            '-75': 'خطای سوییچ',
            '-76': 'خطای سوییچ',
            '-77': 'خطای سوییچ',
            '-78': 'خطای سوییچ',
            '-79': 'خطای سوییچ',
            '-80': 'خطای سوییچ',
            '-81': 'خطای سوییچ',
            '-82': 'خطای سوییچ',
            '-83': 'خطای سوییچ',
            '-84': 'خطای سوییچ',
            '-85': 'خطای سوییچ',
            '-86': 'خطای سوییچ',
            '-87': 'خطای سوییچ',
            '-88': 'خطای سوییچ',
            '-89': 'خطای سوییچ',
            '-90': 'خطای سوییچ',
            '-91': 'خطای سوییچ',
            '-92': 'خطای سوییچ',
            '-93': 'خطای سوییچ',
            '-94': 'خطای سوییچ',
            '-95': 'خطای سوییچ',
            '-96': 'خطای سوییچ',
            '-97': 'خطای سوییچ',
            '-98': 'خطای سوییچ',
            '-99': 'خطای سوییچ',
            '-100': 'خطای سوییچ',
            '-101': 'پذیرنده احراز هویت نشد',
            '-102': 'تراکنش با موفقیت برگشت داده شد',
            '-103': 'قابلیت خرید برای پذیرنده غیر فعال می باشد',
            '-104': 'قابلیت پرداخت قبض برای پذیرنده غیر فعال می باشد',
            '-105': 'قابلیت تاب آب برای پذیرنده غیر فعال می باشد',
            '-106': 'قابلیت شارژ برای پذیرنده غیر فعال می باشد',
            '-107': 'قابلیت ارسال تاییده تراکنش برای پذیرنده غیر فعال می باشد',
            '-108': 'قابلیت برگشت تراکنش برای پذیرنده غیر فعال می باشد',
            '-109': 'قابلیت پرداخت خرید کالای ایرانی برای پذیرنده غیر فعال می باشد',
            '-110': 'قابلیت OCP برای پذیرنده غیر فعال می باشد',
            '-111': 'مبلغ تراکنش بیش از حد مجاز پذیرنده می باشد',
            '-112': 'شناسه معادل کاربری است',
            '-113': 'بازآمیز ورودی خالی می باشد',
            '-114': 'شناسه قبض نامعتبر می باشد',
            '-115': 'شناسه پرداخت نامعتبر می باشد',
            '-116': 'طول رشته بیش از حد مجاز می باشد',
            '-117': 'طول رشته کم تر از حد مجاز می باشد',
            '-118': 'مقدار ارسال شده عدد نمی باشد',
            '-119': 'سازمان نامعتبر می باشد',
            '-120': 'طول داده ورودی معتبر نمی باشد',
            '-121': 'رشته داده شده بهطور کامل عددی نمی باشد',
            '-122': 'شماره کارت معتبر نمی باشد',
            '-123': 'تاریخ انقضای کارت معتبر نمی باشد',
            '-124': 'لطفا فیلد رمز اینترنتی کارت را کامل کنید',
            '-125': 'کد CVV2 صحیح نمی باشد',
            '-126': 'کد شناسایی پذیرنده معتبر نمی باشد',
            '-127': 'آدرس اینترنتی معتبر نمی باشد',
            '-128': 'قالب آدرس IP معتبر نمی باشد',
            '-129': 'قالب داده ورودی صحیح نمی باشد',
            '-130': 'توکن منقضی شده است',
            '-131': 'Token نامعتبر می باشد',
            '-132': 'مبلغ تراکنش کمتر از حداقل مجاز می باشد',
            '-133': 'DelegateCode معتبر نمی باشد',
            '-134': 'DelegatePass معتبر نمی باشد',
            '-135': 'CheckDigit معتبر نمی باشد',
            '-136': 'DelegateCode length is less than or equal to CheckDigit',
            '-137': 'DelegateCode does not end with CheckDigit',
            '-138': 'عملیات پرداخت توسط کاربر لغو شد',
            '-139': 'کد آشنا وارد شده صحیح نمی باشد',
            '-140': 'ریز دوم معتبر نمی باشد',
            '-141': 'طول ریز دوم معتبر نمی باشد',
            '-142': 'شناسه قبض یا پرداخت معتبر نمی باشد',
            '-143': 'جمع مبالغ تسهیم با مبلغ تراکنش مغایرت دارد',
            '-144': 'مبالغ در برخی از آیتم معتبر نمی باشد',
            '-145': 'آیتم تسهیم تعیین نشده است',
            '-146': 'شماره موبایل برای شارژ معتبر نمی باشد',
            '-147': 'نوع شارژ معتبر نمی باشد',
            '-148': 'پارامتر ورودی معتبر نمی باشد',
            '-152': 'عدم وجود شناسه حساب برای داده اندازی',
            '-153': 'قالب شناسه حساب صحیح نمی باشد',
            '-154': 'Either Card Number or Card Index parameters must be specified',
            '-155': 'اجازه پرداخت تک فاز اعطا نشده است',
            '-500': 'خطا در درج اطلاعات',
            '-501': 'خطا در برقراری ارتباط شبکه ای با دیتابیس',
            '-1000': 'خطا در دریافت اطلاعات از سوییچ',
            '-1001': 'Network Timeout خطا در اتصال و با دریافت اطلاعات از سوییچ',
            '-1002': 'خطا در ارسال اطلاعات به سوییچ',
            '-1003': 'خطا در انجام تراکنش روی سوییچ',
            '-1004': 'طول داده دریافتی از سوییچ نامعتبر است',
            '-1005': 'ISO Response Parse Error',
            '-1006': 'Can not get ISO Response Code from Message',
        };

        return errors[code] || `خطای ناشناخته: ${code}`;
    }
}