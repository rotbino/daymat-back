// src/app.module.ts
import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ArmModule } from './arm/arm.module';
import { AdModule } from './ad/ad.module';
import { AdminModule } from './admin/admin.module';
import { CreditModule } from './credit/credit.module';
import { FileModule } from './file/file.module';
import { LocationModule } from './location/location.module';
import { SettingsModule } from './settings/settings.module'; // ✅برای دومین های اختصاصی
import { I18nService } from './common/services/i18n.service';
import {ActivityModule} from "./activity/activity.module";
import {ArmAdminModule} from "./arm-admin/arm-admin.module";
import {FeedbackModule} from "./feedback/feedback.module";
import {CatalogModule} from "./catalog/catalog.module";
import {UnitModule} from "./unit/unit.module";
import {CommonModule} from "./common/common.module";
import {BusinessModule} from "./business/business.module";
import {BrandModule} from "./brand/brand.module";
import {ProductReferenceModule} from "./product-reference/product-reference.module";


@Global()
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 60000, limit: 100 },
      { name: 'medium', ttl: 300000, limit: 200 },
    ]),
    PrismaModule,
    AuthModule,
    CommonModule,        // ✅ اضافه — سرویس انتشار سراسری
    FileModule,
    CatalogModule,
    ArmModule,
    AdModule,
    CreditModule,
    LocationModule,
    BusinessModule,
    BrandModule,
    ProductReferenceModule,
    ActivityModule,
    SettingsModule,
    ArmAdminModule,
    FeedbackModule,
    CatalogModule,

    AdminModule,
    UnitModule,

  ],
  providers: [I18nService],
  exports: [I18nService],
})
export class AppModule {}