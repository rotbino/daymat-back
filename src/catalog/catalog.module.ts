// src/catalog/catalog.module.ts
import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { CommonModule } from '../common/common.module';

@Module({
    imports: [CommonModule], // ✅ CatalogPublishService برای مهر خودکار کالاها هنگام ساخت کاتالوگ با armSlug
    controllers: [CatalogController],
    providers: [CatalogService],
    exports: [CatalogService],
})
export class CatalogModule {}