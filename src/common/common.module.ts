import { Global, Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { PrismaModule } from '../prisma/prisma.module';
import { CatalogPublishService } from './services/catalog-publish.service';
import { CatalogAccessService } from './services/catalog-access.service';
import { CacheHelper } from './services/cache.helper';

/**
 * ماژول سراسری — سرویس‌های مشترک بین Arm/Ad/ArmAdmin.
 * چون Global است، هیچ ماژولی نیاز به import آن ندارد؛ فقط تزریق کن.
 *
 * ⚠️ CacheModule.register({ isGlobal: true }) — CACHE_MANAGER را در کل اپ قابل تزریق می‌کند.
 * بدون این، بوت اپ با «Nest can't resolve dependencies of the CacheHelper» کرش می‌کند.
 */
@Global()
@Module({
    imports: [PrismaModule, CacheModule.register({ isGlobal: true })],
    providers: [CatalogPublishService, CatalogAccessService, CacheHelper],
    exports: [CatalogPublishService, CatalogAccessService, CacheHelper],
})
export class CommonModule {}