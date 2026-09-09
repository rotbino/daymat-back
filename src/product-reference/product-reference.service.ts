// src/product-reference/product-reference.service.ts
import { Injectable, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto, UpdateProductDto } from './product-reference.dto';

@Injectable()
export class ProductReferenceService {
    constructor(private prisma: PrismaService) {}

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

        const where: any = { isActive: true };

        if (mine && userId) {
            where.createdByUserId = userId;
        }

        if (q && q.trim().length >= 2) {
            const query = q.trim();
            where.OR = [
                { title: { contains: query, mode: 'insensitive' } },
                { keywords: { has: query } },
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
    // ============================================================
    async create(dto: CreateProductDto, userId?: string) {
        const title = dto.title.trim();
        if (!title) {
            throw new ConflictException({
                errorCode: 'TITLE_REQUIRED',
                message: 'عنوان کالا الزامی است',
            });
        }

        // ✅ بررسی تکراری نبودن (case-insensitive)
        const existing = await this.prisma.productReference.findFirst({
            where: {
                title: { equals: title, mode: 'insensitive' },
                isActive: true,
            },
            select: {
                id: true, title: true, brandId: true,
                brand: { select: { id: true, title: true } },
                category: true, imageUrl: true, thumbnailUrl: true,
                usageCount: true, isByUser: true, isNew: true, createdByUserId: true,
            },
        });
        if (existing) {
            return { ...existing, _existed: true };
        }

        let slug = this.slugify(title);
        let suffix = 1;
        while (await this.prisma.productReference.findUnique({ where: { slug }, select: { id: true } })) {
            slug = `${this.slugify(title)}-${suffix++}`;
        }

        const autoKeywords = title.split(/\s+/).filter(w => w.length >= 2);
        const keywords = Array.from(new Set([...autoKeywords, ...(dto.keywords || [])]));

        return this.prisma.productReference.create({
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
                metadata: dto.metadata || null,
                confirmed: false,
                isByUser: true,
                isNew: true,  // ✅ جدید و قابل ویرایش
                createdByUserId: userId || null,
            },
            select: {
                id: true, title: true, brandId: true,
                brand: { select: { id: true, title: true } },
                category: true, imageUrl: true, thumbnailUrl: true,
                usageCount: true, isByUser: true, isNew: true, createdByUserId: true,
            },
        });
    }

    // ============================================================
    // به‌روزرسانی کالا
    // ✅ فقط سازنده می‌تونه ویرایش کنه
    // ✅ فقط اگه isNew=true باشه قابل ویرایشه
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

        return this.prisma.productReference.update({
            where: { id },
            data: {
                ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
                ...(dto.brandId !== undefined ? { brandId: dto.brandId || null } : {}),
                ...(dto.category !== undefined ? { category: dto.category } : {}),
                ...(dto.keywords !== undefined ? { keywords: dto.keywords } : {}),
                ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl } : {}),
                ...(dto.thumbnailUrl !== undefined ? { thumbnailUrl: dto.thumbnailUrl } : {}),
                ...(dto.description !== undefined ? { description: dto.description } : {}),
                ...(dto.unitHints !== undefined ? { unitHints: dto.unitHints } : {}),
                ...(dto.metadata !== undefined ? { metadata: dto.metadata } : {}),
            },
        });
    }

    // ============================================================
    // حذف کالا — فقط سازنده + فقط isNew
    // ✅ اگه در آگهی‌ها استفاده شده، آگهی‌های مرتبط هم حذف می‌شن (cascade)
    // ============================================================
    async delete(id: string, userId?: string) {
        const product = await this.prisma.productReference.findUnique({
            where: { id },
            select: {
                createdByUserId: true,
                isNew: true,
                ads: { select: { id: true } },
            },
        });
        if (!product) {
            throw new NotFoundException({ errorCode: 'PRODUCT_NOT_FOUND', message: 'کالا یافت نشد' });
        }
        if (userId && product.createdByUserId && product.createdByUserId !== userId) {
            throw new ForbiddenException({ errorCode: 'NOT_OWNER', message: 'فقط سازنده کالا می‌تونه حذف کنه' });
        }
        if (!product.isNew) {
            throw new ForbiddenException({ errorCode: 'PRODUCT_CONFIRMED', message: 'این کالا تأیید شده و قابل حذف نیست' });
        }

        // ✅ اگه آگهی‌های مرتبط هستن، اول اون‌ها رو حذف کن
        if (product.ads.length > 0) {
            await this.prisma.ad.updateMany({
                where: { productReferenceId: id },
                data: { productReferenceId: null, status: 'deleted' },
            });
        }

        return this.prisma.productReference.delete({ where: { id } });
    }
}
