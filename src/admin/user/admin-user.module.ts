// src/admin/user/admin-user.module.ts
import { Module } from '@nestjs/common';
import { AdminUserController } from './admin-user.controller';
import { AdminUserService } from './admin-user.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [AdminUserController],
    providers: [AdminUserService],
    exports: [AdminUserService],
})
export class AdminUserModule {}