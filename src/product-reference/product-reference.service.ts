// src/product-reference/product-reference.service.ts
import { Injectable, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto, UpdateProductDto } from './product-reference.dto';
import { normalizeForStore, findDuplicateTitle } from '../common/persian-text.util';
import { CacheHelper } from '../common/services/cache.helper';

/** TTL کش سرچ کالا — کوتاه تا تازگی داده حفظ بشه ولی فشار تایپ سریع (typeahead) از DB برداشته بشه */
const SEARCH_CACHE_TTL_MS = 30_000;

@Injectable()
export class ProductReferenceService {
    constructor(private prisma: PrismaService, private cache: CacheHelper) {}

    private slugify(title: string): string {
        const base = title.trim()
            .replace(/\s+/g, '-')
            .replace(/[^\u0600-\u06FF\u0750-\u077F\w\-]/g, '')
            .toLowerCase();
        return base || `product-${Date.now()}`;
    }

    // ============================================================
    // جستجوی کالا — با pagination
    // ✅ سرچ روی title و keywords
    // ✅ حداقل ۲ حرف برای سرچ
    // ✅ صفحه‌بندی: page + limit (پیش‌فرض ۱۰)
    // ✅ فیلتر mine: فقط کالاهای خود کاربر
    // ============================================================
    async search(options: {
        q?: string;
        category?: string;
        page?: number;
        limit?: number;
        mine?: boolean;
        userId?: string;
    }) {
        const { q, category, page = 1, limit = 10, mine = false, userId } = options;
        const take = Math.min(limit, 50);
        const skip = (page - 1) * take;

        // ✅ کش — کلید شامل همهٔ پارامترهاست؛ با هر create/update/delete باطل می‌شه
        return this.cache.wrap(
            'prod-search',
            [q, category, page, take, mine, userId],
            SEARCH_CACHE_TTL_MS,
            async () => {
                return this.runSearchQuery({ q, category, page, take, skip, mine, userId });
            },
        );
    }

    private async runSearchQuery(options: {
        q?: string; category?: string; page: number; take: number; skip: number; mine?: boolean; userId?: string;
    }) {
        const { q, category, page, take, skip, mine = false, userId } = options;

        const where: any = { isActive: true };

        if (mine && userId) {
            where.createdByUserId = userId;
        }

        if (q && q.trim().length >= 2) {
            const query = q.trim();
            where.OR = [
                { title: { contains: query, mode: 'insensitive' } },
                { keywords: { has: query } },
                // ✅ سرچ روی نام برند هم
                { brand: { is: { title: { contains: query, mode: 'insensitive' } } } },
            ];
        }
        if (category) where.category = category;

        const [items, total] = await Promise.all([
            this.prisma.productReference.findMany({
                where,
                select: {
                    id: true,
                    title: true,
                    brandId: true,
                    brand: { select: { id: true, title: true, logoUrl: true } },
                    category: true,
                    imageUrl: true,
                    thumbnailUrl: true,
                    specs: true,  // ✅ برای prefill ویرایش ویژگی‌های کالا
                    usageCount: true,
                    isByUser: true,
                    isNew: true,
                    createdByUserId: true,
                },
                orderBy: { usageCount: 'desc' },
                take,
                skip,
            }),
            this.prisma.productReference.count({ where }),
        ]);

        const hasMore = skip + items.length < total;

        return { items, total, page, hasMore };
    }

    // ============================================================
    // ایجاد کالای جدید
    // ✅ isNew=true, isByUser=true
    // ✅ جلوگیری قطعی از تکرار — نرمال‌سازی فاصله/حروف عربی-فارسی/اعداد
    // ============================================================
    async create(dto: CreateProductDto, userId?: string) {
        const title = normalizeForStore(dto.title || '');
        if (!title) {
            throw new ConflictException({
                errorCode: 'TITLE_REQUIRED',
                message: 'عنوان کالا الزامی است',
            });
        }

        // ✅ بررسی تکراری با نرمال‌سازی کامل (فاصله، ی/ی، ک/ك، اعداد و…)
        const existing = await findDuplicateTitle(this.prisma.productReference, title);
        if (existing) {
            return { ...existing, _existed: true };
        }

        let slug = this.slugify(title);
        let suffix = 1;
        while (await this.prisma.productReference.findUnique({ where: { slug }, select: { id: true } })) {
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

        const autoKeywords = title.split(/\s+/).filter(w => w.length >= 2);
        const keywords = Array.from(new Set([...autoKeywords, ...(dto.keywords || [])]));

        const created = await this.prisma.productReference.create({
            data: {
                title,
                slug,
                brandId: dto.brandId || null,
                category: dto.category || null,
                keywords,
                imageUrl: dto.imageUrl || null,
                thumbnailUrl: dto.thumbnailUrl || null,
                description: dto.description || null,
                unitHints: dto.unitHints || [],
                // ✅ ویژگی‌های کالا — حالا مال کالاست نه آگهی
                specs: (dto as any).specs ?? null,
                metadata: dto.metadata || null,
                confirmed: false,
                isByUser: true,
                isNew: true,  // ✅ جدید و قابل ویرایش
                createdByUserId: userId || null,
                armId,  // ✅ بازار مبدأ — برای نظارت مالک بازار
            },
            select: {
                id: true, title: true, brandId: true,
                brand: { select: { id: true, title: true } },
                category: true, imageUrl: true, thumbnailUrl: true,
                usageCount: true, isByUser: true, isNew: true, createdByUserId: true,
            },
        });
        // ✅ باطل‌سازی کش سرچ
        await this.cache.bust('prod-search');
        return created;
    }

    // ============================================================
    // به‌روزرسانی کالا
    // ✅ فقط سازنده می‌تونه ویرایش کنه
    // ✅ فقط اگه isNew=true باشه قابل ویرایشه
    // ✅ تغییر عنوان نباید کالای تکراری بسازد
    // ============================================================
    async update(id: string, dto: UpdateProductDto, userId?: string) {
        const product = await this.prisma.productReference.findUnique({
            where: { id },
            select: { createdByUserId: true, isNew: true },
        });
        if (!product) {
            throw new NotFoundException({ errorCode: 'PRODUCT_NOT_FOUND', message: 'کالا یافت نشد' });
        }

        // ✅ اگه کاربر لاگین کرده و سازنده نیست → خطا
        if (userId && product.createdByUserId && product.createdByUserId !== userId) {
            throw new ForbiddenException({
                errorCode: 'NOT_OWNER',
                message: 'فقط سازنده کالا می‌تونه ویرایش کنه',
            });
        }

        // ✅ اگه isNew=false (تأییدشده) → فقط ادمین می‌تونه ویرایش کنه
        if (!product.isNew && userId) {
            throw new ForbiddenException({
                errorCode: 'PRODUCT_CONFIRMED',
                message: 'این کالا تأیید شده و قابل ویرایش نیست',
            });
        }

        // ✅ جلوگیری از عنوان تکراری هنگام تغییر عنوان
        if (dto.title !== undefined) {
            const normalized = normalizeForStore(dto.title || '');
            if (!normalized) {
                throw new ConflictException({
                    errorCode: 'TITLE_REQUIRED',
                    message: 'عنوان کالا الزامی است',
                });
            }
            const dup = await findDuplicateTitle(this.prisma.productReference, normalized, id);
            if (dup) {
                throw new ConflictException({
                    errorCode: 'DUPLICATE_TITLE',
                    message: `کالای «${dup.title}» قبلاً ثبت شده است — تکراری مجاز نیست`,
                });
            }
            dto = { ...dto, title: normalized };
        }

        const updated = await this.prisma.productReference.update({
            where: { id },
            data: {
                ...(dto.title !== undefined ? { title: dto.title } : {}),
                ...(dto.brandId !== undefined ? { brandId: dto.brandId || null } : {}),
                ...(dto.category !== undefined ? { category: dto.category } : {}),
                ...(dto.keywords !== undefined ? { keywords: dto.keywords } : {}),
                ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl } : {}),
                ...(dto.thumbnailUrl !== undefined ? { thumbnailUrl: dto.thumbnailUrl } : {}),
                ...(dto.description !== undefined ? { description: dto.description } : {}),
                ...(dto.unitHints !== undefined ? { unitHints: dto.unitHints } : {}),
                // ✅ ویژگی‌های کالا
                ...((dto as any).specs !== undefined ? { specs: (dto as any).specs } : {}),
                ...(dto.metadata !== undefined ? { metadata: dto.metadata } : {}),
            },
        });
        // ✅ باطل‌سازی کش سرچ
        await this.cache.bust('prod-search');
        return updated;
    }

    // ============================================================
    // حذف کالا — فقط سازنده + فقط isNew
    // ✅ اگه در آگهی‌ها استفاده شده، آگهی‌های مرتبط رو هم detached کن
    // ============================================================
    async delete(id: string, userId?: string) {
        const product = await this.prisma.productReference.findUnique({
            where: { id },
            select: {
                createdByUserId: true,
                isNew: true,
                title: true,
                ads: {
                    select: { id: true, title: true },
                    take: 5,
                },
            },
        });
        if (!product) {
            throw new NotFoundException({
                errorCode: 'PRODUCT_NOT_FOUND',
                message: 'کالای مرجع یافت نشد',
            });
        }
        if (userId && product.createdByUserId && product.createdByUserId !== userId) {
            throw new ForbiddenException({
                errorCode: 'NOT_OWNER',
                message: 'فقط سازنده کالا می‌تونه حذف کنه',
            });
        }
        if (!product.isNew) {
            throw new ForbiddenException({
                errorCode: 'PRODUCT_CONFIRMED',
                message: 'این کالا تأیید شده و قابل حذف نیست',
            });
        }

        // ✅ اگه آگهی‌های مرتبط هستن، اول reference رو پاک کن
        if (product.ads.length > 0) {
            await this.prisma.ad.updateMany({
                where: { productReferenceId: id },
                data: { productReferenceId: null },
            });
        }

        const deleted = await this.prisma.productReference.delete({ where: { id } });
        // ✅ باطل‌سازی کش سرچ
        await this.cache.bust('prod-search');
        return deleted;
    }
}
