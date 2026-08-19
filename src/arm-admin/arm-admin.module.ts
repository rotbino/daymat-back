// src/arm-admin/arm-admin.module.ts
import { Module } from '@nestjs/common';
import { ArmAdminController } from './arm/arm-admin.controller';
import { ArmAdminService } from './arm/arm-admin.service';
import { MembersModule } from './members/members.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AdminCategoryService } from '../admin/category/admin-category.service';
import { ArmAdminAdController } from './ad/arm-admin-ad.controller';
import { ArmAdminAdService } from './ad/arm-admin-ad.service';
import { CreditModule } from '../credit/credit.module'; // ✅ اضافه شد

@Module({
    imports: [
        PrismaModule,
        AuthModule,
        MembersModule,
        CreditModule, // ✅ اضافه شد تا CreditService در دسترس باشد
    ],
    controllers: [
        ArmAdminController,
        ArmAdminAdController,
    ],
    providers: [
        ArmAdminService,
        AdminCategoryService,
        ArmAdminAdService,
    ],
    exports: [ArmAdminService],
})
export class ArmAdminModule {}