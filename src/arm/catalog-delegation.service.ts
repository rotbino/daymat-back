// src/arm/catalog-delegation.service.ts
import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * واگذاری کارِ کاتالوگ به تیمِ بازار
 *
 *  فروشنده (مالکِ کسب‌وکار) کارهای کاتالوگش در یک بازار (محصول‌ها، قیمت‌ها، انتشار)
 *  را به تیمِ همان بازار (مالک + ادمین‌ها) واگذار می‌کند چون معمولاً خودش وقت ندارد.
 *  تیمِ بازار (مالک/ادمین) در پنلش «کاتالوگ‌های واگذارشده» را می‌بیند و همان کارهایی را
 *  که مالکِ کاتالوگ می‌کند، به‌جای او انجام می‌دهد.
 *
 *  پس‌گرفتن: خودِ فروشنده هر وقت بخواهد + مالکِ بازار هم می‌تواند لغو کند.
 *  همهٔ تاریخ‌ها و عامل‌ها + تاریخچهٔ رویدادها ثبت می‌شود — برای شفافیت و شکایت‌ها.
 */
@Injectable()
export class CatalogDelegationService {
    constructor(private prisma: PrismaService) {}

    // ─── ثبت واگذاری: فروشنده → تیم بازار ───
    async grant(userId: string, slug: string, catalogId: string) {
        if (!catalogId) {
            throw new BadRequestException({ errorCode: 'CATALOG_ID_REQUIRED', message: 'شناسه کاتالوگ الزامی است' });
        }

        const arm = await this.prisma.arm.findUnique({
            where: { slug },
            select: { id: true, name: true, slug: true, status: true },
        });
        if (!arm) throw new NotFoundException({ errorCode: 'ARM_NOT_FOUND', message: 'بازار یافت نشد' });
        if (arm.status !== 'active') {
            throw new BadRequestException({ errorCode: 'ARM_NOT_ACTIVE', message: 'بازار فعال نیست' });
        }

        // ✅ فقط مالکِ کسب‌وکارِ کاتالوگ حق واگذاری دارد
        const catalog = await this.prisma.catalog.findUnique({
            where: { id: catalogId },
            select: { id: true, name: true, business: { select: { ownerUserId: true } } },
        });
        if (!catalog) throw new NotFoundException({ errorCode: 'CATALOG_NOT_FOUND', message: 'کاتالوگ یافت نشد' });
        if ((catalog.business as any)?.ownerUserId !== userId) {
            throw new ForbiddenException({
                errorCode: 'NOT_CATALOG_OWNER',
                message: 'فقط مالک کسب‌وکار می‌تواند کارِ کاتالوگ را واگذار کند',
            });
        }

        // ✅ کاتالوگ باید فروشندهٔ فعالِ همین بازار باشد
        const membership = await this.prisma.armMembership.findFirst({
            where: { armId: arm.id, catalogId, status: 'active' },
            select: { id: true },
        });
        if (!membership) {
            throw new BadRequestException({
                errorCode: 'NOT_SELLER_MEMBER',
                message: 'این کاتالوگ فروشندهٔ فعال این بازار نیست',
            });
        }

        const existing = await this.prisma.catalogArmDelegation.findUnique({
            where: { catalogId_armId: { catalogId, armId: arm.id } },
        });

        if (existing?.status === 'active') {
            return {
                delegation: existing,
                message: 'کارِ این کاتالوگ از قبل به تیم این بازار واگذار شده است',
            };
        }

        const event = { type: 'granted', at: new Date().toISOString(), byUserId: userId };
        // ⚠️ Json در Prisma اپراتور push ندارد — آرایه را خوانده، ضمیمه و کامل بازنویسی می‌کنیم
        const prevEvents = Array.isArray((existing as any)?.events) ? (existing as any).events : [];

        const delegation = existing
            ? await this.prisma.catalogArmDelegation.update({
                  where: { id: existing.id },
                  data: {
                      status: 'active',
                      grantedAt: new Date(),
                      grantedByUserId: userId,
                      revokedByUserId: null,
                      revokedAt: null,
                      events: [...prevEvents, event],
                  },
              })
            : await this.prisma.catalogArmDelegation.create({
                  data: {
                      catalogId,
                      armId: arm.id,
                      grantedByUserId: userId,
                      status: 'active',
                      events: [event],
                  },
              });

        return {
            delegation,
            message: `کارِ کاتالوگ به تیم بازار «${arm.name}» واگذار شد — مالک و ادمین‌های بازار حالا می‌توانند محصول‌ها و قیمت‌ها را به‌جایت مدیریت کنند`,
        };
    }

    // ─── پس‌گرفتن/لغو واگذاری: فروشنده یا مالکِ بازار ───
    async revoke(userId: string, slug: string, catalogId: string, isSystemAdmin = false) {
        if (!catalogId) {
            throw new BadRequestException({ errorCode: 'CATALOG_ID_REQUIRED', message: 'شناسه کاتالوگ الزامی است' });
        }

        const arm = await this.prisma.arm.findUnique({
            where: { slug },
            select: { id: true, name: true, slug: true },
        });
        if (!arm) throw new NotFoundException({ errorCode: 'ARM_NOT_FOUND', message: 'بازار یافت نشد' });

        const delegation = await this.prisma.catalogArmDelegation.findUnique({
            where: { catalogId_armId: { catalogId, armId: arm.id } },
            include: { catalog: { select: { business: { select: { ownerUserId: true } } } } },
        });
        if (!delegation || delegation.status !== 'active') {
            throw new NotFoundException({ errorCode: 'DELEGATION_NOT_ACTIVE', message: 'واگذاری فعالی برای این کاتالوگ در این بازار وجود ندارد' });
        }

        // ✅ لغو: مالکِ کسب‌وکار (پس‌گرفتن) یا مالکِ بازار / ادمین سیستم (لغو)
        const isCatalogOwner = (delegation.catalog as any)?.business?.ownerUserId === userId;
        const armMembership = await this.prisma.armMembership.findFirst({
            where: { armId: arm.id, userId, status: 'active' },
            select: { role: true },
        });
        const isArmOwner = armMembership?.role === 'arm_owner';

        if (!isCatalogOwner && !isArmOwner && !isSystemAdmin) {
            throw new ForbiddenException({
                errorCode: 'REVOKE_FORBIDDEN',
                message: 'فقط مالک کسب‌وکار یا مالک بازار می‌تواند واگذاری را لغو کند',
            });
        }

        const revokedByRole = isCatalogOwner ? 'seller' : isArmOwner ? 'arm_owner' : 'system_admin';

        const event = {
            type: 'revoked',
            at: new Date().toISOString(),
            byUserId: userId,
            by: revokedByRole,
        };
        // ⚠️ Json در Prisma اپراتور push ندارد — آرایه را خوانده، ضمیمه و کامل بازنویسی می‌کنیم
        const prevEvents = Array.isArray((delegation as any).events) ? (delegation as any).events : [];

        const updated = await this.prisma.catalogArmDelegation.update({
            where: { id: delegation.id },
            data: {
                status: 'revoked',
                revokedAt: new Date(),
                revokedByUserId: userId,
                events: [...prevEvents, event],
            },
        });

        return {
            delegation: updated,
            revokedBy: revokedByRole,
            message: isCatalogOwner
                ? 'دسترسی تیم بازار به کاتالوگتان پس گرفته شد — از این به بعد فقط خودتان می‌توانید کارها را انجام دهید'
                : 'واگذاریِ این کاتالوگ لغو شد — فروشنده اطلاع داده می‌شود',
        };
    }

    // ─── تیمِ بازار (مالک + ادمین‌ها) — برای نمایش در مودال تأییدِ فروشنده ───
    async getTeam(slug: string) {
        const arm = await this.prisma.arm.findUnique({ where: { slug }, select: { id: true, name: true } });
        if (!arm) throw new NotFoundException({ errorCode: 'ARM_NOT_FOUND', message: 'بازار یافت نشد' });

        const members = await this.prisma.armMembership.findMany({
            where: { armId: arm.id, role: { in: ['arm_owner', 'arm_admin'] }, status: 'active' },
            select: {
                role: true,
                user: { select: { id: true, fullName: true, avatarUrl: true } },
            },
            orderBy: { role: 'asc' },
        });

        return {
            arm: { id: arm.id, name: arm.name, slug },
            team: members.map((m) => ({
                userId: m.user.id,
                fullName: m.user.fullName || 'عضو تیم بازار',
                avatarUrl: m.user.avatarUrl || null,
                role: m.role,
            })),
        };
    }

    // ─── وضعیت واگذاری یک کاتالوگ در یک بازار (دیدِ فروشنده) ───
    async getStatus(userId: string, slug: string, catalogId: string) {
        const arm = await this.prisma.arm.findUnique({ where: { slug }, select: { id: true } });
        if (!arm) throw new NotFoundException({ errorCode: 'ARM_NOT_FOUND', message: 'بازار یافت نشد' });

        const delegation = await this.prisma.catalogArmDelegation.findUnique({
            where: { catalogId_armId: { catalogId, armId: arm.id } },
            include: {
                grantedBy: { select: { fullName: true } },
                revokedBy: { select: { fullName: true } },
            },
        });

        if (!delegation) return { active: false, exists: false };
        return {
            exists: true,
            active: delegation.status === 'active',
            status: delegation.status,
            grantedAt: delegation.grantedAt,
            revokedAt: delegation.revokedAt,
            grantedBy: (delegation as any).grantedBy?.fullName || null,
            revokedBy: (delegation as any).revokedBy?.fullName || null,
            events: delegation.events || [],
        };
    }

    // ─── لیست واگذاری‌های یک بازار (دیدِ پنل مالک/ادمین) ───
    async listForArm(slug: string, status: string = 'active', page = 1, limit = 20) {
        const arm = await this.prisma.arm.findUnique({ where: { slug }, select: { id: true, name: true } });
        if (!arm) throw new NotFoundException({ errorCode: 'ARM_NOT_FOUND', message: 'بازار یافت نشد' });

        const where: any = { armId: arm.id };
        if (status && status !== 'all') where.status = status;

        const [total, items] = await Promise.all([
            this.prisma.catalogArmDelegation.count({ where }),
            this.prisma.catalogArmDelegation.findMany({
                where,
                include: {
                    catalog: {
                        select: { id: true, name: true, slug: true, logoUrl: true, business: { select: { name: true, owner: { select: { fullName: true, phone: true } } } } },
                    },
                    grantedBy: { select: { id: true, fullName: true } },
                    revokedBy: { select: { id: true, fullName: true } },
                },
                orderBy: { updatedAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
            }),
        ]);

        return {
            arm: { id: arm.id, name: arm.name, slug },
            items: items.map((d) => ({
                id: d.id,
                status: d.status,
                grantedAt: d.grantedAt,
                revokedAt: d.revokedAt,
                grantedBy: (d as any).grantedBy ? { id: (d as any).grantedBy.id, fullName: (d as any).grantedBy.fullName } : null,
                revokedBy: (d as any).revokedBy ? { id: (d as any).revokedBy.id, fullName: (d as any).revokedBy.fullName } : null,
                catalog: {
                    id: d.catalog.id,
                    name: d.catalog.name,
                    slug: d.catalog.slug,
                    logoUrl: d.catalog.logoUrl,
                    businessName: (d.catalog as any).business?.name || null,
                    ownerName: (d.catalog as any).business?.owner?.fullName || null,
                    ownerPhone: (d.catalog as any).business?.owner?.phone || null,
                },
                events: d.events || [],
            })),
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        };
    }

    // ─── کاتالوگ‌های واگذارشده به من (دیدِ مالک/ادمینِ بازار — برای کنسول کار) ───
    async listMyDelegated(userId: string) {
        const managedArms = await this.prisma.armMembership.findMany({
            where: { userId, role: { in: ['arm_owner', 'arm_admin'] }, status: 'active' },
            select: { armId: true },
        });
        const armIds = managedArms.map((m) => m.armId);
        if (!armIds.length) return [];

        const delegations = await this.prisma.catalogArmDelegation.findMany({
            where: { armId: { in: armIds }, status: 'active' },
            include: {
                arm: { select: { id: true, name: true, slug: true } },
                // ✅ کاتالوگ کامل — کنسولِ وب همان فرمی را لازم دارد که «کاتالوگ‌های من» می‌دهد (config و ...)
                catalog: {
                    include: {
                        business: { select: { name: true, owner: { select: { fullName: true, phone: true } } } },
                    },
                },
                grantedBy: { select: { fullName: true } },
            },
            orderBy: { grantedAt: 'desc' },
        });

        return delegations.map((d) => {
            const { business, ...catalogFields } = d.catalog as any;
            return {
                id: d.id,
                arm: d.arm,
                grantedAt: d.grantedAt,
                grantedByName: (d as any).grantedBy?.fullName || null,
                catalog: {
                    ...catalogFields,
                    businessName: business?.name || null,
                    ownerName: business?.owner?.fullName || null,
                    ownerPhone: business?.owner?.phone || null,
                    isDelegatedToMe: true,
                },
            };
        });
    }
}
