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
import { CreditModule } from '../credit/credit.module';
import {ArmAdminCatalogsController} from "./catalogs/arm-admin-catalogs.controller";
import {ArmAdminCatalogsService} from "./catalogs/arm-admin-catalogs.service";
import {UserMarketController} from "../user-market/user-market.controller"; // ✅ اضافه شد
import { ArmModule } from '../arm/arm.module';
import { ArmAdminReferenceController } from './reference/arm-admin-reference.controller';
import { ArmAdminReferenceService } from './reference/arm-admin-reference.service';
import { AdminProductService } from '../admin/product/admin-product.service';
import { AdminBrandService } from '../admin/brand/admin-brand.service';

@Module({
    imports: [
        PrismaModule,
        AuthModule,
        MembersModule,
        CreditModule, // ✅ اضافه شد تا CreditService در دسترس باشد
        ArmModule, // ✅ سرویس‌های Arm (Location، MembershipRequest، LeaveRequest)
    ],
    controllers: [
        ArmAdminController,
        ArmAdminAdController,
        ArmAdminCatalogsController,
        UserMarketController,
        ArmAdminReferenceController,
    ],
    providers: [
        ArmAdminService,
        AdminCategoryService,
        ArmAdminAdService,
        ArmAdminCatalogsService,
        ArmAdminReferenceService,
        // ✅ سرویس‌های مشترک مدیریت داده‌های پایه — با scope بازار استفاده می‌شوند
        AdminProductService,
        AdminBrandService,
    ],
    exports: [ArmAdminService],
})
export class ArmAdminModule {}

