// src/arm/arm.module.ts
import { Module } from '@nestjs/common';
import { ArmController } from './arm.controller';
import { ArmService } from './arm.service';
import { MembershipRequestService } from './membership-request.service';
import { LeaveRequestService } from './leave-request.service';

import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import {LocationService} from "../location/location.service";

@Module({
    imports: [PrismaModule, AuthModule],
    controllers: [ArmController],
    providers: [ArmService, LocationService, MembershipRequestService, LeaveRequestService],
    exports: [ArmService, MembershipRequestService, LeaveRequestService],
})
export class ArmModule {}