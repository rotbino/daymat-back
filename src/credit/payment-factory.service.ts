// src/payment/payment-factory.service.ts
import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AbstractPaymentGateway } from './gateways/abstract-payment.gateway';
import { ZarinpalGateway } from './gateways/zarinpal.gateway';
import { RayanPayGateway } from './gateways/rayanpay.gateway';
import { PecGateway } from './gateways/parsian.gateway';

@Injectable()
export class PaymentFactoryService {
    constructor(private httpService: HttpService) {}

    createGateway(armConfig: any, gatewayName: string): AbstractPaymentGateway {
        const gateways = armConfig?.payment?.gateways || {};
        const defaultGateway = armConfig?.payment?.defaultGateway || 'pec';

        const selectedGateway = gatewayName || defaultGateway;

        switch (selectedGateway) {
            case 'zarinpal':
                return new ZarinpalGateway(
                    {
                        merchantId: gateways.zarinpal?.merchantId || '',
                        sandbox: gateways.zarinpal?.sandbox ?? true,
                        callbackUrl: gateways.zarinpal?.callbackUrl || '',
                    },
                    this.httpService,
                );
            case 'rayanpay':
                return new RayanPayGateway(
                    {
                        pin: gateways.rayanpay?.pin || '',
                        sandbox: gateways.rayanpay?.sandbox ?? true,
                        callbackUrl: gateways.rayanpay?.callbackUrl || '',
                    },
                    this.httpService,
                );
            case 'pec':
                return new PecGateway(
                    {
                        pin: gateways.pec?.pin || '',
                        sandbox: gateways.pec?.sandbox ?? true,
                        callbackUrl: gateways.pec?.callbackUrl || '',
                    },
                    this.httpService,
                );
            default:
                throw new Error(`درگاه پرداخت ${selectedGateway} پشتیبانی نمی‌شود`);
        }
    }
}