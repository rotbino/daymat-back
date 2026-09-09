// src/unit/unit.module.ts
import { Module } from '@nestjs/common';
import { UnitController } from './unit.controller';
import { UnitService } from './unit.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';


@Module({
    imports: [PrismaModule, AuthModule],
    controllers: [UnitController],
    providers: [UnitService],
    exports: [UnitService],
})
export class UnitModule {}
