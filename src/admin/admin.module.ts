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
import {AdminBusinessController} from "./business/admin-business.controller";
import {AdminBusinessService} from "./business/admin-business.service";
import {AdminFeedbackController} from "./feedback/admin-feedback.controller";
import {AdminFeedbackService} from "./feedback/admin-feedback.service";

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
        AdminBusinessController,
        AdminFeedbackController,

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
        AdminBusinessService,
        AdminFeedbackService,
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
        AdminBusinessService,
        AdminFeedbackService,
    ],
})
export class AdminModule {}