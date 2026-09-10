// src/business/business.service.ts
import {
    Injectable,
    NotFoundException,
    ForbiddenException,
    BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBusinessDto, UpdateBusinessDto, RequestBusinessVerificationDto } from './business.dto';
import { CacheHelper } from '../common/services/cache.helper';

/**
 * نهاد تجاری — هویت واقعی کسب‌وکار.
 *  - هر کاربر چند نهاد می‌تواند داشته باشد
 *  - salesType اینجا ممنوع (صفت ویترین است)
 *  - slug ندارد (صفحهٔ عمومی ندارد)
 *  - تیک اعتماد: مرجع واقعی — ادمین اینجا می‌خواند/می‌نویسد
 */
@Injectable()
export class BusinessService {
    constructor(
        private prisma: PrismaService,
        private cache: CacheHelper,
    ) {}

    // ✅ اگه صنف در جدول Industry وجود نداشته باشه، بسازش
    // اگه industryId داده شده، اون رو استفاده کن
    // اگه فقط متن داده شده، سرچ کن یا بساز
    private async ensureIndustryExists(industryId?: string, industryName?: string): Promise<string | null> {
        // اگه industryId داریم، فقط usageCount رو آپدیت کن
        if (industryId) {
            await this.prisma.industry.update({
                where: { id: industryId },
                data: { usageCount: { increment: 1 } },
            }).catch(() => {});
            return industryId;
        }

        // اگه فقط متن داریم
        if (!industryName?.trim()) return null;
        const name = industryName.trim();
        const slug = name
            .replace(/\s+/g, '-')
            .replace(/[^\u0600-\u06FF\u0750-\u077F\w\-]/g, '')
            .toLowerCase();

        const existing = await this.prisma.industry.findFirst({
            where: { title: name },
            select: { id: true },
        });
        if (existing) {
            await this.prisma.industry.update({
                where: { id: existing.id },
                data: { usageCount: { increment: 1 } },
            }).catch(() => {});
            return existing.id;
        }

        // ساخت صنف جدید — confirmed=false تا ادمین بررسی کنه
        const created = await this.prisma.industry.create({
            data: {
                title: name,
                slug,
                level: 0,
                path: slug,
                isActive: true,
                usageCount: 1,
                confirmed: false,  // ✅ توسط کاربر ساخته شده
                isByUser: true,    // ✅ مارک‌گذاری به‌عنوان کاربر-ساخته
            },
        }).catch(() => null);

        return created?.id || null;
    }

    async create(userId: string, dto: CreateBusinessDto) {
        if (!dto.name?.trim()) {
            throw new BadRequestException({
                errorCode: 'NAME_REQUIRED',
                message: 'نام کسب‌وکار الزامی است',
            });
        }

        // ✅ اگه صنف وارد شده، در جدول Industry هم ذخیره کن
        const resolvedIndustryId = await this.ensureIndustryExists(
            (dto as any).industryId,
            dto.industryName,
        );

        const created = await this.prisma.business.create({
            data: {
                ownerUserId: userId,
                name: dto.name.trim().slice(0, 120),
                type: dto.type || 'wholesaler',
                businessRole: (dto as any).businessRole || null,
                businessSector: (dto as any).businessSector || null,
                industryName: dto.industryName?.trim() || null,
                industryId: resolvedIndustryId,
                shortDescription: dto.shortDescription?.trim() || null,
                description: dto.description?.trim() || null,
                province: dto.province || null,
                provinceCode: dto.provinceCode || null,
                city: dto.city || null,
                cityCode: dto.cityCode || null,
                address: dto.address?.trim() || null,
                phone: dto.phone?.trim() || null,
                website: dto.website?.trim() || null,
                logoUrl: dto.logoUrl || null,
                nationalId: dto.nationalId?.trim() || null,
                businessLicense: dto.businessLicense?.trim() || null,
                businessStartYear: dto.businessStartYear || null,
            },
        });

        // ⚠️ تعداد نهادها در پروفایل کاربر می‌آید (_count.businesses) → کش پروفایل باطل
        await this.cache.bust(`profile:${userId}`);

        return created;
    }

    async getMy(userId: string) {
        const items = await this.prisma.business.findMany({
            where: { ownerUserId: userId, status: 'active' },
            select: {
                id: true, name: true, type: true,
                businessRole: true,        // ✅ نوع دقیق فعالیت
                businessSector: true,      // ✅ دسته‌بندی
                industryName: true,
                industryId: true,  // ✅ اضافه شد
                shortDescription: true, province: true, city: true, phone: true,
                logoUrl: true, verificationStatus: true, verificationTier: true,
                createdAt: true,
                _count: { select: { catalogs: true } },
            },
            orderBy: { createdAt: 'asc' },
        });
        return { items };
    }

    async findOne(id: string, userId: string) {
        const biz = await this.prisma.business.findUnique({
            where: { id },
            include: {
                catalogs: {
                    select: { id: true, name: true, slug: true, salesType: true, status: true },
                },
            },
        });
        if (!biz) {
            throw new NotFoundException({ errorCode: 'BUSINESS_NOT_FOUND', message: 'کسب‌وکار یافت نشد' });
        }
        if (biz.ownerUserId !== userId) {
            throw new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'فقط مالک کسب‌وکار' });
        }
        return biz;
    }

    async update(id: string, userId: string, dto: UpdateBusinessDto) {
        const biz = await this.prisma.business.findUnique({
            where: { id },
            select: { ownerUserId: true },
        });
        if (!biz) {
            throw new NotFoundException({ errorCode: 'BUSINESS_NOT_FOUND', message: 'کسب‌وکار یافت نشد' });
        }
        if (biz.ownerUserId !== userId) {
            throw new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'فقط مالک کسب‌وکار' });
        }

        // ✅ اگه صنف تغییر کرده، در جدول Industry هم ذخیره کن
        const industryIdChanged = (dto as any).industryId !== undefined || dto.industryName !== undefined;
        let resolvedIndustryId: string | null | undefined = undefined;
        if (industryIdChanged) {
            resolvedIndustryId = await this.ensureIndustryExists(
                (dto as any).industryId,
                dto.industryName,
            );
        }

        return this.prisma.business.update({
            where: { id },
            data: {
                ...(dto.name !== undefined ? { name: dto.name.trim().slice(0, 120) } : {}),
                ...(dto.type !== undefined ? { type: dto.type } : {}),
                ...((dto as any).businessRole !== undefined ? { businessRole: (dto as any).businessRole || null } : {}),
                ...((dto as any).businessSector !== undefined ? { businessSector: (dto as any).businessSector || null } : {}),
                ...(dto.industryName !== undefined ? { industryName: dto.industryName?.trim() || null } : {}),
                ...(resolvedIndustryId !== undefined ? { industryId: resolvedIndustryId } : {}),
                ...(dto.shortDescription !== undefined ? { shortDescription: dto.shortDescription?.trim() || null } : {}),
                ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
                ...(dto.province !== undefined ? { province: dto.province || null } : {}),
                ...(dto.provinceCode !== undefined ? { provinceCode: dto.provinceCode || null } : {}),
                ...(dto.city !== undefined ? { city: dto.city || null } : {}),
                ...(dto.cityCode !== undefined ? { cityCode: dto.cityCode || null } : {}),
                ...(dto.address !== undefined ? { address: dto.address?.trim() || null } : {}),
                ...(dto.phone !== undefined ? { phone: dto.phone?.trim() || null } : {}),
                ...(dto.website !== undefined ? { website: dto.website?.trim() || null } : {}),
                ...(dto.logoUrl !== undefined ? { logoUrl: dto.logoUrl || null } : {}),
                ...(dto.nationalId !== undefined ? { nationalId: dto.nationalId?.trim() || null } : {}),
                ...(dto.businessLicense !== undefined ? { businessLicense: dto.businessLicense?.trim() || null } : {}),
                ...(dto.businessStartYear !== undefined ? { businessStartYear: dto.businessStartYear } : {}),
                updatedAt: new Date(),
            },
        });
    }

    async remove(id: string, userId: string) {
        const biz = await this.prisma.business.findUnique({
            where: { id },
            select: { ownerUserId: true, _count: { select: { catalogs: true } } },
        });
        if (!biz) {
            throw new NotFoundException({ errorCode: 'BUSINESS_NOT_FOUND', message: 'کسب‌وکار یافت نشد' });
        }
        if (biz.ownerUserId !== userId) {
            throw new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'فقط مالک کسب‌وکار' });
        }
        if (biz._count.catalogs > 0) {
            throw new BadRequestException({
                errorCode: 'BUSINESS_HAS_CATALOGS',
                message: 'این کسب‌وکار کاتالوگ دارد — اول کاتالوگ‌هایش را حذف یا جابه‌جا کنید',
            });
        }
        await this.prisma.business.update({
            where: { id },
            data: { status: 'closed' },
        });
        return { success: true };
    }

    // ============================================================
    // اتصال کاتالوگ به نهاد — فلوی «این کاتالوگ برای کدام کسب‌وکارَت؟»
    // ============================================================
    async attachCatalog(userId: string, businessId: string, catalogId: string) {
        const biz = await this.prisma.business.findUnique({
            where: { id: businessId },
            select: { ownerUserId: true },
        });
        if (!biz || biz.ownerUserId !== userId) {
            throw new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'دسترسی ندارید' });
        }
        const cat = await this.prisma.catalog.findUnique({
            where: { id: catalogId },
            select: { business: { select: { ownerUserId: true } } },
        });
        if (!cat || cat.business.ownerUserId !== userId) {
            throw new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'دسترسی ندارید' });
        }
        return this.prisma.catalog.update({
            where: { id: catalogId },
            data: { businessId },
            select: { id: true, businessId: true },
        });
    }

    // ============================================================
    // درخواست تیک اعتماد — مدارک روی نهاد ثبت می‌شود
    // (ادمین با admin-business.service.verifyBusiness همان‌جا می‌خواند)
    // ============================================================
    async requestVerification(businessId: string, userId: string, dto: RequestBusinessVerificationDto) {
        const biz = await this.prisma.business.findUnique({
            where: { id: businessId },
            select: { id: true, ownerUserId: true, status: true },
        });
        if (!biz) {
            throw new NotFoundException({ errorCode: 'BUSINESS_NOT_FOUND', message: 'کسب‌وکار یافت نشد' });
        }
        if (biz.ownerUserId !== userId) {
            throw new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'فقط مالک کسب‌وکار' });
        }
        if (biz.status !== 'active') {
            throw new BadRequestException({ errorCode: 'BUSINESS_INACTIVE', message: 'این کسب‌وکار فعال نیست' });
        }

        if (!dto.nationalCardFileId) {
            const user = await this.prisma.user.findUnique({ where: { id: userId } });
            if (!user?.nationalId) {
                throw new BadRequestException({
                    errorCode: 'NATIONAL_CARD_REQUIRED',
                    message: 'تصویر کارت ملی الزامی است (مگر اینکه کد ملی شما قبلاً تأیید شده باشد)',
                });
            }
            if (dto.nationalId !== user.nationalId) {
                throw new BadRequestException({
                    errorCode: 'NATIONAL_ID_MISMATCH',
                    message: 'کد ملی با مقدار تأییدشده مطابقت ندارد',
                });
            }
        }

        await this.prisma.verification.create({
            data: {
                businessId: biz.id,
                tier: dto.level,
                status: 'pending',
                documents: {
                    nationalId: dto.nationalId,
                    nationalCardFileId: dto.nationalCardFileId || null,
                    licenseFileIds: dto.licenseFileIds,
                    awardFileIds: dto.awardFileIds,
                },
                submittedAt: new Date(),
            },
        });

        await this.prisma.business.update({
            where: { id: businessId },
            data: { verificationStatus: 'pending' },
        });

        return { success: true, message: 'مدارک ارسال شد' };
    }

    // ============================================================
    // وضعیت تیک برای UI — از همان getMy خوانده می‌شود؛ این متد برای جزئیاتِ مدارک
    // ============================================================
    async getMyVerification(businessId: string, userId: string) {
        const biz = await this.prisma.business.findUnique({
            where: { id: businessId },
            select: { ownerUserId: true, verificationStatus: true, verificationTier: true },
        });
        if (!biz) {
            throw new NotFoundException({ errorCode: 'BUSINESS_NOT_FOUND', message: 'کسب‌وکار یافت نشد' });
        }
        if (biz.ownerUserId !== userId) {
            throw new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'فقط مالک کسب‌وکار' });
        }

        const latest = await this.prisma.verification.findFirst({
            where: { businessId },
            orderBy: { submittedAt: 'desc' },
            select: {
                id: true, tier: true, status: true, notes: true,
                submittedAt: true, reviewedAt: true,
            },
        });

        return {
            verificationStatus: biz.verificationStatus,
            verificationTier: biz.verificationTier,
            latest,
        };
    }
}