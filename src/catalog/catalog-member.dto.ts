// src/catalog/catalog-member.dto.ts
import { IsOptional, IsString, MaxLength, Matches, IsIn } from 'class-validator';

/** درخواست ارتباط تجاری با کاتالوگ — یک در برای هر سه نقش بیزینسی */
export class CoopJoinDto {
    @IsIn(['seller', 'buyer', 'supplier'])
    type!: 'seller' | 'buyer' | 'supplier'; // همکار فروش | خریدار | تامین‌کننده

    @IsOptional()
    @IsIn(['seller', 'visitor'])
    sellerRole?: 'seller' | 'visitor'; // فقط type=seller — ترجیحِ برچسب؛ تصمیم نهایی با مدیرِ تاییدکننده

    @IsOptional()
    @Matches(/^[a-f\d]{24}$/i, { message: 'شناسه کسب‌وکار نامعتبر است' })
    businessId?: string; // type=buyer الزامی؛ type=seller اختیاری

    @IsOptional()
    @Matches(/^[a-f\d]{24}$/i, { message: 'شناسه کاتالوگ نامعتبر است' })
    supplierCatalogId?: string; // فقط type=supplier — کاتالوگِ خودِ تامین‌کننده

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

/** تایید درخواست ارتباط تجاریِ خریدار — با انتساب اختیاری به عضوِ فروش */
export class ApproveBuyerDto {
    @IsOptional()
    @Matches(/^[a-f\d]{24}$/i, { message: 'شناسه عضو فروش نامعتبر است' })
    sellerUserId?: string;
}

export class SellerRoleDto {
    @IsIn(['seller', 'visitor'])
    sellerRole!: 'seller' | 'visitor';
}

export class AddCustomerDto {
    @IsString()
    businessId!: string; // کسب‌وکار خریدار

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
    sellerUserId!: string; // مسئولِ جدیدِ خریدار
}

export class RejectSellerDto {
    @IsOptional()
    @IsString()
    @MaxLength(300)
    reason?: string;
}

export class RejectCoopDto {
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
