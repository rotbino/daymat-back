// src/contact/contact.dto.ts
// 📱 مخاطبین تلفن — اشتراک‌گذاری مستقیم (PWA Contact Picker)
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    IsArray,
    IsOptional,
    IsString,
    MaxLength,
    ValidateNested,
} from 'class-validator';

export class ContactItemDto {
    @ApiProperty({ description: 'نام مخاطب در دفترچهٔ تلفن', required: false })
    @IsOptional()
    @IsString()
    @MaxLength(120)
    name?: string;

    @ApiProperty({ description: 'شمارهٔ موبایل — ۰۹xxxxxxxxx / ۰۹۸+ / اعداد فارسی همه نرمال می‌شوند' })
    @IsString()
    @MaxLength(32)
    phone: string;
}

export class SyncContactsDto {
    @ApiProperty({ type: [ContactItemDto], description: 'حداکثر ۵۰۰ مخاطب در هر درخواست' })
    @IsArray()
    @ArrayMaxSize(500)
    @ValidateNested({ each: true })
    @Type(() => ContactItemDto)
    contacts: ContactItemDto[];
}
