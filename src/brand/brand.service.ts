// src/brand/brand.service.ts
import {Injectable, ConflictException, NotFoundException, ForbiddenException} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBrandDto, UpdateBrandDto } from './brand.dto';
import { normalizeForStore, findDuplicateTitle } from '../common/persian-text.util';
import { CacheHelper } from '../common/services/cache.helper';

/** TTL کش سرچ برند */
const SEARCH_CACHE_TTL_MS = 30_000;

@Injectable()
export class BrandService {
    constructor(private prisma: PrismaService, private cache: CacheHelper) {}

    // ============================================================
    // ساخت slug فارسی‌پسند
    // ============================================================
    private slugify(title: string): string {
        const base = title.trim()
            .replace(/\s+/g, '-')
            .replace(/[^\u0600-\u06FF\u0750-\u077F\w\-]/g, '')
            .toLowerCase();
        // اگه خالی شد (مثلاً فقط علامت بود)، از timestamp استفاده کن
        return base || `brand-${Date.now()}`;
    }

    // ============================================================
    // جستجوی برند — با pagination
    // ✅ حداقل ۲ حرف برای سرچ
    // ✅ صفحه‌بندی: page + limit (پیش‌فرض ۱۰)
    // ============================================================
    async search(options: {
        q?: string;
        category?: string;
        page?: number;
        limit?: number;
    }) {
        const { q, category, page = 1, limit = 10 } = options;
        const take = Math.min(limit, 50);
        const skip = (page - 1) * take;

        // ✅ کش — با هر create/update/delete باطل می‌شه
        return this.cache.wrap(
            'brand-search',
            [q, category, page, take],
            SEARCH_CACHE_TTL_MS,
            async () => this.runSearchQuery({ q, category, page, take, skip }),
        );
    }

    private async runSearchQuery(options: {
        q?: string; category?: string; page: number; take: number; skip: number;
    }) {
        const { q, category, page, take, skip } = options;

        const where: any = { isActive: true };

        if (q && q.trim().length >= 2) {
            const query = q.trim();
            where.OR = [
                { title: { contains: query, mode: 'insensitive' } },
                { keywords: { has: query } },
            ];
        }
        if (category) where.category = category;

        const [items, total] = await Promise.all([
            this.prisma.brand.findMany({
                where,
                select: {
                    id: true,
                    title: true,
                    category: true,
                    logoUrl: true,
                    usageCount: true,
                    isByUser: true,
                },
                orderBy: { usageCount: 'desc' },
                take,
                skip,
            }),
            this.prisma.brand.count({ where }),
        ]);

        const hasMore = skip + items.length < total;
        return { items, total, page, hasMore };
    }

    // ============================================================
    // ایجاد برند جدید
    // ✅ جلوگیری قطعی از تکرار — نرمال‌سازی فاصله/حروف عربی-فارسی/اعداد
    // ✅ isByUser=true برای برندهای کاربر-ساخته
    // ✅ createdByUserId + armId — برای نظارت مالک بازار روی داده‌های پایهٔ بازارش
    // ============================================================
    async create(dto: CreateBrandDto, userId?: string) {
        const title = normalizeForStore(dto.title || '');
        if (!title) {
            throw new ConflictException({
                errorCode: 'TITLE_REQUIRED',
                message: 'عنوان برند الزامی است',
            });
        }

        // ✅ بررسی تکراری با نرمال‌سازی کامل (فاصله، ی/ی، ک/ك، اعداد و…)
        const existing = await findDuplicateTitle(this.prisma.brand, title);
        if (existing) {
            return { ...existing, _existed: true };
        }

        let slug = this.slugify(title);
        let suffix = 1;
        while (await this.prisma.brand.findUnique({ where: { slug }, select: { id: true } })) {
            slug = `${this.slugify(title)}-${suffix++}`;
        }

        // ✅ اتصال به بازارِ مبدأ — اگه اسلاگ بازار رسیده باشد (بی‌صدا نادیده گرفته می‌شود)
        let armId: string | null = null;
        if (dto.armSlug) {
            const arm = await this.prisma.arm.findUnique({
                where: { slug: dto.armSlug },
                select: { id: true },
            }).catch(() => null);
            armId = arm?.id || null;
        }

        const created = await this.prisma.brand.create({
            data: {
                title,
                slug,
                category: dto.category || null,
                keywords: dto.keywords || [],
                logoUrl: dto.logoUrl || null,
                description: dto.description || null,
                confirmed: false,  // ✅ کاربر ساخت → نیاز به تأیید ادمین
                isByUser: true,    // ✅ مارک‌گذاری به‌عنوان کاربر-ساخته
                armId,             // ✅ بازار مبدأ
                createdByUserId: userId || null,  // ✅ کاربر ثبت‌کننده
            },
            select: { id: true, title: true, category: true, logoUrl: true, isByUser: true },
        });
        // ✅ باطل‌سازی کش سرچ
        await this.cache.bust('brand-search');
        return created;
    }

    // ============================================================
    // به‌روزرسانی برند
    // ✅ تغییر عنوان نباید برند تکراری بسازد
    // ✅ فقط ادمین یا سازندهٔ برندِ تأییدنشده اجازهٔ ویرایش دارد
    // ============================================================
    async update(id: string, dto: UpdateBrandDto, user?: { id: string; role?: string }) {
        const brand = await this.prisma.brand.findUnique({
            where: { id },
            select: { id: true, confirmed: true, createdByUserId: true },
        });
        if (!brand) {
            throw new NotFoundException({ errorCode: 'BRAND_NOT_FOUND', message: 'برند یافت نشد' });
        }
        // ✅ گارد نقش — ادمین سیستم یا سازندهٔ برندِ تأییدنشده
        if (user?.role !== 'system_admin') {
            if (brand.confirmed) {
                throw new ForbiddenException({
                    errorCode: 'BRAND_CONFIRMED',
                    message: 'این برند تأیید شده است — ویرایش فقط توسط ادمین سیستم',
                });
            }
            if (!brand.createdByUserId || brand.createdByUserId !== user?.id) {
                throw new ForbiddenException({
                    errorCode: 'NOT_OWNER',
                    message: 'فقط سازندهٔ برند یا ادمین سیستم می‌تواند ویرایش کند',
                });
            }
        }
        if (dto.title !== undefined) {
            const normalized = normalizeForStore(dto.title || '');
            if (!normalized) {
                throw new ConflictException({
                    errorCode: 'TITLE_REQUIRED',
                    message: 'عنوان برند الزامی است',
                });
            }
            const dup = await findDuplicateTitle(this.prisma.brand, normalized, id);
            if (dup) {
                throw new ConflictException({
                    errorCode: 'DUPLICATE_TITLE',
                    message: `برند «${dup.title}» قبلاً ثبت شده است — تکراری مجاز نیست`,
                });
            }
            dto = { ...dto, title: normalized };
        }
        const updated = await this.prisma.brand.update({
            where: { id },
            data: {
                ...(dto.title !== undefined ? { title: dto.title } : {}),
                ...(dto.category !== undefined ? { category: dto.category } : {}),
                ...(dto.keywords !== undefined ? { keywords: dto.keywords } : {}),
                ...(dto.logoUrl !== undefined ? { logoUrl: dto.logoUrl } : {}),
                ...(dto.description !== undefined ? { description: dto.description } : {}),
                ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
                ...(dto.confirmed !== undefined ? { confirmed: dto.confirmed } : {}),
            },
        });
        // ✅ باطل‌سازی کش سرچ
        await this.cache.bust('brand-search');
        return updated;
    }

    // ============================================================
    // افزایش usageCount — وقتی در آگهی استفاده شد
    // ============================================================
    async incrementUsage(id: string) {
        await this.prisma.brand.update({
            where: { id },
            data: { usageCount: { increment: 1 } },
        }).catch(() => {});
    }

    // ============================================================
    // حذف برند — فقط ادمین یا سازندهٔ برندِ تأییدنشده
    // ✅ اگه در آگهی‌ها/کالاها استفاده شده، reference‌ها رو null کن
    // ============================================================
    async delete(id: string, user?: { id: string; role?: string }) {
        const brand = await this.prisma.brand.findUnique({
            where: { id },
            select: {
                isByUser: true,
                confirmed: true,
                createdByUserId: true,
                ads: { select: { id: true } },
                products: { select: { id: true } },
            },
        });
        if (!brand) {
            throw new NotFoundException({ errorCode: 'BRAND_NOT_FOUND', message: 'برند یافت نشد' });
        }
        // ✅ گارد نقش — ادمین سیستم یا سازندهٔ برندِ تأییدنشده
        if (user?.role !== 'system_admin') {
            if (brand.confirmed) {
                throw new ForbiddenException({ errorCode: 'BRAND_CONFIRMED', message: 'این برند تأیید شده و قابل حذف نیست' });
            }
            if (!brand.createdByUserId || brand.createdByUserId !== user?.id) {
                throw new ForbiddenException({
                    errorCode: 'NOT_OWNER',
                    message: 'فقط سازندهٔ برند یا ادمین سیستم می‌تواند حذف کند',
                });
            }
        }

        // ✅ reference‌ها رو null کن
        if (brand.ads.length > 0) {
            await this.prisma.ad.updateMany({
                where: { brandId: id },
                data: { brandId: null },
            });
        }
        if (brand.products.length > 0) {
            await this.prisma.productReference.updateMany({
                where: { brandId: id },
                data: { brandId: null },
            });
        }

        const deleted = await this.prisma.brand.delete({ where: { id } });
        // ✅ باطل‌سازی کش سرچ
        await this.cache.bust('brand-search');
        return deleted;
    }
}
