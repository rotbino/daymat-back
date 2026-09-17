// src/common/services/catalog-access.service.ts
import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * گیتِ واحدِ «چه کسی می‌تواند کارِ بازوی فروش را انجام دهد؟»
 *
 *  ۱) مالکِ بازوی فروش (catalog.ownerUserId — کاربری که بازوی فروش را ساخته) — همیشه
 *  ۲) ادمینِ بازوی فروش (CatalogMember با نقش catalog_admin) — از برگهٔ اعضا منصوب می‌شود
 *
 * این سرویس جای پراکندگیِ چکِ مالکیت بازوی فروش در سرویس‌ها را می‌گیرد
 * تا مدیریتِ بازوی فروش (محصول‌ها و قیمت‌ها) بدون استثنا در همه‌جا کار کند.
 */
@Injectable()
export class CatalogAccessService {
    constructor(private prisma: PrismaService) {}

    /** آیا کاربر می‌تواند کارِ این بازوی فروش را انجام دهد؟ (مدیریت محصول‌ها/قیمت‌ها/انتشار) */
    async canManageCatalog(catalogId: string, userId: string): Promise<boolean> {
        if (!catalogId || !userId) return false;

        const catalog = await this.prisma.catalog.findUnique({
            where: { id: catalogId },
            select: { ownerUserId: true },
        });
        if (!catalog) return false;
        if (catalog.ownerUserId === userId) return true;

        // ✅ ادمین بازوی فروش — توسط مالک منصوب شده و در مدیریت بازوی فروش سهیم است (برگهٔ اعضا)
        const adminMember = await this.prisma.catalogMember.findFirst({
            where: { catalogId, userId, role: 'catalog_admin', status: 'active' },
            select: { id: true },
        });
        return !!adminMember;
    }

    /** مثل canManageCatalog ولی به‌جای boolean، در صورت نبودِ اجازه Forbidden می‌اندازد */
    async assertCanManageCatalog(
        catalogId: string,
        userId: string,
        err?: { errorCode?: string; message: string },
    ): Promise<void> {
        const ok = await this.canManageCatalog(catalogId, userId);
        if (!ok) {
            throw new ForbiddenException({
                errorCode: err?.errorCode || 'FORBIDDEN',
                message: err?.message || 'شما اجازه این کار را ندارید',
            });
        }
    }

    /** شناسهٔ بازوی فروش‌هایی که مالکشان هستم یا ادمین‌شان — برای چک‌های گروهی */
    async manageableCatalogIds(userId: string): Promise<string[]> {
        const ownCatalogIds = (
            await this.prisma.catalog.findMany({
                where: { ownerUserId: userId, status: 'active' },
                select: { id: true },
            })
        ).map((c) => c.id);

        // ✅ بازوی فروش‌هایی که ادمین‌شان هستم (برگهٔ اعضا)
        const adminCatalogIds = (
            await this.prisma.catalogMember.findMany({
                where: { userId, role: 'catalog_admin', status: 'active' },
                select: { catalogId: true },
            })
        ).map((m) => m.catalogId);

        return Array.from(new Set([...ownCatalogIds, ...adminCatalogIds]));
    }
}
