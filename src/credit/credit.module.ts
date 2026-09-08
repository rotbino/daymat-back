// src/credit/credit.module.ts
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CreditController } from './credit.controller';
import { CreditService } from './credit.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
    imports: [HttpModule],
    controllers: [CreditController],
    providers: [
        CreditService,
        PrismaService,
        {
            provide: 'PAYMENT_CONFIG',
            useValue: {
                defaultGateway: process.env.DEFAULT_PAYMENT_GATEWAY || 'rayanpay',
                gateways: {
                    zarinpal: {
                        merchantId: process.env.ZARINPAL_MERCHANT_ID,
                        sandbox: process.env.ZARINPAL_SANDBOX === 'true',
                        callbackUrl: process.env.PAYMENT_CALLBACK_URL || 'http://localhost:3011/credit/verify',
                    },
                    rayanpay: {
                        pin: process.env.RAYANPAY_PIN,
                        sandbox: process.env.RAYANPAY_SANDBOX === 'true',
                        callbackUrl: process.env.PAYMENT_CALLBACK_URL || 'http://localhost:3011/credit/verify',
                    },
                    pec: {
                        pin: process.env.PEC_PIN,
                        sandbox: process.env.PEC_SANDBOX === 'false',
                        callbackUrl: process.env.PAYMENT_CALLBACK_URL || 'http://localhost:3011/credit/verify',
                    },
                },
            },
        },
    ],
    exports: [CreditService], // ✅ این خط مهم است
})
export class CreditModule {}