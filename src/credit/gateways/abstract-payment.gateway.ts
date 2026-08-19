// src/credit/gateways/abstract-payment.gateway.ts
export abstract class AbstractPaymentGateway {
    abstract getName(): string;
    abstract initiatePayment(params: PaymentInitiateParams): Promise<PaymentInitiateResult>;
    abstract verifyPayment(params: PaymentVerifyParams): Promise<PaymentVerifyResult>;
    abstract refundPayment(params: PaymentRefundParams): Promise<PaymentRefundResult>;
    abstract getPaymentStatus(transactionId: string): Promise<PaymentStatusResult>;

    // ✅ تغییر از protected به public
    public generateTransactionId(): string {
        const timestamp = Date.now().toString().slice(-8);
        const random = Math.random().toString(36).substring(2, 8).toUpperCase();
        return `${this.getName().substring(0, 3).toUpperCase()}-${timestamp}-${random}`;
    }


    public validateAmount(amount: number): void {
        if (amount < 1000) {
            throw new Error('مبلغ پرداخت باید حداقل 1000 تومان باشد');
        }
        if (amount > 1000000000) {
            throw new Error('مبلغ پرداخت نمی‌تواند بیش از 1 میلیارد تومان باشد');
        }
    }
}


export interface PaymentInitiateParams {
    amount: number;
    order_id: string;
    user_id: string;
    callback_url: string;
    description?: string;
    metadata?: any;
}

export interface PaymentInitiateResult {
    success: boolean;
    payment_url: string;
    transaction_id: string;
    gateway_reference: string;
    amount: number;
    error_code?: string;
    error_message?: string;
}

export interface PaymentVerifyParams {
    transaction_id: string;
    gateway_reference: string;
    amount: number;
}

export interface PaymentVerifyResult {
    success: boolean;
    transaction_id: string;
    amount: number;
    gateway_reference: string;
    card_hash?: string;
    card_number?: string;
    tracking_code?: string;
    error_code?: string;
    error_message?: string;
}

export interface PaymentRefundParams {
    transaction_id: string;
    amount: number;
    reason?: string;
}

export interface PaymentRefundResult {
    success: boolean;
    refund_id?: string;
    gateway_reference: string;
    error_code?: string;
    error_message?: string;
}

export interface PaymentStatusResult {
    status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'VERIFIED' | 'REFUNDED';
    amount: number;
    gateway_reference: string;
    transaction_date?: Date;
}