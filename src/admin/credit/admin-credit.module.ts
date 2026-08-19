// src/admin/credit/admin-credit.module.ts
import { Module } from '@nestjs/common';
import { AdminCreditController } from './admin-credit.controller';
import { AdminCreditService } from './admin-credit.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [AdminCreditController],
    providers: [AdminCreditService],
    exports: [AdminCreditService],
})
export class AdminCreditModule {}