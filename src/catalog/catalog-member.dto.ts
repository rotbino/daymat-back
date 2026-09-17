// src/catalog/catalog-member.dto.ts
import { IsOptional, IsString, MaxLength, Matches, IsIn } from 'class-validator';

/** درخواست ارتباط تجاری با بازوی فروش — یک در برای هر چهار نقش بیزینسی */
export class CoopJoinDto {
    @IsIn(['seller', 'buyer', 'supplier', 'service'])
    type!: 'seller' | 'buyer' | 'supplier' | 'service'; // همکار فروش | خریدار | تامین‌کننده | سرویس‌دهندهٔ خدمات

    @IsOptional()
    @IsIn(['seller', 'visitor'])
    sellerRole?: 'seller' | 'visitor'; // فقط type=seller — ترجیحِ برچسب؛ تصمیم نهایی با مدیرِ تاییدکننده

    @IsOptional()
    @Matches(/^[a-f\d]{24}$/i, { message: 'شناسه کسب‌وکار نامعتبر است' })
    businessId?: string; // type=buyer الزامی؛ type=seller اختیاری

    @IsOptional()
    @Matches(/^[a-f\d]{24}$/i, { message: 'شناسه بازوی فروش نامعتبر است' })
    supplierCatalogId?: string; // فقط type=supplier — بازوی فروشِ خودِ تامین‌کننده

    @IsOptional()
    @Matches(/^[a-f\d]{24}$/i, { message: 'شناسه بازوی فروش نامعتبر است' })
    serviceCatalogId?: string; // فقط type=service — بازوی فروشِ خدماتیِ خود (salesType=service)

    @IsOptional()
    @IsString()
    @MaxLength(200)
    note?: string;
}

/** دعوت بازوی فروشِ دیگر به‌عنوان تامین‌کننده — تایید نهایی با صاحبِ بازوی فروش */
export class InviteSupplierDto {
    @Matches(/^[a-f\d]{24}$/i, { message: 'شناسه بازوی فروش نامعتبر است' })
    supplierCatalogId!: string;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    note?: string;
}

/** دعوت بازوی فروشِ خدماتی به‌عنوان سرویس‌دهنده — تایید نهایی با صاحبِ بازوی فروش */
export class InviteServiceDto {
    @Matches(/^[a-f\d]{24}$/i, { message: 'شناسه بازوی فروش نامعتبر است' })
    serviceCatalogId!: string;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    note?: string;
}

/** دعوت کاربر به همکاری در فروش — پذیرش با خودِ دعوت‌شده */
export class InviteSellerDto {
    @Matches(/^[a-f\d]{24}$/i, { message: 'شناسه کاربر نامعتبر است' })
    userId!: string;

    @IsOptional()
    @IsIn(['seller', 'visitor'])
    sellerRole?: 'seller' | 'visitor';

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
    sellerUserId?: string; // انتساب به عضوِ فروشِ مشخص — پیش‌فرض: خود ثبت‌کننده (یا مالک)

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
