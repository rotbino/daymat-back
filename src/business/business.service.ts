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
 * نهاد تجاری — کسب‌وکارِ «مرجع» و مشترک:
 *  - مالکِ شخصی ندارد؛ ثبت‌کنندهٔ اول در creatorUserId ذخیره می‌شود (نه لزوماً مالک)
 *  - هر فروشنده/کارمندی که کاتالوگش را به این کسب‌وکار وصل کند، عضو تیمش می‌شود (BusinessMember)
 *  - ویرایش: ثبت‌کنندهٔ اول یا مالکِ قدیمی (legacy) — دیتای مشترک باید تمیز بماند
 *  - salesType اینجا ممنوع (صفت ویترین است) | slug ندارد | تیک اعتماد: مرجع واقعی
 */
@Injectable()
export class BusinessService {
    constructor(
        private prisma: PrismaService,
        private cache: CacheHelper,
    ) {}

    /** کاربرِ مسئولِ کسب‌وکار — مالکِ قدیمی یا ثبت‌کنندهٔ اول */
    static responsibleUserId(biz: { ownerUserId?: string | null; creatorUserId?: string | null }): string | null {
        return biz.ownerUserId || biz.creatorUserId || null;
    }

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

    // ============================================================
    // جستجوی کسب‌وکارها — برای «اول جستجو کن، تکراری ثبت نکن»
    // عمومی (لاگین اختیاری) — فلوی انتخاب کسب‌وکار هنگام ساخت کاتالوگ
    // ============================================================
    async search(q: string, provinceCode?: string, cityCode?: string, limit = 12, offset = 0, ids?: string[]) {
        const where: any = { status: 'active' };
        if (ids && ids.length) {
            where.id = { in: ids };
        } else {
            const term = (q || '').trim();
            if (term) {
                where.OR = [{ name: { contains: term } }, { industryName: { contains: term } }];
            }
            if (provinceCode) where.provinceCode = provinceCode;
            if (cityCode) where.cityCode = cityCode;
        }

        const [items, total] = await Promise.all([
            this.prisma.business.findMany({
                where,
                select: {
                    id: true, name: true, logoUrl: true, shortDescription: true,
                    industryName: true, businessRole: true, businessSector: true, type: true,
                    province: true, provinceCode: true, city: true, cityCode: true,
                    createdAt: true,
                    _count: { select: { catalogs: { where: { status: 'active' } } } },
                },
                orderBy: [{ catalogs: { _count: 'desc' } }, { createdAt: 'desc' }],
                take: Math.min(Math.max(limit, 1), 30),
                skip: Math.max(offset, 0),
            }),
            this.prisma.business.count({ where }),
        ]);
        return {
            items: items.map((b) => ({ ...b, catalogsCount: (b as any)._count?.catalogs ?? 0 })),
            total,
        };
    }

    // ============================================================
    // ثبت کسب‌وکار جدید — ثبت‌کنندهٔ اول می‌شوید (نه مالک)
    // ⚠️ کپیِ تکراری ممنوع: اگر کسب‌وکار مشابه (نام + استان/شهر) هست،
    //    با duplicateWarning برگشت می‌دارد تا کاربر اول جستجو/انتخاب کند
    // ============================================================
    async create(userId: string, dto: CreateBusinessDto) {
        if (!dto.name?.trim()) {
            throw new BadRequestException({
                errorCode: 'NAME_REQUIRED',
                message: 'نام کسب‌وکار الزامی است',
            });
        }

        // ✅ گارد تکراری‌ثبتی — قبل از ساخت، مشابه‌ها را نشان بده
        if (!dto.force) {
            const nameTerm = dto.name.trim();
            const candidates = await this.prisma.business.findMany({
                where: {
                    status: 'active',
                    OR: [
                        { name: nameTerm },
                        ...(dto.provinceCode ? [{ AND: [{ name: { contains: nameTerm } }, { provinceCode: dto.provinceCode }] }] : []),
                        ...(dto.cityCode ? [{ AND: [{ name: { contains: nameTerm } }, { cityCode: dto.cityCode }] }] : []),
                        // بدون موقعیت — فقط تطابقِ قویِ نام
                        ...(!dto.provinceCode && !dto.cityCode ? [{ name: { contains: nameTerm } }] : []),
                    ],
                },
                select: {
                    id: true, name: true, logoUrl: true, industryName: true,
                    province: true, city: true, cityCode: true, provinceCode: true,
                },
                take: 5,
                orderBy: { createdAt: 'desc' },
            });
            if (candidates.length > 0) {
                return {
                    duplicateWarning: true,
                    message: 'کسب‌وکارهایی با نام مشابه قبلاً ثبت شده‌اند — ممکن است همکارانتان این کسب‌وکار را ثبت کرده باشند. اگر همین است، انتخابش کنید؛ دیتای تکراری نسازید.',
                    candidates,
                };
            }
        }

        // ✅ اگه صنف وارد شده، در جدول Industry هم ذخیره کن
        const resolvedIndustryId = await this.ensureIndustryExists(
            (dto as any).industryId,
            dto.industryName,
        );

        const created = await this.prisma.business.create({
            data: {
                creatorUserId: userId, // ✅ ثبت‌کنندهٔ اول — مالک محسوب نمی‌شود
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

        // ✅ ثبت‌کنندهٔ اول، عضو تیم کسب‌وکار هم می‌شود (با پستِ اختیاری)
        await this.prisma.businessMember.upsert({
            where: { businessId_userId: { businessId: created.id, userId } },
            create: {
                businessId: created.id,
                userId,
                position: (dto as any).position?.trim() || 'ثبت‌کنندهٔ کسب‌وکار',
                status: 'active',
            },
            update: {},
        }).catch(() => {});

        await this.cache.bust(`profile:${userId}`);

        return created;
    }

    // ============================================================
    // کسب‌وکارهای من — ثبت‌کننده / مالکِ قدیمی / عضوِ تیم
    // canEdit: فقط ثبت‌کنندهٔ اول یا مالکِ قدیمی مجاز به ویرایش مشخصات است
    // ============================================================
    async getMy(userId: string) {
        const memberships = await this.prisma.businessMember.findMany({
            where: { userId, status: 'active' },
            select: { businessId: true, position: true },
        });
        const memberBizIds = memberships.map((m) => m.businessId);
        const memberPos = new Map(memberships.map((m) => [m.businessId, m.position]));

        const items = await this.prisma.business.findMany({
            where: {
                status: 'active',
                OR: [
                    { creatorUserId: userId },
                    { ownerUserId: userId },
                    ...(memberBizIds.length ? [{ id: { in: memberBizIds } }] : []),
                ],
            },
            select: {
                id: true, name: true, type: true,
                businessRole: true,
                businessSector: true,
                industryName: true,
                industryId: true,
                shortDescription: true, province: true, city: true, phone: true,
                logoUrl: true, verificationStatus: true, verificationTier: true,
                creatorUserId: true, ownerUserId: true,
                createdAt: true,
                _count: { select: { catalogs: true } },
            },
            orderBy: { createdAt: 'asc' },
        });

        return {
            items: items.map((b) => ({
                ...b,
                position: memberPos.get(b.id) ?? null,
                canEdit: b.creatorUserId === userId || b.ownerUserId === userId,
            })),
        };
    }

    /** دسترسی ویرایش کسب‌وکار — ثبت‌کنندهٔ اول یا مالکِ قدیمی */
    private assertCanEdit(biz: { ownerUserId: string | null; creatorUserId: string | null }, userId: string) {
        if (biz.creatorUserId !== userId && biz.ownerUserId !== userId) {
            throw new ForbiddenException({
                errorCode: 'FORBIDDEN',
                message: 'فقط ثبت‌کنندهٔ کسب‌وکار اجازه ویرایش دارد',
            });
        }
    }

    async findOne(id: string, userId: string) {
        const biz = await this.prisma.business.findUnique({
            where: { id },
            include: {
                catalogs: {
                    where: { status: 'active' },
                    select: { id: true, name: true, slug: true, salesType: true, status: true, ownerUserId: true },
                },
                members: {
                    where: { status: 'active' },
                    select: {
                        id: true, userId: true, position: true, viaCatalogId: true, createdAt: true,
                        user: { select: { id: true, fullName: true, avatarUrl: true } },
                    },
                    orderBy: { createdAt: 'asc' },
                },
            },
        });
        if (!biz) {
            throw new NotFoundException({ errorCode: 'BUSINESS_NOT_FOUND', message: 'کسب‌وکار یافت نشد' });
        }
        if (biz.creatorUserId !== userId && biz.ownerUserId !== userId) {
            throw new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'فقط ثبت‌کنندهٔ کسب‌وکار' });
        }
        return biz;
    }

    async update(id: string, userId: string, dto: UpdateBusinessDto) {
        const biz = await this.prisma.business.findUnique({
            where: { id },
            select: { ownerUserId: true, creatorUserId: true },
        });
        if (!biz) {
            throw new NotFoundException({ errorCode: 'BUSINESS_NOT_FOUND', message: 'کسب‌وکار یافت نشد' });
        }
        this.assertCanEdit(biz, userId);

        // ✅ اگه صنف تغییر کرده، در جدول Industry هم ذخیره کن
        const industryIdChanged = (dto as any).industryId !== undefined || dto.industryName !== undefined;
        let resolvedIndustryId: string | null | undefined = undefined;
        if (industryIdChanged) {
            resolvedIndustryId = await this.ensureIndustryExists(
                (dto as any).industryId,
                dto.industryName,
            );
        }

        const updated = await this.prisma.business.update({
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

        // ⚠️ دیتای Business در لیست my-catalogs (include business) و صفحات عمومی
        //    کاتالوگ‌هایش کش می‌شود → تغییر مالک = باطل‌سازی فوری
        await this.cache.bust(`my-catalogs:${userId}`);
        const ownedCatalogs = await this.prisma.catalog.findMany({
            where: { businessId: id },
            select: { slug: true, ownerUserId: true },
        });
        await Promise.all(
            ownedCatalogs
                .filter((c) => c.slug)
                .flatMap((c) => [
                    this.cache.bust(`catalog-slug:${c.slug!}`),
                    this.cache.bust(`my-catalogs:${c.ownerUserId}`),
                ]),
        );

        return updated;
    }

    async remove(id: string, userId: string) {
        const biz = await this.prisma.business.findUnique({
            where: { id },
            select: { ownerUserId: true, creatorUserId: true, _count: { select: { catalogs: true } } },
        });
        if (!biz) {
            throw new NotFoundException({ errorCode: 'BUSINESS_NOT_FOUND', message: 'کسب‌وکار یافت نشد' });
        }
        this.assertCanEdit(biz, userId);
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
    // درخواست تیک اعتماد — مدارک روی نهاد ثبت می‌شود
    // (ادمین با admin-business.service.verifyBusiness همان‌جا می‌خواند)
    // ============================================================
    async requestVerification(businessId: string, userId: string, dto: RequestBusinessVerificationDto) {
        const biz = await this.prisma.business.findUnique({
            where: { id: businessId },
            select: { id: true, ownerUserId: true, creatorUserId: true, status: true },
        });
        if (!biz) {
            throw new NotFoundException({ errorCode: 'BUSINESS_NOT_FOUND', message: 'کسب‌وکار یافت نشد' });
        }
        this.assertCanEdit(biz, userId);
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
            select: { ownerUserId: true, creatorUserId: true, verificationStatus: true, verificationTier: true },
        });
        if (!biz) {
            throw new NotFoundException({ errorCode: 'BUSINESS_NOT_FOUND', message: 'کسب‌وکار یافت نشد' });
        }
        this.assertCanEdit(biz, userId);

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
