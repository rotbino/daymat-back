// src/admin/catalog/admin-catalog.module.ts
import { AdminCatalogController } from './admin-catalog.controller';
import { AdminCatalogService } from './admin-catalog.service';
import {PrismaModule} from "../../prisma/prisma.module";
import {Module} from "@nestjs/common";

@Module({
    imports: [PrismaModule],
    controllers: [AdminCatalogController],
    providers: [AdminCatalogService],
    exports: [AdminCatalogService],
})
export class AdminCatalogModule {}