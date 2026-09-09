// src/admin/admin.module.ts
import { Module } from '@nestjs/common';
import { AdminUnitController } from './unit/admin-unit.controller';
import { AdminUnitService } from './unit/admin-unit.service';
import { AdminCategoryController } from './category/admin-category.controller';
import { AdminCategoryService } from './category/admin-category.service';
import { AdminIndustryController } from './industry/admin-industry.controller';
import { AdminIndustryService } from './industry/admin-industry.service';
import { AdminArmController } from './arm/admin-arm.controller';
import { AdminArmService } from './arm/admin-arm.service';
import { AdminLocationController } from './location/admin-location.controller';
import { AdminLocationService } from './location/admin-location.service';
import { AdminActivityController } from './activity/admin-activity.controller';
import { AdminActivityService } from './activity/admin-activity.service';
import { AdminUserController } from './user/admin-user.controller';
import { AdminUserService } from './user/admin-user.service';
import { AdminAdController } from "./ad/admin-ad.controller";
import {AdminAdService} from "./ad/admin-ad.service";
import {AdminCreditService} from "./credit/admin-credit.service";
import {AdminCreditController} from "./credit/admin-credit.controller";
import {AdminPaymentService} from "./payment/admin-payment.service";
import {AdminPaymentController} from "./payment/admin-payment.controller";
import {AdminCatalogController} from "./catalog/admin-catalog.controller";
import {AdminCatalogService} from "./catalog/admin-catalog.service";
import {AdminFeedbackController} from "./feedback/admin-feedback.controller";
import {AdminFeedbackService} from "./feedback/admin-feedback.service";
import { AdminProductController } from './product/admin-product.controller';
import { AdminProductService } from './product/admin-product.service';
import { AdminBrandController } from './brand/admin-brand.controller';
import { AdminBrandService } from './brand/admin-brand.service';

@Module({
    controllers: [
        AdminUnitController,
        AdminCategoryController,
        AdminIndustryController,
        AdminArmController,
        AdminLocationController,
        AdminActivityController,
        AdminUserController,
        AdminAdController,
        AdminCreditController,
        AdminPaymentController,
        AdminCatalogController,
        AdminFeedbackController,
        AdminProductController,
        AdminBrandController,

    ],
    providers: [
        AdminUnitService,
        AdminCategoryService,
        AdminIndustryService,
        AdminArmService,
        AdminLocationService,
        AdminActivityService,
        AdminUserService,
        AdminAdService,
        AdminCreditService,
        AdminPaymentService,
        AdminCatalogService,
        AdminFeedbackService,
        AdminProductService,
        AdminBrandService,
    ],
    exports: [
        AdminUnitService,
        AdminCategoryService,
        AdminIndustryService,
        AdminArmService,
        AdminLocationService,
        AdminActivityService,
        AdminUserService,
        AdminAdService,
        AdminCreditService,
        AdminPaymentService,
        AdminCatalogService,
        AdminFeedbackService,
        AdminProductService,
        AdminBrandService,
    ],
})
export class AdminModule {}