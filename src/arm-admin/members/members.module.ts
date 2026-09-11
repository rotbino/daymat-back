// src/arm-admin/members/members.module.ts
import { Module } from '@nestjs/common';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../../auth/auth.module';
import { ArmModule } from '../../arm/arm.module';
import { CacheHelper } from '../../common/services/cache.helper';

@Module({
    imports: [PrismaModule, AuthModule, ArmModule],
    controllers: [MembersController],
    providers: [MembersService, CacheHelper],
    exports: [MembersService],
})
export class MembersModule {}