// src/match/match.dto.ts
// مچینگ دوطرفهٔ خریدار↔تامین‌کننده — DTOها
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

/**
 * افشای شمارهٔ تماس از مدال مچینگ:
 *  - side='seller' → خریدار شمارهٔ یک بازوی فروش (catalogId) را برمی‌دارد
 *  - side='buyer'  → تامین‌کننده شمارهٔ صاحب بازوی خرید (inquiryId) را برمی‌دارد
 */
export class RevealContactDto {
    @ApiProperty({ enum: ['seller', 'buyer'] })
    @IsIn(['seller', 'buyer'])
    side: 'seller' | 'buyer';

    @ApiPropertyOptional({ description: 'بازوی فروش مقصد (برای side=seller الزامی)' })
    @IsOptional()
    @IsString()
    catalogId?: string;

    @ApiPropertyOptional({ description: 'بازوی خرید مقصد (برای side=buyer الزامی)' })
    @IsOptional()
    @IsString()
    inquiryId?: string;

    @ApiPropertyOptional({ description: 'کالای فروشندهٔ مبدأ — برای برآورد ارزش معامله' })
    @IsOptional()
    @IsString()
    adId?: string;

    @ApiPropertyOptional({ description: 'قلم خرید مبدأ — برای برآورد ارزش معامله' })
    @IsOptional()
    @IsString()
    itemId?: string;

    @ApiPropertyOptional({ description: 'کالای مرجعِ بستر مچ' })
    @IsOptional()
    @IsString()
    productReferenceId?: string;
}
