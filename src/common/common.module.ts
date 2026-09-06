import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CatalogPublishService } from './services/catalog-publish.service';

/**
 * ماژول سراسری — سرویس‌های مشترک بین Arm/Ad/ArmAdmin.
 * چون Global است، هیچ ماژولی نیاز به import آن ندارد؛ فقط تزریق کن.
 */
@Global()
@Module({
    imports: [PrismaModule],
    providers: [CatalogPublishService],
    exports: [CatalogPublishService],
})
export class CommonModule {}