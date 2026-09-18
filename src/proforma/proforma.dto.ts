// src/proforma/proforma.dto.ts
import {
    ArrayMinSize,
    IsArray,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    Min,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ProformaItemDto {
    @IsString()
    name: string;

    @IsOptional()
    @IsInt()
    @Min(1)
    quantity?: number = 1;

    @IsOptional()
    @IsString()
    unit?: string;

    @IsNumber()
    @Min(0)
    unitPrice: number;
}

export class CreateProformaDto {
    /** پیشنهاد پذیرفته‌شدهٔ مبدأ — اختیاری؛ اگر بیاید، خریدار از روی پیشنهاد قفل می‌شود */
    @IsOptional()
    @IsString()
    offerId?: string;

    /** بازوی خرید مبدأ — وقتی پیشنهادی در کار نیست، بازوی خرید مقصد */
    @IsOptional()
    @IsString()
    inquiryId?: string;

    /** خریدار — وقتی offerId/inquiryId هست اختیاری است؛ بک خودش صاحبش را پیدا می‌کند */
    @IsOptional()
    @IsString()
    buyerUserId?: string;

    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => ProformaItemDto)
    items: ProformaItemDto[];

    @IsOptional()
    @IsInt()
    @Min(0)
    deliveryDays?: number;

    @IsOptional()
    @IsString()
    notes?: string;
}
