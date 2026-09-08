// src/location/location.module.ts
import { Module, Global } from '@nestjs/common';
import { LocationService } from './location.service';
import { LocationController } from './location.controller';

@Global()
@Module({
    controllers: [LocationController],
    providers: [LocationService],
    exports: [LocationService],
})
export class LocationModule {}