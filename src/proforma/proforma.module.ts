// src/proforma/proforma.module.ts
import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/notification.module';
import { ProformaController } from './proforma.controller';
import { ProformaService } from './proforma.service';

@Module({
    imports: [NotificationModule],
    controllers: [ProformaController],
    providers: [ProformaService],
    exports: [ProformaService],
})
export class ProformaModule {}
