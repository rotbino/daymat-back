// src/product-reference/product-reference.service.ts
import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto, UpdateProductDto } from './product-reference.dto';

@Injectable()
export class ProductReferenceService {
    constructor(private prisma: PrismaService) {}

    // ============================================================
    // ساخت slug فارسی‌پسند
    // ============================================================
    private slugify(title: string): string {
        const base = title.trim()
            .replace(/\s+/g, '-')
            .replace(/[^\u0600-\u06FF\u0750-\u077F\w\-]/g, '')
            .toLowerCase();
        return base || `product-${Date.now()}`;
    }

    // ============================================================
    // جستجوی کالا — برای autocomplete
    // ✅ سرچ روی title و keywords
    // ✅ اگه category داده بشه، فقط همون دسته
    // ✅ سورت بر اساس usageCount
    // ============================================================
    async search(q: string, category?: string, limit = 20) {
        if (!q || q.trim().length < 2) return { items: [] };

        const query = q.trim();

        const where: any = {
            isActive: true,
            $or: [
                { title: { $regex: query, $options: 'i' } },
                { keywords: { $regex: query, $options: 'i' } },
            ],
        };
        if (category) where.category = category;

        const items = await this.prisma.productReference.findMany({
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
            },
            orderBy: { usageCount: 'desc' },
            take: Math.min(limit, 30),
        });

        return { items };
    }

    // ============================================================
    // لیست همه‌ی کالاها — برای DropSelector با search client-side
    // ============================================================
    async listForSelector(category?: string, confirmedOnly = false) {
        const where: any = { isActive: true };
        if (category) where.category = category;
        if (confirmedOnly) where.confirmed = true;

        const items = await this.prisma.productReference.findMany({
            where,
            orderBy: { title: 'asc' },
            select: {
                id: true,
                title: true,
                brandId: true,
                brand: { select: { id: true, title: true } },
                category: true,
                imageUrl: true,
                thumbnailUrl: true,
                isByUser: true,
            },
            take: 200,  // محدودیت برای performance
        });

        return { items };
    }

    // ============================================================
    // ایجاد کالای جدید
    // ✅ بررسی تکراری نبودن title (case-insensitive)
    // ✅ isByUser=true برای کالاهای کاربر-ساخته
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
                id: true, title: true, brandId: true, brand: { select: { id: true, title: true } },
                category: true, imageUrl: true, thumbnailUrl: true, usageCount: true, isByUser: true,
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
                confirmed: false,  // ✅ کاربر ساخت → نیاز به تأیید ادمین
                isByUser: true,    // ✅ مارک‌گذاری به‌عنوان کاربر-ساخته
                createdByUserId: userId || null,
            },
            select: {
                id: true, title: true, brandId: true,
                brand: { select: { id: true, title: true } },
                category: true, imageUrl: true, thumbnailUrl: true, usageCount: true, isByUser: true,
            },
        });
    }

    // ============================================================
    // به‌روزرسانی کالا
    // ============================================================
    async update(id: string, dto: UpdateProductDto) {
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
    // افزایش usageCount
    // ============================================================
    async incrementUsage(id: string) {
        await this.prisma.productReference.update({
            where: { id },
            data: { usageCount: { increment: 1 } },
        }).catch(() => {});
    }
}
