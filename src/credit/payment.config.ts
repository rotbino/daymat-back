// src/payment/payment.config.ts
export interface ZarinpalConfig {
    merchantId: string;
    sandbox?: boolean;
    callbackUrl: string;
}

export interface RayanPayConfig {
    pin: string;
    callbackUrl: string;
    sandbox?: boolean;
}

export interface PecConfig {
    pin: string; // شناسه پذیرنده
    callbackUrl: string;
    sandbox?: boolean;
}

export interface PaymentConfig {
    defaultGateway: 'zarinpal' | 'rayanpay' | 'pec';
    gateways: {
        zarinpal: ZarinpalConfig;
        rayanpay: RayanPayConfig;
        pec: PecConfig;
    };
}
// این فایل دیگه استفاده نمی شه و بردمیش داخل ماژول پرداخت
export const paymentConfig: PaymentConfig = {
    defaultGateway: 'pec', // می‌توانید بین درگاه‌ها سوییچ کنید
    gateways: {
      /*  pec: {
            pin: 'your-pec-pin', // شناسه پذیرنده پارسیان
            callbackUrl: 'http://localhost:3000/payment/verify',
            sandbox: true, // برای تست true بگذارید
        },*/
        pec: {
            pin: '44970783', // PIN Code که دریافت کردید
            callbackUrl: 'http://localhost:3000/payment/verify', // آدرس callback خودتون
            sandbox: false, // چون اطلاعات واقعی دارید، false بگذارید
        },
        rayanpay: {
            pin: 'sandbox',
            callbackUrl: 'http://localhost:3000/payment/verify',
            sandbox: true,
        },
        zarinpal: {
            merchantId: 'your-zarinpal-merchant-id',
            callbackUrl: 'http://localhost:3000/payment/verify',
            sandbox: true,
        }
    }
};