// src/admin/product/admin-product.service.ts
// ✅ مدیریت کالاهای مرجع برای ادمین سیستم — و در حالت scoped برای مالک بازار
import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminUpdateProductDto } from './admin-product.dto';
import { normalizeForStore, findDuplicateTitle } from '../../common/persian-text.util';
import { CacheHelper } from '../../common/services/cache.helper';

const LIST_SELECT = {
    id: true,
    title: true,
    slug: true,
    brandId: true,
    brand: { select: { id: true, title: true, logoUrl: true } },
    category: true,
    imageUrl: true,
    thumbnailUrl: true,
    specs: true,
    keywords: true,
    unitHints: true,
    isActive: true,
    confirmed: true,
    isByUser: true,
    isNew: true,
    usageCount: true,
    armId: true,
    createdByUserId: true,
    createdAt: true,
    updatedAt: true,
    _count: { select: { ads: true } },
};

export interface ReferenceScope {
    armId?: string;
    memberUserIds?: string[];
}

@Injectable()
export class AdminProductService {
    constructor(private prisma: PrismaService, private cache: CacheHelper) {}

    // ────────────────────────────────────────────────
    // افزودن شرط محدودهٔ بازار (برای پنل مالک بازار)
    // کالای مرجع در محدوده است اگر: از طریق همین بازار ثبت شده
    // یا سازنده‌اش عضو (فروشنده) همین بازار باشد
    // ────────────────────────────────────────────────
    private applyScope(where: any, scope?: ReferenceScope) {
        if (!scope) return;
        const scopeOr: any[] = [];
        if (scope.armId) scopeOr.push({ armId: scope.armId });
        if (scope.memberUserIds?.length) scopeOr.push({ createdByUserId: { in: scope.memberUserIds } });
        if (scopeOr.length) where.AND = [...(where.AND || []), { OR: scopeOr }];
        else where.AND = [...(where.AND || []), { _id: { $exists: false } }]; // بازار بدون عضو → هیچی
    }

    /** اطلاعات سازنده‌ها و بازارها را یکجا وصل می‌کند (چون relation اسکیمایی نداریم) */
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
    // لیست مدیریتی با فیلتر و صفحه‌بندی
    // ────────────────────────────────────────────────
    async findAll(filters: {
        q?: string; brandId?: string; category?: string; armId?: string;
        isActive?: boolean; confirmed?: boolean; isByUser?: boolean; hasAds?: boolean;
        page?: number; limit?: number; sortBy?: string; sortOrder?: 'asc' | 'desc';
    }, scope?: ReferenceScope) {
        const page = Math.max(1, filters.page || 1);
        const take = Math.min(Math.max(1, filters.limit || 20), 100);
        const skip = (page - 1) * take;

        const where: any = {};
        if (filters.isActive !== undefined) where.isActive = filters.isActive;
        if (filters.confirmed !== undefined) where.confirmed = filters.confirmed;
        if (filters.isByUser !== undefined) where.isByUser = filters.isByUser;
        if (filters.brandId) where.brandId = filters.brandId;
        if (filters.category) where.category = filters.category;
        if (filters.armId) where.armId = filters.armId;
        if (filters.hasAds) where.ads = { some: {} };
        if (filters.q && filters.q.trim().length >= 2) {
            const query = filters.q.trim();
            where.OR = [
                { title: { contains: query, mode: 'insensitive' } },
                { keywords: { has: query } },
                { brand: { is: { title: { contains: query, mode: 'insensitive' } } } },
            ];
        }
        this.applyScope(where, scope);

        const orderByField = ['createdAt', 'usageCount', 'title'].includes(filters.sortBy || '')
            ? (filters.sortBy as any)
            : 'createdAt';
        const orderBy: any = { [orderByField]: filters.sortOrder === 'asc' ? 'asc' : 'desc' };

        const [rows, total] = await Promise.all([
            this.prisma.productReference.findMany({ where, select: LIST_SELECT, orderBy, take, skip }),
            this.prisma.productReference.count({ where }),
        ]);

        const items = await this.attachCreatorAndArm(rows);
        return { items, total, page, hasMore: skip + items.length < total };
    }

    // ────────────────────────────────────────────────
    // جزئیات کامل یک کالای مرجع + آخرین آگهی‌های وصل‌شده
    // ────────────────────────────────────────────────
    async findOne(id: string, scope?: ReferenceScope) {
        const row = await this.prisma.productReference.findUnique({
            where: { id },
            select: { ...LIST_SELECT, description: true, metadata: true },
        });
        if (!row) throw new NotFoundException({ errorCode: 'PRODUCT_NOT_FOUND', message: 'کالای مرجع یافت نشد' });

        if (scope) {
            const inScope =
                (scope.armId && row.armId === scope.armId) ||
                (scope.memberUserIds?.length && row.createdByUserId && scope.memberUserIds.includes(row.createdByUserId));
            if (!inScope) {
                throw new ForbiddenException({ errorCode: 'OUT_OF_SCOPE', message: 'این کالای مرجع به بازار شما تعلق ندارد' });
            }
        }

        const [attached] = await this.attachCreatorAndArm([row]);
        const ads = await this.prisma.ad.findMany({
            where: { productReferenceId: id },
            select: {
                id: true, title: true, unitPrice: true, status: true, city: true, createdAt: true,
                catalog: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 10,
        });
        return { ...attached, recentAds: ads };
    }

    // ────────────────────────────────────────────────
    // لیست صفحه‌بندی‌شدهٔ آگهی‌های وصل به یک کالای مرجع
    // ────────────────────────────────────────────────
    async getAds(id: string, page = 1, limit = 20) {
        const exists = await this.prisma.productReference.findUnique({ where: { id }, select: { id: true } });
        if (!exists) throw new NotFoundException({ errorCode: 'PRODUCT_NOT_FOUND', message: 'کالای مرجع یافت نشد' });

        const take = Math.min(Math.max(1, limit), 50);
        const skip = (Math.max(1, page) - 1) * take;
        const where = { productReferenceId: id };
        const [items, total] = await Promise.all([
            this.prisma.ad.findMany({
                where,
                select: {
                    id: true, title: true, unitPrice: true, minQuantity: true, status: true,
                    city: true, createdAt: true,
                    catalog: { select: { id: true, name: true } },
                    brand: { select: { id: true, title: true } },
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
    // ویرایش مدیریتی — بدون محدودیت isNew
    // ✅ عنوان تکراری ممنوع (نرمال‌سازی هم‌ارزها)
    // ✅ confirmed=true → isNew=false (قفل ویرایش کاربر)
    // ────────────────────────────────────────────────
    async update(id: string, dto: AdminUpdateProductDto) {
        const product = await this.prisma.productReference.findUnique({ where: { id }, select: { id: true, title: true } });
        if (!product) throw new NotFoundException({ errorCode: 'PRODUCT_NOT_FOUND', message: 'کالای مرجع یافت نشد' });

        if (dto.title !== undefined) {
            const normalized = normalizeForStore(dto.title || '');
            if (!normalized) {
                throw new ConflictException({ errorCode: 'TITLE_REQUIRED', message: 'عنوان کالا الزامی است' });
            }
            const dup = await findDuplicateTitle(this.prisma.productReference, normalized, id);
            if (dup) {
                throw new ConflictException({
                    errorCode: 'DUPLICATE_TITLE',
                    message: `کالای «${dup.title}» قبلاً ثبت شده است — عنوان تکراری مجاز نیست`,
                });
            }
            dto = { ...dto, title: normalized };
        }

        const updated = await this.prisma.productReference.update({
            where: { id },
            data: {
                ...(dto.title !== undefined ? { title: dto.title } : {}),
                ...(dto.brandId !== undefined ? { brandId: dto.brandId || null } : {}),
                ...(dto.category !== undefined ? { category: dto.category || null } : {}),
                ...(dto.keywords !== undefined ? { keywords: dto.keywords } : {}),
                ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl || null } : {}),
                ...(dto.thumbnailUrl !== undefined ? { thumbnailUrl: dto.thumbnailUrl || null } : {}),
                ...(dto.description !== undefined ? { description: dto.description || null } : {}),
                ...(dto.unitHints !== undefined ? { unitHints: dto.unitHints } : {}),
                ...(dto.specs !== undefined ? { specs: dto.specs } : {}),
                ...(dto.metadata !== undefined ? { metadata: dto.metadata } : {}),
                ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
                ...(dto.confirmed !== undefined ? { confirmed: dto.confirmed, isNew: !dto.confirmed } : {}),
            },
        });
        await this.cache.bust('prod-search');
        return updated;
    }

    // ────────────────────────────────────────────────
    // حذف مدیریتی — آگهی‌های وصل اول جدا می‌شوند
    // ────────────────────────────────────────────────
    async remove(id: string) {
        const product = await this.prisma.productReference.findUnique({
            where: { id },
            select: { id: true, title: true, _count: { select: { ads: true } } },
        });
        if (!product) throw new NotFoundException({ errorCode: 'PRODUCT_NOT_FOUND', message: 'کالای مرجع یافت نشد' });

        if (product._count.ads > 0) {
            await this.prisma.ad.updateMany({
                where: { productReferenceId: id },
                data: { productReferenceId: null },
            });
        }
        const deleted = await this.prisma.productReference.delete({ where: { id } });
        await this.cache.bust('prod-search');
        return { ...deleted, detachedAds: product._count.ads };
    }
}
