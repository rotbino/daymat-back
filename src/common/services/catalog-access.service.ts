// src/common/services/catalog-access.service.ts
import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * گیتِ واحدِ «چه کسی می‌تواند کارِ کاتالوگ را انجام دهد؟»
 *
 *  ۱) مالکِ کسب‌وکارِ کاتالوگ — همیشه
 *  ۲) تیمِ بازاری که کارِ کاتالوگ به آن واگذار شده (CatalogArmDelegation فعال)
 *     — یعنی مالک یا ادمینِ فعالِ همان بازار
 *
 * این سرویس جای پراکندگیِ چکِ `business.ownerUserId === userId` در سرویس‌ها را می‌گیرد
 * تا واگذاریِ کارِ کاتالوگ (محصول‌ها و قیمت‌ها) به ادمین‌های بازار بدون استثنا در همه‌جا کار کند.
 */
@Injectable()
export class CatalogAccessService {
    constructor(private prisma: PrismaService) {}

    /** آیا کاربر می‌تواند کارِ این کاتالوگ را انجام دهد؟ (مدیریت محصول‌ها/قیمت‌ها/انتشار) */
    async canManageCatalog(catalogId: string, userId: string): Promise<boolean> {
        if (!catalogId || !userId) return false;

        const catalog = await this.prisma.catalog.findUnique({
            where: { id: catalogId },
            select: { business: { select: { ownerUserId: true } } },
        });
        if (!catalog) return false;
        if ((catalog.business as any)?.ownerUserId === userId) return true;

        // ✅ واگذاری فعال — کاربر باید مالک/ادمینِ فعالِ یکی از بازارهایی باشد که کار کاتالوگ به آن‌ها واگذار شده
        const delegations = await this.prisma.catalogArmDelegation.findMany({
            where: { catalogId, status: 'active' },
            select: { armId: true },
        });
        if (!delegations.length) return false;

        const membership = await this.prisma.armMembership.findFirst({
            where: {
                userId,
                armId: { in: delegations.map((d) => d.armId) },
                role: { in: ['arm_owner', 'arm_admin'] },
                status: 'active',
            },
            select: { id: true },
        });
        return !!membership;
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

    /** شناسهٔ کاتالوگ‌هایی که کاربر مالکشان است یا به تیمِ او واگذار شده — برای چک‌های گروهی */
    async manageableCatalogIds(userId: string): Promise<string[]> {
        const bizIds = (
            await this.prisma.business.findMany({
                where: { ownerUserId: userId, status: 'active' },
                select: { id: true },
            })
        ).map((b) => b.id);

        const ownCatalogIds = (
            await this.prisma.catalog.findMany({
                where: { businessId: { in: bizIds }, status: 'active' },
                select: { id: true },
            })
        ).map((c) => c.id);

        const delegatedCatalogIds = (
            await this.prisma.catalogArmDelegation.findMany({
                where: {
                    status: 'active',
                    arm: {
                        memberships: {
                            some: { userId, role: { in: ['arm_owner', 'arm_admin'] }, status: 'active' },
                        },
                    },
                },
                select: { catalogId: true },
            })
        ).map((d) => d.catalogId);

        return Array.from(new Set([...ownCatalogIds, ...delegatedCatalogIds]));
    }
}
