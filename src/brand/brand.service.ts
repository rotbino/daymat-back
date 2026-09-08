// src/brand/brand.service.ts
import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBrandDto, UpdateBrandDto } from './brand.dto';

@Injectable()
export class BrandService {
    constructor(private prisma: PrismaService) {}

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

        const where: any = { isActive: true };

        if (q && q.trim().length >= 2) {
            const query = q.trim();
            where.$or = [
                { title: { $regex: query, $options: 'i' } },
                { keywords: { $regex: query, $options: 'i' } },
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
    // ✅ بررسی تکراری نبودن title (case-insensitive)
    // ✅ isByUser=true برای برندهای کاربر-ساخته
    // ============================================================
    async create(dto: CreateBrandDto, userId?: string) {
        const title = dto.title.trim();
        if (!title) {
            throw new ConflictException({
                errorCode: 'TITLE_REQUIRED',
                message: 'عنوان برند الزامی است',
            });
        }

        // ✅ بررسی تکراری نبودن (case-insensitive)
        const existing = await this.prisma.brand.findFirst({
            where: {
                title: { equals: title, mode: 'insensitive' },
                isActive: true,
            },
            select: { id: true, title: true, category: true, logoUrl: true, isByUser: true },
        });
        if (existing) {
            return { ...existing, _existed: true };
        }

        let slug = this.slugify(title);
        let suffix = 1;
        while (await this.prisma.brand.findUnique({ where: { slug }, select: { id: true } })) {
            slug = `${this.slugify(title)}-${suffix++}`;
        }

        return this.prisma.brand.create({
            data: {
                title,
                slug,
                category: dto.category || null,
                keywords: dto.keywords || [],
                logoUrl: dto.logoUrl || null,
                description: dto.description || null,
                confirmed: false,  // ✅ کاربر ساخت → نیاز به تأیید ادمین
                isByUser: true,    // ✅ مارک‌گذاری به‌عنوان کاربر-ساخته
            },
            select: { id: true, title: true, category: true, logoUrl: true, isByUser: true },
        });
    }

    // ============================================================
    // به‌روزرسانی برند
    // ============================================================
    async update(id: string, dto: UpdateBrandDto) {
        return this.prisma.brand.update({
            where: { id },
            data: {
                ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
                ...(dto.category !== undefined ? { category: dto.category } : {}),
                ...(dto.keywords !== undefined ? { keywords: dto.keywords } : {}),
                ...(dto.logoUrl !== undefined ? { logoUrl: dto.logoUrl } : {}),
                ...(dto.description !== undefined ? { description: dto.description } : {}),
                ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
                ...(dto.confirmed !== undefined ? { confirmed: dto.confirmed } : {}),
            },
        });
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
}
