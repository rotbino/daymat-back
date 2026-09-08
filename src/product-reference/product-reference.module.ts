// src/product-reference/product-reference.module.ts
import { Module } from '@nestjs/common';
import { ProductReferenceService } from './product-reference.service';
import { ProductReferenceController } from './product-reference.controller';

@Module({
    controllers: [ProductReferenceController],
    providers: [ProductReferenceService],
    exports: [ProductReferenceService],
})
export class ProductReferenceModule {}
