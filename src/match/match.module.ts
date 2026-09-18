// src/match/match.module.ts
// مچینگ دوطرفهٔ خریدار↔تامین‌کننده — ماژول
import { Module } from '@nestjs/common';
import { MatchController } from './match.controller';
import { MatchService } from './match.service';
import { CreditModule } from '../credit/credit.module';

// CatalogAccessService از CommonModuleِ سراسری و SettingsService از SettingsModuleِ
// سراسری تزریق می‌شوند — نیازی به import اضافی نیست. CreditModule برای مصرفِ
// اعتبارِ آینده (وقتی ادمین enforceMatchLimits را روشن کند) صریحاً ایمپورت شده.
@Module({
    imports: [CreditModule],
    controllers: [MatchController],
    providers: [MatchService],
    exports: [MatchService],
})
export class MatchModule {}
