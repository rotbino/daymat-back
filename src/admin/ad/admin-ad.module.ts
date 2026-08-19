// src/admin/ad/admin-ad.module.ts
import { Module } from '@nestjs/common';
import { AdminAdController } from './admin-ad.controller';
import { AdminAdService } from './admin-ad.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [AdminAdController],
    providers: [AdminAdService],
    exports: [AdminAdService],
})
export class AdminAdModule {}