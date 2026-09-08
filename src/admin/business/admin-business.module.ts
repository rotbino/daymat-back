// src/admin/business/admin-business.module.ts
import { AdminBusinessController } from './admin-business.controller';
import { AdminBusinessService } from './admin-business.service';
import {PrismaModule} from "../../prisma/prisma.module";
import {Module} from "@nestjs/common";

@Module({
    imports: [PrismaModule],
    controllers: [AdminBusinessController],
    providers: [AdminBusinessService],
    exports: [AdminBusinessService],
})
export class AdminBusinessModule {}