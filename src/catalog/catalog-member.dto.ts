// src/catalog/catalog-member.dto.ts
import { IsOptional, IsString, MaxLength, Matches, IsIn } from 'class-validator';

export class JoinSellerDto {
    @IsOptional()
    @IsString()
    sellerBusinessId?: string; // پیش‌فرض: اولین کسب‌وکار فعال کاربر

    @IsOptional()
    @IsIn(['seller', 'visitor'])
    sellerRole?: 'seller' | 'visitor'; // ترجیح نقش بیزینسی — تصمیم نهایی با مدیرِ تاییدکننده است

    @IsOptional()
    @IsString()
    @MaxLength(200)
    note?: string;
}

export class ApproveSellerDto {
    @IsOptional()
    @IsIn(['seller', 'visitor'])
    sellerRole?: 'seller' | 'visitor'; // نقش بیزینسی هنگام تایید — پیش‌فرض: فروشنده
}

export class SellerRoleDto {
    @IsIn(['seller', 'visitor'])
    sellerRole!: 'seller' | 'visitor';
}

export class AddCustomerDto {
    @IsString()
    businessId!: string; // کسب‌وکار مشتری (سوپرمارکت)

    @IsOptional()
    @Matches(/^[a-f\d]{24}$/i, { message: 'شناسه عضو فروش نامعتبر است' })
    sellerUserId?: string; // انتساب به عضوِ فروشِ مشخص — پیش‌فرض: خود ثبت‌کننده (یا اونر)

    @IsOptional()
    @IsString()
    @MaxLength(200)
    note?: string;
}

export class AssignCustomerDto {
    @Matches(/^[a-f\d]{24}$/i, { message: 'شناسه عضو فروش نامعتبر است' })
    sellerUserId!: string; // مسئولِ جدیدِ مشتری
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
