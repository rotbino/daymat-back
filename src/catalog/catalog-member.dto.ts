// src/catalog/catalog-member.dto.ts
import { IsOptional, IsString, MaxLength, Matches } from 'class-validator';

export class JoinSellerDto {
    @IsOptional()
    @IsString()
    sellerBusinessId?: string; // پیش‌فرض: اولین کسب‌وکار فعال کاربر

    @IsOptional()
    @IsString()
    @MaxLength(200)
    note?: string;
}

export class AddCustomerDto {
    @IsString()
    businessId!: string; // کسب‌وکار مشتری (سوپرمارکت)

    @IsOptional()
    @Matches(/^[a-f\d]{24}$/i, { message: 'شناسه بازاریاب نامعتبر است' })
    sellerUserId?: string; // انتساب به بازاریابِ مشخص — پیش‌فرض: خود ثبت‌کننده (یا اونر)

    @IsOptional()
    @IsString()
    @MaxLength(200)
    note?: string;
}

export class AssignCustomerDto {
    @Matches(/^[a-f\d]{24}$/i, { message: 'شناسه بازاریاب نامعتبر است' })
    sellerUserId!: string; // بازاریابِ جدیدِ مشتری
}

export class RejectSellerDto {
    @IsOptional()
    @IsString()
    @MaxLength(300)
    reason?: string;
}

export class DeclineCustomerDto {
    @IsOptional()
    @IsString()
    @MaxLength(300)
    reason?: string;
}

export class RegionDto {
    @IsOptional()
    @IsString()
    @MaxLength(80)
    region?: string;
}
