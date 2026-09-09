import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CatalogPublishService } from './services/catalog-publish.service';
import { CacheHelper } from './services/cache.helper';

/**
 * ماژول سراسری — سرویس‌های مشترک بین Arm/Ad/ArmAdmin.
 * چون Global است، هیچ ماژولی نیاز به import آن ندارد؛ فقط تزریق کن.
 */
@Global()
@Module({
    imports: [PrismaModule],
    providers: [CatalogPublishService, CacheHelper],
    exports: [CatalogPublishService, CacheHelper],
})
export class CommonModule {}