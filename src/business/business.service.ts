// src/business/business.service.ts
import {
    Injectable,
    NotFoundException,
    ForbiddenException,
    BadRequestException,
    ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
    CreateBusinessDto, UpdateBusinessDto, RequestBusinessVerificationDto, SetBusinessActivitiesDto,
    AddBusinessMemberDto, UpdateBusinessMemberDto,
} from './business.dto';
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

    /**
     * نرمال‌سازی شماره موبایل ایرانی — ارقام فارسی/عربی → لاتین، +98/0098 → 0
     * برگشت: «09xxxxxxxxx» یا null (نامعتبر)
     */
    static normalizePhone(raw: string): string | null {
        const fa = '۰۱۲۳۴۵۶۷۸۹';
        const ar = '٠١٢٣٤٥٦٧٨٩';
        let s = (raw || '').trim();
        s = s.replace(/[۰-۹]/g, (d) => String(fa.indexOf(d)))
            .replace(/[٠-٩]/g, (d) => String(ar.indexOf(d)))
            .replace(/[^+\d]/g, '');
        if (s.startsWith('+98')) s = '0' + s.slice(3);
        else if (s.startsWith('0098')) s = '0' + s.slice(4);
        else if (s.startsWith('98') && s.length === 12) s = '0' + s.slice(2);
        else if (/^9\d{9}$/.test(s)) s = '0' + s;
        return /^09\d{9}$/.test(s) ? s : null;
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

        // ✅ ثبت‌کنندهٔ اول، عضو تیم کسب‌وکار می‌شود — با نقش سیستمی «ادمین» و پستِ شرکتی
        //    (دو سطح نقش: role سیستمی = admin | member — position شرکتی از USER_POSITIONS)
        await this.prisma.businessMember.upsert({
            where: { businessId_userId: { businessId: created.id, userId } },
            create: {
                businessId: created.id,
                userId,
                role: 'admin',
                position: (dto as any).position?.trim() || 'ثبت‌کنندهٔ کسب‌وکار',
                status: 'active',
            },
            update: { role: 'admin' },
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
                activities: {
                    include: {
                        activity: { select: { id: true, title: true, slug: true } },
                    },
                },
                members: {
                    where: { status: 'active' },
                    select: {
                        id: true, userId: true, role: true, position: true, viaCatalogId: true, createdAt: true,
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

    // ============================================================
    // زمینه‌های فعالیت — جایگزینی کامل لیست (صفحهٔ مدیریت کسب‌وکار)
    // ============================================================
    async setActivities(id: string, userId: string, dto: SetBusinessActivitiesDto) {
        const biz = await this.prisma.business.findUnique({
            where: { id },
            select: { ownerUserId: true, creatorUserId: true },
        });
        if (!biz) {
            throw new NotFoundException({ errorCode: 'BUSINESS_NOT_FOUND', message: 'کسب‌وکار یافت نشد' });
        }
        this.assertCanEdit(biz, userId);

        // فقط شناسه‌های معتبر — بقیه رد می‌شوند
        const ids = [...new Set((dto.activityIds || []).filter((x) => /^[a-f\d]{24}$/i.test(x)))];
        const valid = ids.length
            ? await this.prisma.activity.findMany({
                  where: { id: { in: ids } },
                  select: { id: true },
              })
            : [];
        const validIds = valid.map((a) => a.id);
        const invalidCount = ids.length - validIds.length;

        await this.prisma.$transaction(async (tx) => {
            await tx.businessActivity.deleteMany({ where: { businessId: id } });
            for (const activityId of validIds) {
                await tx.businessActivity.create({ data: { businessId: id, activityId } });
            }
        });

        // باطل‌سازی کش — همان الگوی update (کاتالوگ‌های عمومی دیتای کسب‌وکار را کش می‌کنند)
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

        return { success: true, count: validIds.length, ...(invalidCount > 0 ? { skipped: invalidCount } : {}) };
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
    // تیم کاری کسب‌وکار — دو سطح نقش:
    //   • نقش سیستمی (role): «admin» مدیر کسب‌وکار / «member» عضو معمولی
    //     - سازندهٔ کسب‌وکار (creatorUserId/ownerUserId) همیشه ادمین است
    //     - ادمین می‌تواند نقش سیستمی خودش را با واگذاری به عضو دیگر اداره کند
    //   • نقش شرکتی (position): مالک، مدیرعامل، مدیر فروش، بازاریاب… (USER_POSITIONS)
    //     - اینکه چه کسی در کاتالوگ فروشنده/ویزیتور/ادمین شود، در کاتالوگ فروش تعیین می‌شود
    // ============================================================

    /** نقش عضویت کاربر جاری در کسب‌وکار — فرم کاتالوگ و UI تیم */
    async getMyMembership(businessId: string, userId: string) {
        const biz = await this.prisma.business.findUnique({
            where: { id: businessId },
            select: { id: true, creatorUserId: true, ownerUserId: true, status: true },
        });
        if (!biz || biz.status !== 'active') {
            return { isMember: false, role: null, position: null, canManageTeam: false };
        }
        const member = await this.prisma.businessMember.findUnique({
            where: { businessId_userId: { businessId, userId } },
            select: { role: true, position: true, status: true },
        });
        const active = member?.status === 'active';
        const isResponsible = biz.creatorUserId === userId || biz.ownerUserId === userId;
        return {
            isMember: active || isResponsible,
            role: isResponsible ? 'admin' : active ? member!.role : null,
            position: active ? member!.position : null,
            canManageTeam: isResponsible || (active && member!.role === 'admin'),
        };
    }

    /** گارد مدیریت تیم — سازنده/مالک یا عضوِ ادمین */
    private async assertCanManageTeam(businessId: string, userId: string) {
        const biz = await this.prisma.business.findUnique({
            where: { id: businessId },
            select: { id: true, creatorUserId: true, ownerUserId: true },
        });
        if (!biz) throw new NotFoundException({ errorCode: 'BUSINESS_NOT_FOUND', message: 'کسب‌وکار یافت نشد' });
        if (biz.creatorUserId === userId || biz.ownerUserId === userId) return biz;
        const me = await this.prisma.businessMember.findUnique({
            where: { businessId_userId: { businessId, userId } },
            select: { role: true, status: true },
        });
        if (me?.status === 'active' && me.role === 'admin') return biz;
        throw new ForbiddenException({
            errorCode: 'TEAM_ADMIN_REQUIRED',
            message: 'فقط مدیر کسب‌وکار می‌تواند اعضای تیم را مدیریت کند',
        });
    }

    /** لیست تیم کسب‌وکار — اعضای فعال با نقش سیستمی و شرکتی */
    async listMembers(businessId: string, userId: string) {
        await this.assertCanManageTeam(businessId, userId);
        const members = await this.prisma.businessMember.findMany({
            where: { businessId, status: 'active' },
            select: {
                id: true, userId: true, role: true, position: true, viaCatalogId: true,
                invitedBy: true, createdAt: true,
                user: { select: { id: true, fullName: true, avatarUrl: true } },
            },
            orderBy: { createdAt: 'asc' },
        });
        const biz = await this.prisma.business.findUnique({
            where: { id: businessId },
            select: { creatorUserId: true, ownerUserId: true },
        });
        return {
            items: members.map((m) => ({
                ...m,
                isCreator: m.userId === biz?.creatorUserId || m.userId === biz?.ownerUserId,
            })),
        };
    }

    /** افزودن عضو تیم با شماره موبایل — فقط مدیر کسب‌وکار */
    async addMember(businessId: string, userId: string, dto: AddBusinessMemberDto) {
        await this.assertCanManageTeam(businessId, userId);
        const biz = await this.prisma.business.findUnique({
            where: { id: businessId },
            select: { id: true, status: true },
        });
        if (!biz || biz.status !== 'active') {
            throw new BadRequestException({ errorCode: 'BUSINESS_INACTIVE', message: 'این کسب‌وکار فعال نیست' });
        }

        const phone = BusinessService.normalizePhone(dto.phone);
        if (!phone) {
            throw new BadRequestException({
                errorCode: 'PHONE_INVALID',
                message: 'شماره موبایل معتبر نیست — مثلاً: 09123456789',
            });
        }
        const target = await this.prisma.user.findUnique({ where: { phone }, select: { id: true } });
        if (!target) {
            throw new NotFoundException({
                errorCode: 'USER_NOT_FOUND',
                message: 'کاربری با این شماره در دیمت پیدا نشد — اول باید ثبت‌نام کند',
            });
        }

        const existing = await this.prisma.businessMember.findUnique({
            where: { businessId_userId: { businessId, userId: target.id } },
        });
        if (existing?.status === 'active') {
            throw new ConflictException({
                errorCode: 'MEMBER_EXISTS',
                message: 'این کاربر از قبل عضو تیم این کسب‌وکار است',
            });
        }

        const member = await this.prisma.businessMember.upsert({
            where: { businessId_userId: { businessId, userId: target.id } },
            create: {
                businessId,
                userId: target.id,
                role: dto.role === 'admin' ? 'admin' : 'member',
                position: dto.position?.trim() || null,
                invitedBy: userId,
                status: 'active',
            },
            update: {
                role: dto.role === 'admin' ? 'admin' : 'member',
                ...(dto.position !== undefined ? { position: dto.position?.trim() || null } : {}),
                invitedBy: userId,
                status: 'active',
            },
        });

        await this.cache.bust(`profile:${target.id}`);
        return { success: true, member };
    }

    /**
     * ویرایش عضو تیم — نقش شرکتی و/یا سیستمی
     * memberId = «me» → عضویت خود کاربر (هر عضوی می‌تواند نقش شرکتی خودش را عوض کند)
     */
    async updateMember(businessId: string, userId: string, memberId: string, dto: UpdateBusinessMemberDto) {
        const isSelf = memberId === 'me';
        if (!isSelf) await this.assertCanManageTeam(businessId, userId);

        const target = isSelf
            ? await this.prisma.businessMember.findUnique({
                  where: { businessId_userId: { businessId, userId } },
              })
            : await this.prisma.businessMember.findFirst({
                  where: { id: memberId, businessId },
              });
        if (!target || target.status !== 'active') {
            throw new NotFoundException({ errorCode: 'MEMBER_NOT_FOUND', message: 'عضو تیم یافت نشد' });
        }

        // تغییر نقش سیستمی فقط توسط ادمین (خودِ عضو معمولی نمی‌تواند خودش را ادمین کند)
        if (dto.role !== undefined && dto.role !== target.role) {
            if (isSelf) await this.assertCanManageTeam(businessId, userId);
            // گارد: حداقل یک ادمین باید بماند — سازنده/مالک همیشه ادمین است،
            // پس فقط وقتی خطرناک است که هدفِ سلب‌شده، آخرین ادمینِ غیرِمسئول باشد
            if (dto.role === 'member' && target.role === 'admin') {
                const biz = await this.prisma.business.findUnique({
                    where: { id: businessId },
                    select: { creatorUserId: true, ownerUserId: true },
                });
                const isResponsible = target.userId === biz?.creatorUserId || target.userId === biz?.ownerUserId;
                if (!isResponsible) {
                    const adminCount = await this.prisma.businessMember.count({
                        where: { businessId, status: 'active', role: 'admin', NOT: { userId: target.userId } },
                    });
                    const responsibleIsMemberAdmin = !!(biz?.creatorUserId || biz?.ownerUserId);
                    if (adminCount === 0 && !responsibleIsMemberAdmin) {
                        throw new BadRequestException({
                            errorCode: 'LAST_ADMIN',
                            message: 'حداقل یک مدیر باید در تیم بماند — اول مدیریت را به عضو دیگری واگذار کن',
                        });
                    }
                }
            }
        }

        const updated = await this.prisma.businessMember.update({
            where: { id: target.id },
            data: {
                ...(dto.position !== undefined ? { position: dto.position?.trim() || null } : {}),
                ...(dto.role !== undefined ? { role: dto.role === 'admin' ? 'admin' : 'member' } : {}),
            },
        });

        await this.cache.bust(`profile:${target.userId}`);
        return { success: true, member: updated };
    }

    /** حذف عضو تیم (status=removed) — فقط مدیر؛ خودش را نمی‌تواند حذف کند */
    async removeMember(businessId: string, userId: string, memberId: string) {
        await this.assertCanManageTeam(businessId, userId);
        const target = await this.prisma.businessMember.findFirst({
            where: { id: memberId, businessId },
        });
        if (!target || target.status !== 'active') {
            throw new NotFoundException({ errorCode: 'MEMBER_NOT_FOUND', message: 'عضو تیم یافت نشد' });
        }
        if (target.userId === userId) {
            throw new BadRequestException({
                errorCode: 'SELF_REMOVE_FORBIDDEN',
                message: 'حذف خودت از تیم از اینجا ممکن نیست',
            });
        }

        await this.prisma.businessMember.update({
            where: { id: target.id },
            data: { status: 'removed' },
        });

        await this.cache.bust(`profile:${target.userId}`);
        return { success: true };
    }


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
