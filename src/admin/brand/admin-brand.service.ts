// src/admin/brand/admin-brand.service.ts
// ✅ مدیریت برندها برای ادمین سیستم — و در حالت scoped برای مالک بازار
import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminUpdateBrandDto } from './admin-brand.dto';
import { normalizeForStore, findDuplicateTitle } from '../../common/persian-text.util';
import { CacheHelper } from '../../common/services/cache.helper';
import { ReferenceScope } from '../product/admin-product.service';

const LIST_SELECT = {
    id: true,
    title: true,
    slug: true,
    category: true,
    logoUrl: true,
    description: true,
    keywords: true,
    isActive: true,
    confirmed: true,
    isByUser: true,
    usageCount: true,
    armId: true,
    createdByUserId: true,
    createdAt: true,
    updatedAt: true,
    _count: { select: { ads: true, products: true } },
};

@Injectable()
export class AdminBrandService {
    constructor(private prisma: PrismaService, private cache: CacheHelper) {}

    private applyScope(where: any, scope?: ReferenceScope) {
        if (!scope) return;
        const scopeOr: any[] = [];
        if (scope.armId) scopeOr.push({ armId: scope.armId });
        if (scope.memberUserIds?.length) scopeOr.push({ createdByUserId: { in: scope.memberUserIds } });
        if (scopeOr.length) where.AND = [...(where.AND || []), { OR: scopeOr }];
        else where.AND = [...(where.AND || []), { _id: { $exists: false } }];
    }

    private async attachCreatorAndArm(items: any[]) {
        const userIds = Array.from(new Set(items.map((i) => i.createdByUserId).filter(Boolean)));
        const armIds = Array.from(new Set(items.map((i) => i.armId).filter(Boolean)));
        const [users, arms] = await Promise.all([
            userIds.length
                ? this.prisma.user.findMany({
                      where: { id: { in: userIds } },
                      select: { id: true, fullName: true, phone: true },
                  })
                : Promise.resolve([]),
            armIds.length
                ? this.prisma.arm.findMany({
                      where: { id: { in: armIds } },
                      select: { id: true, name: true, slug: true },
                  })
                : Promise.resolve([]),
        ]);
        const userMap = new Map(users.map((u) => [u.id, u]));
        const armMap = new Map(arms.map((a) => [a.id, a]));
        return items.map((i) => ({
            ...i,
            creator: i.createdByUserId ? userMap.get(i.createdByUserId) || null : null,
            arm: i.armId ? armMap.get(i.armId) || null : null,
        }));
    }

    // ────────────────────────────────────────────────
    // لیست مدیریتی برندها با فیلتر و صفحه‌بندی
    // ────────────────────────────────────────────────
    async findAll(filters: {
        q?: string; category?: string; armId?: string;
        isActive?: boolean; confirmed?: boolean; isByUser?: boolean; hasProducts?: boolean;
        page?: number; limit?: number; sortBy?: string; sortOrder?: 'asc' | 'desc';
    }, scope?: ReferenceScope) {
        const page = Math.max(1, filters.page || 1);
        const take = Math.min(Math.max(1, filters.limit || 20), 100);
        const skip = (page - 1) * take;

        const where: any = {};
        if (filters.isActive !== undefined) where.isActive = filters.isActive;
        if (filters.confirmed !== undefined) where.confirmed = filters.confirmed;
        if (filters.isByUser !== undefined) where.isByUser = filters.isByUser;
        if (filters.category) where.category = filters.category;
        if (filters.armId) where.armId = filters.armId;
        if (filters.hasProducts) where.products = { some: {} };
        if (filters.q && filters.q.trim().length >= 2) {
            const query = filters.q.trim();
            where.OR = [
                { title: { contains: query, mode: 'insensitive' } },
                { keywords: { has: query } },
            ];
        }
        this.applyScope(where, scope);

        const orderByField = ['createdAt', 'usageCount', 'title'].includes(filters.sortBy || '')
            ? (filters.sortBy as any)
            : 'createdAt';
        const orderBy: any = { [orderByField]: filters.sortOrder === 'asc' ? 'asc' : 'desc' };

        const [rows, total] = await Promise.all([
            this.prisma.brand.findMany({ where, select: LIST_SELECT, orderBy, take, skip }),
            this.prisma.brand.count({ where }),
        ]);

        const items = await this.attachCreatorAndArm(rows);
        return { items, total, page, hasMore: skip + items.length < total };
    }

    // ────────────────────────────────────────────────
    // جزئیات برند + کالاهای مرجع و آگهی‌های وصل
    // ────────────────────────────────────────────────
    async findOne(id: string, scope?: ReferenceScope) {
        const row = await this.prisma.brand.findUnique({
            where: { id },
            select: LIST_SELECT,
        });
        if (!row) throw new NotFoundException({ errorCode: 'BRAND_NOT_FOUND', message: 'برند یافت نشد' });

        if (scope) {
            const inScope =
                (scope.armId && row.armId === scope.armId) ||
                (scope.memberUserIds?.length && row.createdByUserId && scope.memberUserIds.includes(row.createdByUserId));
            if (!inScope) {
                throw new ForbiddenException({ errorCode: 'OUT_OF_SCOPE', message: 'این برند به بازار شما تعلق ندارد' });
            }
        }

        const [attached] = await this.attachCreatorAndArm([row]);
        const [products, ads] = await Promise.all([
            this.prisma.productReference.findMany({
                where: { brandId: id },
                select: { id: true, title: true, imageUrl: true, usageCount: true, isActive: true },
                orderBy: { usageCount: 'desc' },
                take: 10,
            }),
            this.prisma.ad.findMany({
                where: { brandId: id },
                select: {
                    id: true, title: true, unitPrice: true, status: true, city: true, createdAt: true,
                    catalog: { select: { id: true, name: true } },
                },
                orderBy: { createdAt: 'desc' },
                take: 10,
            }),
        ]);
        return { ...attached, recentProducts: products, recentAds: ads };
    }

    // ────────────────────────────────────────────────
    // لیست آگهی‌های وصل به برند
    // ────────────────────────────────────────────────
    async getAds(id: string, page = 1, limit = 20) {
        const exists = await this.prisma.brand.findUnique({ where: { id }, select: { id: true } });
        if (!exists) throw new NotFoundException({ errorCode: 'BRAND_NOT_FOUND', message: 'برند یافت نشد' });

        const take = Math.min(Math.max(1, limit), 50);
        const skip = (Math.max(1, page) - 1) * take;
        const where = { brandId: id };
        const [items, total] = await Promise.all([
            this.prisma.ad.findMany({
                where,
                select: {
                    id: true, title: true, unitPrice: true, minQuantity: true, status: true,
                    city: true, createdAt: true,
                    catalog: { select: { id: true, name: true } },
                },
                orderBy: { createdAt: 'desc' },
                take,
                skip,
            }),
            this.prisma.ad.count({ where }),
        ]);
        return { items, total, page: Math.max(1, page), hasMore: skip + items.length < total };
    }

    // ────────────────────────────────────────────────
    // لیست کالاهای مرجع وصل به برند
    // ────────────────────────────────────────────────
    async getProducts(id: string, page = 1, limit = 20) {
        const exists = await this.prisma.brand.findUnique({ where: { id }, select: { id: true } });
        if (!exists) throw new NotFoundException({ errorCode: 'BRAND_NOT_FOUND', message: 'برند یافت نشد' });

        const take = Math.min(Math.max(1, limit), 50);
        const skip = (Math.max(1, page) - 1) * take;
        const where = { brandId: id };
        const [items, total] = await Promise.all([
            this.prisma.productReference.findMany({
                where,
                select: {
                    id: true, title: true, imageUrl: true, thumbnailUrl: true,
                    usageCount: true, isActive: true, confirmed: true, createdAt: true,
                },
                orderBy: { usageCount: 'desc' },
                take,
                skip,
            }),
            this.prisma.productReference.count({ where }),
        ]);
        return { items, total, page: Math.max(1, page), hasMore: skip + items.length < total };
    }

    // ────────────────────────────────────────────────
    // ویرایش مدیریتی برند — عنوان تکراری ممنوع
    // ────────────────────────────────────────────────
    async update(id: string, dto: AdminUpdateBrandDto) {
        const brand = await this.prisma.brand.findUnique({ where: { id }, select: { id: true } });
        if (!brand) throw new NotFoundException({ errorCode: 'BRAND_NOT_FOUND', message: 'برند یافت نشد' });

        if (dto.title !== undefined) {
            const normalized = normalizeForStore(dto.title || '');
            if (!normalized) {
                throw new ConflictException({ errorCode: 'TITLE_REQUIRED', message: 'عنوان برند الزامی است' });
            }
            const dup = await findDuplicateTitle(this.prisma.brand, normalized, id);
            if (dup) {
                throw new ConflictException({
                    errorCode: 'DUPLICATE_TITLE',
                    message: `برند «${dup.title}» قبلاً ثبت شده است — عنوان تکراری مجاز نیست`,
                });
            }
            dto = { ...dto, title: normalized };
        }

        const updated = await this.prisma.brand.update({
            where: { id },
            data: {
                ...(dto.title !== undefined ? { title: dto.title } : {}),
                ...(dto.category !== undefined ? { category: dto.category || null } : {}),
                ...(dto.keywords !== undefined ? { keywords: dto.keywords } : {}),
                ...(dto.logoUrl !== undefined ? { logoUrl: dto.logoUrl || null } : {}),
                ...(dto.description !== undefined ? { description: dto.description || null } : {}),
                ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
                ...(dto.confirmed !== undefined ? { confirmed: dto.confirmed } : {}),
            },
        });
        await this.cache.bust('brand-search');
        return updated;
    }

    // ────────────────────────────────────────────────
    // حذف مدیریتی برند — آگهی‌ها و کالاهای وصل جدا می‌شوند
    // ────────────────────────────────────────────────
    async remove(id: string) {
        const brand = await this.prisma.brand.findUnique({
            where: { id },
            select: { id: true, title: true, _count: { select: { ads: true, products: true } } },
        });
        if (!brand) throw new NotFoundException({ errorCode: 'BRAND_NOT_FOUND', message: 'برند یافت نشد' });

        if (brand._count.ads > 0) {
            await this.prisma.ad.updateMany({ where: { brandId: id }, data: { brandId: null } });
        }
        if (brand._count.products > 0) {
            await this.prisma.productReference.updateMany({ where: { brandId: id }, data: { brandId: null } });
        }
        const deleted = await this.prisma.brand.delete({ where: { id } });
        await this.cache.bust('brand-search');
        return { ...deleted, detachedAds: brand._count.ads, detachedProducts: brand._count.products };
    }
}
