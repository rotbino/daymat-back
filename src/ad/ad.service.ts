// src/ad/ad.service.ts
import {
    Injectable,
    NotFoundException,
    ForbiddenException,
    BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAdDto, UpdateAdDto, AdListQueryDto, ExtendAdDto } from './ad.dto';
import { CreditService } from '../credit/credit.service';
import {
    flattenCategoryTree,
    findNodeInTree,
} from '../common/utils/arm.utils';
import { SearchLogDto } from "./search-log.dto";
import { CatalogPublishService } from "../common/services/catalog-publish.service";

const FA_NORMALIZE = (s: string) =>
    (s ?? '')
        .replace(/ي/g, 'ی')
        .replace(/ك/g, 'ک')
        .replace(/\u200c/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** include مشترکِ مالکیت کاتالوگ — مالک واقعی از مسیر نهاد */
const CATALOG_OWNER_SELECT = {
    id: true,
    name: true,
    business: { select: { id: true, ownerUserId: true, verificationTier: true } },
} as const;

@Injectable()
export class AdService {
    constructor(
        private prisma: PrismaService,
        private catalogPublish: CatalogPublishService,
        private creditService: CreditService,
    ) {}

    private getConfigValue<T>(config: any, path: string, defaultValue: T): T {
        const keys = path.split('.');
        let value = config;
        for (const key of keys) {
            if (value === undefined || value === null) return defaultValue;
            value = value[key];
        }
        return value !== undefined && value !== null ? value : defaultValue;
    }

    // ═══════════════════════════════════════
    // 1. ثبت آگهی جدید — کاتالوگ‌محور نهایی
    // ═══════════════════════════════════════
    async create(userId: string, dto: CreateAdDto) {
        // ─── ۱) کاتالوگ مالک — الزامی؛ مالکیت از مسیر نهاد ───
        const catalog = await this.prisma.catalog.findUnique({
            where: { id: dto.catalogId },
            select: {
                id: true,
                business: { select: { ownerUserId: true } },
            },
        });
        if (!catalog) {
            throw new BadRequestException({
                errorCode: 'INVALID_CATALOG',
                message: 'کاتالوگ مورد نظر یافت نشد',
            });
        }
        if ((catalog.business as any).ownerUserId !== userId) {
            throw new ForbiddenException({
                errorCode: 'FORBIDDEN_CATALOG',
                message: 'شما به این کاتالوگ دسترسی ندارید',
            });
        }

        // ─── ۲) واحد — الزامی و سراسری ───
        if (!dto.unitId) {
            throw new BadRequestException({
                errorCode: 'UNIT_ID_REQUIRED',
                message: 'واحد اندازه‌گیری الزامی است',
            });
        }
        const unitExists = await this.prisma.unit.findUnique({ where: { id: dto.unitId } });
        if (!unitExists) {
            throw new BadRequestException({
                errorCode: 'UNIT_NOT_FOUND',
                message: 'واحد اندازه‌گیری انتخاب شده معتبر نیست',
            });
        }

        // ─── ۳) جلوگیری از قیمت تکراری (در سطح کاتالوگ) ───
        const duplicateWhere: any = {
            catalogId: catalog.id,
            productType: dto.productType,
            minQuantity: dto.minQuantity,
            status: { not: 'deleted' },
        };
        if (dto.categoryId) duplicateWhere.catalogCategoryId = dto.categoryId;
        const existingDup = await this.prisma.ad.findFirst({ where: duplicateWhere });
        if (existingDup) {
            throw new BadRequestException({
                errorCode: 'DUPLICATE_MIN_QUANTITY',
                message: 'برای این کالا با همین حداقل خرید قبلاً قیمت ثبت کرده‌اید.',
            });
        }

        // ─── ۴) موجودی در برابر حداقل خرید ───
        if (dto.availableQuantity !== null && dto.availableQuantity !== undefined) {
            if (dto.minQuantity > dto.availableQuantity) {
                throw new BadRequestException({
                    errorCode: 'MIN_QUANTITY_EXCEEDS_STOCK',
                    message: 'حداقل حجم خرید نمی‌تواند از موجودی بیشتر باشد.',
                });
            }
        }

        // ─── ۵) اعتبار قیمت ───
        const validityHours = dto.validityHours ?? 24;
        const expiresAt = new Date(Date.now() + validityHours * 60 * 60 * 1000);

        // ─── ۶) ساخت آگهی — همیشه فقط-کاتالوگی؛ انتشار با مهر بعدی ───
        const ad = await this.prisma.ad.create({
            data: {
                armId: null,
                catalogId: catalog.id,
                createdByUserId: userId,
                catalogCategoryId: dto.categoryId || null,
                categoryId: null,
                categoryPath: [],
                giftPrice: dto.giftPrice ?? null,
                volumeTiers: (dto.volumeTiers as any) ?? null,
                unitId: dto.unitId,
                title: dto.title || '',
                productType: dto.productType || null,
                // ✅ کالای مرجع
                productReferenceId: (dto as any).productReferenceId || null,
                brandId: (dto as any).brandId || null,
                paymentMethods: (dto.paymentMethods as any) || null,
                specs: (dto.specs as any) || null,
                customFields: (dto.customFields as any) || {},
                description: dto.description || '',
                unitPrice: dto.unitPrice,
                singleUnitPrice: dto.singleUnitPrice || null,
                consumerPrice: dto.consumerPrice || null,
                minQuantity: dto.minQuantity,
                availableQuantity: dto.availableQuantity || null,
                availableQuantityBucket: dto.availableQuantityBucket || null,
                city: dto.city || '',
                province: dto.province || '',
                countryCode: dto.countryCode || 'IR',
                provinceCode: dto.provinceCode || null,
                cityCode: dto.cityCode || null,
                locationDetail: dto.locationDetail || '',
                validityHours,
                expiresAt,
                isAnonymous: dto.isAnonymous || false,
                publishToMarket: dto.publishToMarket ?? true,
                priceHistory: [{ price: dto.unitPrice, updatedAt: new Date().toISOString(), note: 'ثبت اولیه' }],
                status: 'active',
                source: 'manual',
                unitQty: dto.unitQty || null,
                unitIsVariableQty: dto.unitIsVariableQty || false,
            },
            include: {
                unit: { select: { id: true, title: true, shortCode: true } },
                catalog: { select: { id: true, name: true } },
            },
        });

        // ─── ۷) انتشار خودکار کالای تازه — به همه بازارهایی که کاتالوگ در آن‌ها published است ───
        if (dto.publishToMarket !== false) {
            // ✅ همه membership های published این کاتالوگ را بگیر (نه فقط اولی)
            const memberships = await this.prisma.armMembership.findMany({
                where: { catalogId: catalog.id, status: 'active', publishState: 'published' },
                select: { armId: true },
            });
            if (memberships.length > 0) {
                // ✅ همه arm ها را با categoryTree شان بگیر
                const arms = await this.prisma.arm.findMany({
                    where: {
                        id: { in: memberships.map(m => m.armId) },
                        status: 'active',
                    },
                    select: { id: true, categoryTree: true },
                });
                // ✅ در هر بازار stamp کن (مستقل از هم — اگه یکی fail شد، بقیه کار می‌کنند)
                for (const arm of arms) {
                    try {
                        await this.catalogPublish.stampCatalogAds(arm, catalog.id, [ad.id], userId);
                    } catch (err) {
                        // log کن ولی ادامه بده — نباید ساخت آگهی fail بشه به خاطر یک بازار
                        console.error(`stampCatalogAds failed for arm ${arm.id}:`, err);
                    }
                }
            }
        }

        return {
            ...ad,
            requiresApproval: false,
        };
    }

    // ============================================================
    // ویرایش آگهی — کاتالوگ‌محور
    // ============================================================
    async update(id: string, userId: string, dto: UpdateAdDto) {
        const ad = await this.prisma.ad.findUnique({
            where: { id },
            select: {
                id: true,
                createdByUserId: true,
                catalogId: true,
                armId: true,
            },
        });
        if (!ad) {
            throw new NotFoundException({ errorCode: 'AD_NOT_FOUND', message: 'آگهی یافت نشد' });
        }

        // ✅ مالکیت از مسیر نهاد
        const catalog = await this.prisma.catalog.findUnique({
            where: { id: ad.catalogId },
            select: { business: { select: { ownerUserId: true } } },
        });
        if ((catalog as any)?.business?.ownerUserId !== userId) {
            throw new ForbiddenException({
                errorCode: 'FORBIDDEN',
                message: 'شما اجازه ویرایش این آگهی را ندارید',
            });
        }

        // ─── واحد ───
        if (dto.unitId) {
            const unitExists = await this.prisma.unit.findUnique({
                where: { id: dto.unitId },
                select: { id: true },
            });
            if (!unitExists) {
                throw new BadRequestException({
                    errorCode: 'UNIT_NOT_FOUND',
                    message: 'واحد اندازه‌گیری انتخاب شده معتبر نیست',
                });
            }
        }

        // ─── جلوگیری از قیمت تکراری ───
        if (dto.minQuantity !== undefined || dto.productType !== undefined || dto.categoryId !== undefined) {
            const current = await this.prisma.ad.findUnique({
                where: { id },
                select: { productType: true, minQuantity: true, catalogCategoryId: true, catalogId: true },
            });
            const dupWhere: any = {
                id: { not: id },
                catalogId: current.catalogId,
                productType: dto.productType ?? current.productType,
                minQuantity: dto.minQuantity ?? current.minQuantity,
                status: { not: 'deleted' },
            };
            const effectiveCategory = dto.categoryId !== undefined ? (dto.categoryId || null) : current.catalogCategoryId;
            if (effectiveCategory) dupWhere.catalogCategoryId = effectiveCategory;
            const dup = await this.prisma.ad.findFirst({ where: dupWhere });
            if (dup) {
                throw new BadRequestException({
                    errorCode: 'DUPLICATE_MIN_QUANTITY',
                    message: 'برای این کالا با همین حداقل خرید قبلاً قیمت ثبت کرده‌اید.',
                });
            }
        }

        // ─── آپدیت ───
        const expiresAt = dto.validityHours
            ? new Date(Date.now() + dto.validityHours * 60 * 60 * 1000)
            : undefined;

        const adUpdated = await this.prisma.ad.update({
            where: { id },
            data: {
                ...(dto.categoryId !== undefined ? { catalogCategoryId: dto.categoryId || null } : {}),
                ...(dto.unitId ? { unitId: dto.unitId } : {}),
                ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
                ...(dto.productType !== undefined ? { productType: dto.productType.trim() || null } : {}),
                ...((dto as any).productReferenceId !== undefined ? { productReferenceId: (dto as any).productReferenceId || null } : {}),
                ...((dto as any).brandId !== undefined ? { brandId: (dto as any).brandId || null } : {}),
                ...(dto.description !== undefined ? { description: dto.description || null } : {}),
                ...(dto.unitPrice !== undefined ? { unitPrice: dto.unitPrice } : {}),
                ...(dto.singleUnitPrice !== undefined ? { singleUnitPrice: dto.singleUnitPrice || null } : {}),
                ...(dto.consumerPrice !== undefined ? { consumerPrice: dto.consumerPrice || null } : {}),
                ...(dto.minQuantity !== undefined ? { minQuantity: dto.minQuantity } : {}),
                ...(dto.availableQuantity !== undefined ? { availableQuantity: dto.availableQuantity || null } : {}),
                ...(dto.city !== undefined ? { city: dto.city || null } : {}),
                ...(dto.cityCode !== undefined ? { cityCode: dto.cityCode || null } : {}),
                ...(dto.provinceCode !== undefined ? { provinceCode: dto.provinceCode || null } : {}),
                ...(dto.province !== undefined ? { province: dto.province || null } : {}),
                ...(dto.validityHours !== undefined
                    ? { validityHours: dto.validityHours, ...(expiresAt ? { expiresAt } : {}) }
                    : {}),
                ...(dto.giftPrice !== undefined ? { giftPrice: dto.giftPrice || null } : {}),
                ...(dto.volumeTiers !== undefined ? { volumeTiers: (dto.volumeTiers as any) || null } : {}),
                ...(dto.isAnonymous !== undefined ? { isAnonymous: dto.isAnonymous } : {}),
                ...(dto.publishToMarket !== undefined ? { publishToMarket: dto.publishToMarket } : {}),
                ...(dto.status !== undefined ? { status: dto.status } : {}),
                ...(dto.unitQty !== undefined ? { unitQty: dto.unitQty ?? null } : {}),
                ...(dto.unitIsVariableQty !== undefined ? { unitIsVariableQty: dto.unitIsVariableQty } : {}),
                ...(dto.paymentMethods !== undefined ? { paymentMethods: (dto.paymentMethods as any) || null } : {}),
                ...(dto.specs !== undefined ? { specs: (dto.specs as any) || null } : {}),
                ...(dto.customFields !== undefined ? { customFields: (dto.customFields as any) || null } : {}),
                updatedAt: new Date(),
            },
            include: {
                unit: { select: { id: true, title: true, shortCode: true } },
            },
        });

        // ─── اگر دستهٔ کاتالوگ عوض شد → دستهٔ بازاری در همه بازارها بازمحاسبه ───
        if (dto.categoryId !== undefined) {
            // ✅ همه publication های این آگهی را بگیر
            const publications = await this.prisma.adPublication.findMany({
                where: { adId: id },
                select: { armId: true },
            });
            if (publications.length > 0) {
                const arms = await this.prisma.arm.findMany({
                    where: { id: { in: publications.map(p => p.armId) } },
                    select: { id: true, categoryTree: true },
                });
                // ✅ در هر بازار re-stamp کن
                for (const arm of arms) {
                    try {
                        await this.catalogPublish.stampCatalogAds(arm, ad.catalogId, [id], userId);
                    } catch (err) {
                        console.error(`re-stamp failed for arm ${arm.id}:`, err);
                    }
                }
            }
        }

        return adUpdated;
    }

    // ═══════════════════════════════════════
    // 3. تابلوی قیمت (ویترین زنده)
    // ═══════════════════════════════════════
    async getVitrine(armSlug: string, query: AdListQueryDto, userId?: string) {
        const arm = await this.prisma.arm.findUnique({
            where: { slug: armSlug },
            select: { id: true, config: true, categoryTree: true, status: true },
        });

        if (!arm) {
            throw new NotFoundException({ errorCode: 'ARM_NOT_FOUND', message: 'بازار یافت نشد' });
        }

        const config = arm.config as any || {};
        const priceTableConfig = config?.modules?.priceTable || {};

        // ✅ چک کن آیا کاربر حق دیدن قیمت‌ها رو داره
        let canViewPrices = true;
        if (priceTableConfig.requireMembershipToViewPrices === true) {
            if (!userId) {
                canViewPrices = false; // مهمان
            } else {
                // چک کن آیا کاربر buyer یا seller فعال در این بازار هست
                const membership = await this.prisma.armMembership.findFirst({
                    where: {
                        armId: arm.id,
                        userId,
                        status: 'active',
                        businessStatus: 'active',
                        businessId: { not: null },
                    },
                });
                canViewPrices = !!membership;
            }
        }

        const flatCategory = flattenCategoryTree(arm.categoryTree);
        const categoryMap = new Map(flatCategory.map((s: any) => [s.categoryId, s]));

        const page = query.page || 1;
        const limit = query.limit || 20;
        const skip = (page - 1) * limit;

        // ✅ مرحله ۱: مستقیماً از جدول AdPublication کوئری بزن
        // این روش قابل‌اعتمادتر از publications: { some: ... } در Prisma + MongoDB است
        const pubWhere: any = {
            armId: arm.id,
            status: 'published',
        };

        // فیلتر دسته‌بندی روی AdPublication
        if (query.categoryId) {
            const categoryNode = findNodeInTree(arm.categoryTree as any[], query.categoryId);
            if (categoryNode) {
                if (categoryNode.children && categoryNode.children.length > 0) {
                    pubWhere.categoryPath = { has: query.categoryId };
                } else {
                    pubWhere.categoryId = query.categoryId;
                }
            } else {
                pubWhere.categoryId = query.categoryId;
            }
        }

        // ✅ صفحه‌بندی روی AdPublication (نه Ad)
        const [publications, pubTotal] = await Promise.all([
            this.prisma.adPublication.findMany({
                where: pubWhere,
                orderBy: { publishedAt: 'desc' },
                skip,
                take: limit,
                select: { adId: true, categoryId: true, categoryPath: true },
            }),
            this.prisma.adPublication.count({ where: pubWhere }),
        ]);

        const adIds = publications.map((p) => p.adId);
        const pubMap = new Map(publications.map((p) => [p.adId, p]));

        if (adIds.length === 0) {
            return {
                ads: [],
                canViewPrices,
                pagination: { page, limit, total: 0, totalPages: 0 },
            };
        }

        // ✅ مرحله ۲: Ad ها رو با ID‌های بدست‌آمده بخون
        const adWhere: any = {
            id: { in: adIds },
            status: 'active',
            publishToMarket: true,
            expiresAt: { gt: new Date() },
        };

        // فیلتر نوع فروش ویترین
        const visibleSalesTypes = priceTableConfig.visibleSalesTypes;
        if (Array.isArray(visibleSalesTypes) && visibleSalesTypes.length) {
            adWhere.catalog = { salesType: { in: visibleSalesTypes } };
        }

        if (query.search) {
            adWhere.OR = [
                { title: { contains: query.search, mode: 'insensitive' } },
                { productType: { contains: query.search, mode: 'insensitive' } },
            ];
        }
        if (query.cityCode) adWhere.cityCode = query.cityCode;
        if (query.provinceCode) adWhere.provinceCode = query.provinceCode;
        if (query.minPrice !== undefined || query.maxPrice !== undefined) {
            adWhere.unitPrice = {};
            if (query.minPrice !== undefined) adWhere.unitPrice.gte = query.minPrice;
            if (query.maxPrice !== undefined) adWhere.unitPrice.lte = query.maxPrice;
        }
        if (query.minAvailableQuantity !== undefined || query.maxAvailableQuantity !== undefined) {
            adWhere.availableQuantity = {};
            if (query.minAvailableQuantity !== undefined) adWhere.availableQuantity.gte = query.minAvailableQuantity;
            if (query.maxAvailableQuantity !== undefined) adWhere.availableQuantity.lte = query.maxAvailableQuantity;
        }
        if (query.minQuantity !== undefined) adWhere.minQuantity = { gte: query.minQuantity };
        if (query.bumpFilter === 'bumped') {
            adWhere.isBumped = true;
            adWhere.bumpExpiresAt = { gt: new Date() };
        } else if (query.bumpFilter === 'normal') {
            adWhere.OR = [
                { isBumped: false },
                { bumpExpiresAt: { lt: new Date() } },
            ];
        }

        const ads = await this.prisma.ad.findMany({
            where: adWhere,
            select: {
                id: true,
                title: true,
                productType: true,
                unitPrice: true,
                singleUnitPrice: true,
                consumerPrice: true,
                minQuantity: true,
                availableQuantity: true,
                city: true,
                cityCode: true,
                provinceCode: true,
                isBumped: true,
                unitQty: true,
                unitIsVariableQty: true,
                unitBaseTitle: true,
                isAnonymous: true,
                paymentMethods: true,
                updatedAt: true,
                createdAt: true,
                unit: { select: { shortCode: true, title: true } },
                catalog: {
                    select: {
                        name: true,
                        type: true,
                        city: true,
                        phone: true,
                        business: { select: { verificationTier: true } },
                    },
                },
                files: {
                    where: { relatedModel: 'Ad', fieldKey: { startsWith: 'ad-image' } },
                    select: { path: true, thumbnailPath: true },
                    take: 1,
                },
            },
        });

        // ✅ ترتیب آگهی‌ها باید همون ترتیب AdPublication باشه (publishedAt desc)
        // و isBumped اول بیاد
        const adMap = new Map(ads.map((a: any) => [a.id, a]));
        const orderedAds = adIds
            .map((adId) => adMap.get(adId))
            .filter(Boolean) as any[];

        // ✅ bumped ها اول
        orderedAds.sort((a: any, b: any) => {
            if (a.isBumped && !b.isBumped) return -1;
            if (!a.isBumped && b.isBumped) return 1;
            return 0;
        });

        const total = pubTotal;

        // ✅ category را از publication این بازار بگیر، نه از Ad snapshot
        const adsWithCustomLabel = orderedAds.map((ad: any) => {
            const pub = pubMap.get(ad.id);
            const pubCategoryId = pub?.categoryId || null;
            const selection = categoryMap.get(pubCategoryId) as any | undefined;
            return {
                ...ad,
                // ✅ category از publication این بازار
                categoryId: pubCategoryId,
                categoryPath: pub?.categoryPath || [],
                // ✅ اگه کاربر حق دیدن قیمت‌ها رو نداره، قیمت‌ها رو null کن
                ...( !canViewPrices ? {
                    unitPrice: null,
                    singleUnitPrice: null,
                    consumerPrice: null,
                    giftPrice: null,
                    volumeTiers: null,
                } : {}),
                verificationTier: (ad.catalog as any)?.business?.verificationTier ?? null,
                categoryTitle: selection?.customLabel || selection?.title || pubCategoryId || '',
                unitBaseTitle: selection?.baseUnitTitle || ad.unitBaseTitle || null,
            };
        });

        return {
            ads: adsWithCustomLabel,
            canViewPrices,  // ✅ فرانت از این استفاده می‌کنه تا پیام مناسب نشون بده
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    // ═══════════════════════════════════════
    // 4. نردبان — فقط برای آگهیِ منتشرشده در بازار
    // ═══════════════════════════════════════
    async bump(id: string, userId: string) {
        const ad = await this.prisma.ad.findUnique({
            where: { id },
            include: {
                arm: { select: { id: true, slug: true, config: true } },
                catalog: {
                    select: {
                        id: true,
                        business: { select: { ownerUserId: true, verificationTier: true } },
                    },
                },
            },
        });

        if (!ad) throw new NotFoundException({ errorCode: 'AD_NOT_FOUND', message: 'آگهی یافت نشد' });
        if ((ad.catalog as any).business.ownerUserId !== userId) {
            throw new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'شما اجازه نردبان این آگهی را ندارید' });
        }
        if (ad.status !== 'active') throw new BadRequestException({ errorCode: 'AD_NOT_ACTIVE', message: 'فقط آگهی‌های فعال قابل نردبان هستند' });

        // ✅ چک کن آگهی در حداقل یک بازار published است (از AdPublication)
        const publicationCount = await this.prisma.adPublication.count({
            where: {
                adId: id,
                status: { in: ['published', 'needs_category'] },
            },
        });
        if (publicationCount === 0) {
            throw new BadRequestException({
                errorCode: 'NOT_IN_MARKET',
                message: 'این کالا در هیچ بازاری منتشر نشده است',
            });
        }

        // ✅ برای backward-compat: اگه ad.armId هست از اون استفاده کن، وگرنه آخرین published
        let targetArmId = ad.armId;
        if (!targetArmId) {
            const lastPub = await this.prisma.adPublication.findFirst({
                where: { adId: id, status: { in: ['published', 'needs_category'] } },
                orderBy: { publishedAt: 'desc' },
                select: { armId: true },
            });
            targetArmId = lastPub?.armId;
        }

        const config = (ad.arm?.config as any) || {};
        const bumpCost = this.getConfigValue(config, 'economy.bumpCost', 10);

        const balance = await this.creditService.getUserBalance(userId);
        if (balance.balance < bumpCost) {
            throw new BadRequestException({
                errorCode: 'INSUFFICIENT_CREDIT',
                message: `اعتبار کافی نیست. نیاز به ${bumpCost} اعتبار دارید. موجودی: ${balance.balance}`,
                data: { needed: bumpCost, balance: balance.balance },
            });
        }

        await this.prisma.credit.create({
            data: {
                userId, catalogId: ad.catalogId, armId: targetArmId,
                amount: 0, currency: 'IRR', creditCount: -bumpCost,
                pricePerCredit: null, creditType: 'purchased',
                transactionType: 'spend', description: `نردبان آگهی "${ad.title}"`,
                relatedEntityId: ad.id, relatedEntityType: 'Ad',
                metadata: { ad_title: ad.title, cost: bumpCost, arm_slug: ad.arm?.slug },
            },
        });

        const bumpExpiresAt = new Date();
        bumpExpiresAt.setDate(bumpExpiresAt.getDate() + 1);

        return this.prisma.ad.update({
            where: { id },
            data: {
                isBumped: true,
                bumpExpiresAt,
                bumpCount: { increment: 1 },
                lastBumpedAt: new Date(),
                lastBumpCreditsSpent: bumpCost,
                updatedAt: new Date(),
            },
            include: {
                catalog: { select: { id: true, name: true } },
            },
        });
    }

    // ============================================================
    // جزئیات آگهی — همهٔ فیلدها + کاتالوگ با مالک (از مسیر نهاد)
    // ============================================================
    async findOne(id: string) {
        const ad = await this.prisma.ad.findUnique({
            where: { id },
            include: {
                unit: { select: { id: true, title: true, shortCode: true } },
                // ✅ کالای مرجع و برند
                productRef: {
                    select: {
                        id: true, title: true,
                        imageUrl: true, thumbnailUrl: true,
                        brandId: true,
                        brand: { select: { id: true, title: true } },
                    },
                },
                brand: { select: { id: true, title: true, logoUrl: true } },
                catalog: {
                    include: {
                        business: {
                            include: {
                                owner: {
                                    select: { id: true, fullName: true, phone: true, avatarUrl: true },
                                },
                            },
                        },
                    },
                },
                files: {
                    where: { relatedModel: 'Ad' },
                    select: { id: true, path: true, thumbnailPath: true, fieldKey: true },
                },
            },
        });

        if (!ad) throw new NotFoundException({ errorCode: 'AD_NOT_FOUND', message: 'آگهی یافت نشد' });

        this.prisma.ad.update({ where: { id }, data: { viewCount: { increment: 1 } } }).catch(() => {});

        const ownerAvatar = await this.prisma.file.findFirst({
            where: { relatedModel: 'User', relatedId: ad.createdByUserId, fieldKey: 'avatar' },
            orderBy: { createdAt: 'desc' },
            select: { id: true, path: true, thumbnailPath: true },
        });

        const bizOwner = (ad.catalog as any)?.business?.owner;
        const bizVerificationTier = (ad.catalog as any)?.business?.verificationTier ?? null;

        return {
            ...ad,
            // ✅ شکل قدیمی owner برای فرانت حفظ شد
            owner: bizOwner ? {
                id: bizOwner.id,
                fullName: bizOwner.fullName,
                phone: bizOwner.phone,
                avatarUrl: ownerAvatar?.thumbnailPath || ownerAvatar?.path || bizOwner.avatarUrl || null,
            } : null,
            verificationTier: bizVerificationTier,
            catalog: {
                ...ad.catalog,
                owner: bizOwner ? {
                    id: bizOwner.id,
                    fullName: bizOwner.fullName,
                    phone: bizOwner.phone,
                    avatarUrl: ownerAvatar?.thumbnailPath || ownerAvatar?.path || bizOwner.avatarUrl || null,
                } : null,
            },
            files: ad.files,
        };
    }

    // ═══════════════════════════════════════
    // 7. تمدید آگهی
    // ═══════════════════════════════════════
    async extend(id: string, userId: string, dto: ExtendAdDto) {
        const ad = await this.prisma.ad.findUnique({
            where: { id },
            include: {
                arm: { select: { config: true } },
                catalog: {
                    select: {
                        id: true,
                        business: { select: { ownerUserId: true } },
                    },
                },
            },
        });

        if (!ad) throw new NotFoundException();
        if ((ad.catalog as any).business.ownerUserId !== userId) throw new ForbiddenException();
        if (ad.status !== 'active' && ad.status !== 'expired' && ad.status !== 'inactive') {
            throw new BadRequestException('آگهی قابل تمدید نیست');
        }

        const config = (ad.arm?.config as any) || {};
        const maxActiveAds = config.modules?.priceTable?.maxActiveAdsPerUser || 5;
        const bumpCostPerDay = config.economy?.bumpCost || 10;
        const defaultBumpHours = 24;

        let activationCost = 0;
        if (ad.armId) {
            const activeAdsCount = await this.prisma.ad.count({
                where: { catalogId: ad.catalogId, status: 'active', expiresAt: { gt: new Date() }, id: { not: id } },
            });
            if (activeAdsCount >= maxActiveAds) activationCost = bumpCostPerDay;
        }

        let bumpCost = 0;
        let bumpDurationHours = 0;
        let bumpExpiresAt: Date | null = null;

        if (dto.isBumped) {
            bumpDurationHours = dto.bumpDurationHours ?? defaultBumpHours;
            bumpCost = (bumpDurationHours / 24) * bumpCostPerDay;
            bumpExpiresAt = new Date(Date.now() + bumpDurationHours * 60 * 60 * 1000);
        }

        const totalCost = activationCost + bumpCost;

        if (totalCost > 0) {
            const balance = await this.creditService.getUserBalance(userId);
            if (balance.balance < totalCost) {
                throw new BadRequestException({
                    errorCode: 'INSUFFICIENT_CREDIT',
                    message: `اعتبار کافی نیست. نیاز به ${totalCost} اعتبار دارید.`,
                    data: { needed: totalCost, balance: balance.balance },
                });
            }
            await this.prisma.credit.create({
                data: {
                    userId, catalogId: ad.catalogId, armId: ad.armId,
                    amount: 0, currency: 'IRR', creditCount: -totalCost,
                    creditType: 'purchased', status: 'success',
                    transactionType: 'spend',
                    description: `تمدید آگهی "${ad.title}"`,
                    metadata: { ad_id: id, activationCost, bumpCost, bumpDurationHours },
                },
            });
        }

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + dto.validityHours);

        return this.prisma.ad.update({
            where: { id },
            data: {
                validityHours: dto.validityHours,
                expiresAt,
                status: 'active',
                updatedAt: new Date(),
                isBumped: dto.isBumped ?? false,
                bumpExpiresAt,
                bumpDurationHours: dto.isBumped ? bumpDurationHours : null,
                bumpCount: dto.isBumped ? { increment: 1 } : undefined,
                lastBumpedAt: dto.isBumped ? new Date() : undefined,
                lastBumpCreditsSpent: dto.isBumped ? bumpCost : undefined,
            },
            include: {
                unit: { select: { id: true, title: true, shortCode: true } },
                catalog: { select: { id: true, name: true } },
            },
        });
    }

    // ═══════════════════════════════════════
    // 8. حذف آگهی
    // ═══════════════════════════════════════
    async remove(id: string, userId: string) {
        const ad = await this.prisma.ad.findUnique({
            where: { id },
            include: {
                catalog: { select: { business: { select: { ownerUserId: true } } } },
            },
        });
        if (!ad) throw new NotFoundException({ errorCode: 'AD_NOT_FOUND', message: 'آگهی یافت نشد' });
        if ((ad.catalog as any).business.ownerUserId !== userId) {
            throw new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'شما اجازه حذف این آگهی را ندارید' });
        }
        return this.prisma.ad.update({ where: { id }, data: { status: 'deleted', updatedAt: new Date() } });
    }

    async getPriceHistory(id: string, userId?: string) {
        const ad = await this.prisma.ad.findUnique({
            where: { id },
            select: {
                id: true, title: true, unitPrice: true, priceHistory: true,
                catalog: { select: { business: { select: { ownerUserId: true } } } },
            },
        });
        if (!ad) throw new NotFoundException({ errorCode: 'AD_NOT_FOUND', message: 'آگهی یافت نشد' });
        if (userId && (ad.catalog as any)?.business?.ownerUserId === userId) {
            return { currentPrice: ad.unitPrice, history: ad.priceHistory || [] };
        }
        const history = (ad.priceHistory as any[]) || [];
        return { currentPrice: ad.unitPrice, history: history.slice(-5) };
    }

    async expireAds() {
        const expired = await this.prisma.ad.updateMany({
            where: { status: 'active', expiresAt: { lt: new Date() } },
            data: { status: 'expired', isBumped: false, updatedAt: new Date() },
        });
        return { expiredCount: expired.count };
    }

    async expireBumps() {
        const expired = await this.prisma.ad.updateMany({
            where: { status: 'active', isBumped: true, bumpExpiresAt: { lt: new Date() } },
            data: { isBumped: false, updatedAt: new Date() },
        });
        return { expiredCount: expired.count };
    }

    // ═══════════════════════════════════════
    // شماره تماس — مسیر بازاری با عضویت، مسیر کاتالوگی آزاد
    // ═══════════════════════════════════════

    /**
     * دریافت لیست بازارهایی که یک آگهی در آن‌ها منتشر شده
     */
    async getAdPublications(adId: string) {
        return this.catalogPublish.getAdPublications(adId);
    }

    /**
     * انتشار یک آگهی در یک بازار جدید (مالک آگهی)
     */
    async publishToMarket(userId: string, adId: string, armSlug: string) {
        const ad = await this.prisma.ad.findUnique({
            where: { id: adId },
            select: {
                id: true,
                catalogId: true,
                title: true,
                status: true,
                catalog: {
                    select: { business: { select: { ownerUserId: true } } },
                },
            },
        });
        if (!ad) throw new NotFoundException({ errorCode: 'AD_NOT_FOUND', message: 'آگهی یافت نشد' });
        if ((ad.catalog as any).business.ownerUserId !== userId) {
            throw new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'شما مالک این آگهی نیستید' });
        }
        if (ad.status !== 'active') {
            throw new BadRequestException({ errorCode: 'AD_NOT_ACTIVE', message: 'آگهی فعال نیست' });
        }

        const arm = await this.prisma.arm.findUnique({
            where: { slug: armSlug },
            select: { id: true, name: true, categoryTree: true, status: true },
        });
        if (!arm) throw new NotFoundException({ errorCode: 'ARM_NOT_FOUND', message: 'بازار یافت نشد' });
        if (arm.status !== 'active') {
            throw new BadRequestException({ errorCode: 'ARM_NOT_ACTIVE', message: 'بازار فعال نیست' });
        }

        // ✅ چک کن membership این کاتالوگ در این بازار
        const membership = await this.prisma.armMembership.findFirst({
            where: {
                armId: arm.id,
                catalogId: ad.catalogId,
            },
        });

        if (!membership) {
            throw new BadRequestException({
                errorCode: 'NOT_MEMBER',
                message: 'کاتالوگ شما در این بازار منتشر نیست — اول عضو بازار شوید',
            });
        }

        // ✅ پیام مناسب بر اساس وضعیت membership
        if (membership.status === 'paused') {
            throw new BadRequestException({
                errorCode: 'MEMBERSHIP_PAUSED',
                message: 'عضویت شما در این بازار تعلیق شده — با مدیر بازار تماس بگیرید',
            });
        }
        if (membership.status === 'pending') {
            throw new BadRequestException({
                errorCode: 'MEMBERSHIP_PENDING',
                message: 'عضویت شما در این بازار در انتظار تأیید است',
            });
        }
        if (membership.status === 'banned' || membership.status === 'rejected') {
            throw new BadRequestException({
                errorCode: 'MEMBERSHIP_BANNED',
                message: 'عضویت شما در این بازار رد شده است',
            });
        }
        if (membership.status === 'removed') {
            throw new BadRequestException({
                errorCode: 'MEMBERSHIP_REMOVED',
                message: 'عضویت شما در این بازار حذف شده است',
            });
        }
        if (membership.publishState !== 'published') {
            throw new BadRequestException({
                errorCode: 'NOT_PUBLISHED',
                message: 'کاتالوگ شما در این بازار منتشر نیست',
            });
        }

        const result = await this.catalogPublish.stampCatalogAds(arm, ad.catalogId, [adId], userId);
        return {
            success: true,
            arm: { id: arm.id, name: arm.name, slug: armSlug },
            stamped: result.stamped,
            needsCategory: result.needsCategory,
        };
    }

    /**
     * توقف انتشار یک آگهی در یک بازار
     */
    async unpublishFromMarket(userId: string, adId: string, armSlug: string) {
        const ad = await this.prisma.ad.findUnique({
            where: { id: adId },
            select: {
                id: true,
                catalogId: true,
                catalog: {
                    select: { business: { select: { ownerUserId: true } } },
                },
            },
        });
        if (!ad) throw new NotFoundException({ errorCode: 'AD_NOT_FOUND', message: 'آگهی یافت نشد' });
        if ((ad.catalog as any).business.ownerUserId !== userId) {
            throw new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'شما مالک این آگهی نیستید' });
        }

        const arm = await this.prisma.arm.findUnique({
            where: { slug: armSlug },
            select: { id: true, name: true },
        });
        if (!arm) throw new NotFoundException({ errorCode: 'ARM_NOT_FOUND', message: 'بازار یافت نشد' });

        await this.catalogPublish.unstampCatalogAds(ad.catalogId, arm.id);
        return { success: true, message: `آگهی از بازار ${arm.name} حذف شد` };
    }

    async getContactInfo(adId: string, userId: string) {
        const ad = await this.prisma.ad.findUnique({
            where: { id: adId },
            include: {
                arm: { select: { id: true, config: true } },
                catalog: {
                    select: {
                        id: true,
                        phone: true,
                        name: true,
                        business: { select: { owner: { select: { phone: true } } } },
                    },
                },
            },
        });
        if (!ad) throw new NotFoundException({ errorCode: 'AD_NOT_FOUND', message: 'آگهی یافت نشد' });
        if (ad.status !== 'active') throw new BadRequestException({ errorCode: 'AD_NOT_ACTIVE', message: 'این آگهی فعال نیست' });

        await this.prisma.callEvent.create({
            data: { adId: ad.id, callerId: userId, initiatedAt: new Date(), source: ad.armId ? 'direct' : 'catalog' },
        });
        await this.prisma.ad.update({ where: { id: adId }, data: { callCount: { increment: 1 } } });

        const ownerPhone = (ad.catalog as any)?.business?.owner?.phone ?? null;

        // ✅ آگهیِ فقط-کاتالوگی: شماره = اطلاعات عمومی کاتالوگ/نهاد — بدون چک عضویت
        if (!ad.armId) {
            const phone = ad.catalog.phone || ownerPhone;
            if (!phone) {
                throw new BadRequestException({ errorCode: 'NO_CONTACT', message: 'شماره تماس ثبت نشده است' });
            }
            return {
                catalogName: ad.catalog.name,
                phone,
                ownerPhone,
                remainingCalls: null,
                dailyLimit: null,
            };
        }

        // ─── مسیر بازاری ───
        const config = (ad.arm?.config as any) || {};
        const priceTableConfig = config?.modules?.priceTable || {};

        // ✅ چک کن آیا تماس نیاز به عضویت دارد
        if (priceTableConfig.requireMembershipToCall === true) {
            const membership = await this.prisma.armMembership.findFirst({
                where: {
                    armId: ad.armId,
                    userId,
                    status: 'active',
                    businessStatus: 'active',
                    businessId: { not: null },
                },
            });
            if (!membership) {
                throw new ForbiddenException({
                    errorCode: 'NOT_MEMBER',
                    message: 'برای تماس با فروشنده، باید عضو این بازار باشید',
                });
            }
        } else {
            // اگه عضویت اجباری نیست، فقط چک کن آیا کاربر اصلا عضو هست (برای daily limit)
            const membership = await this.prisma.armMembership.findFirst({
                where: { armId: ad.armId, userId, status: 'active' },
            });
            if (!membership) throw new ForbiddenException({ errorCode: 'NOT_MEMBER', message: 'شما به این بازار نپیوسته اید.' });
        }

        const dailyCallLimit = config.features?.dailyCallLimit || 20;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const callsToday = await this.prisma.callEvent.count({
            where: { callerId: userId, initiatedAt: { gte: today } },
        });
        if (callsToday >= dailyCallLimit) {
            throw new BadRequestException({
                errorCode: 'DAILY_CALL_LIMIT_EXCEEDED',
                message: `سقف تماس روزانه ${dailyCallLimit} است.`,
            });
        }

        return {
            catalogName: ad.catalog.name,
            phone: ad.catalog.phone || ownerPhone,
            ownerPhone,
            remainingCalls: dailyCallLimit - (callsToday + 1),
            dailyLimit: dailyCallLimit,
        };
    }

    async bulkUpdate(userId: string, updates: { id: string; unitPrice: number }[]) {
        if (!updates || updates.length === 0) throw new BadRequestException('هیچ آگهی ارسال نشده است.');

        // ✅ کاتالوگ‌های کاربر از مسیر نهادها
        const userBizIds = (await this.prisma.business.findMany({
            where: { ownerUserId: userId, status: 'active' },
            select: { id: true },
        })).map((b) => b.id);

        const userCatalogs = await this.prisma.catalog.findMany({
            where: { businessId: { in: userBizIds }, status: 'active' },
            select: { id: true },
        });
        const catalogIds = userCatalogs.map((b) => b.id);

        const ads = await this.prisma.ad.findMany({
            where: { id: { in: updates.map((u) => u.id) } },
            select: { id: true, catalogId: true },
        });
        for (const ad of ads) {
            if (!catalogIds.includes(ad.catalogId)) {
                throw new ForbiddenException(`شما مالک آگهی ${ad.id} نیستید.`);
            }
        }

        const updatePromises = updates.map((update) =>
            this.prisma.ad.update({
                where: { id: update.id },
                data: {
                    unitPrice: update.unitPrice,
                    updatedAt: new Date(),
                    priceHistory: { push: { price: update.unitPrice, updatedAt: new Date().toISOString(), note: 'ویرایش گروهی قیمت' } },
                },
                select: { id: true, unitPrice: true },
            }),
        );
        const results = await this.prisma.$transaction(updatePromises);
        return { message: `${results.length} آگهی به‌روزرسانی شد`, updatedAds: results };
    }

    async trackInteraction(adId: string, userId: string | null, type: 'view' | 'save' | 'call' | 'comment' | 'share', metadata?: any) {
        const ad = await this.prisma.ad.findUnique({
            where: { id: adId },
            include: { arm: { select: { config: true } } },
        });
        if (!ad) throw new NotFoundException({ errorCode: 'AD_NOT_FOUND', message: 'آگهی یافت نشد' });

        const config = (ad.arm?.config as any) || {};
        const interactionCost = config.economy?.interactionCosts || {};
        const cost = interactionCost[type] || 0;

        const now = new Date();
        const recentThreshold = new Date(now.getTime() - 10 * 1000);
        const existingRecent = await this.prisma.adInteraction.findFirst({
            where: {
                adId, type, createdAt: { gte: recentThreshold },
                ...(userId ? { userId } : { sessionId: metadata?.sessionId }),
            },
        });
        if (existingRecent) return { success: false, message: 'لطفاً چند ثانیه صبر کنید' };

        if (cost > 0 && userId) {
            const balance = await this.creditService.getUserBalance(userId);
            if (balance.balance < cost) {
                throw new BadRequestException({
                    errorCode: 'INSUFFICIENT_CREDIT',
                    message: `اعتبار کافی نیست. برای ${type} به ${cost} اعتبار نیاز دارید.`,
                    data: { needed: cost, balance: balance.balance },
                });
            }
            await this.prisma.credit.create({
                data: {
                    userId, amount: 0, currency: 'IRR', creditCount: -cost,
                    creditType: 'purchased', transactionType: 'spend', status: 'success',
                    description: `هزینه ${type} آگهی "${ad.title}"`,
                    relatedEntityId: adId, relatedEntityType: 'AdInteraction',
                    metadata: { type, cost, ad_id: adId },
                },
            });
        }

        const interaction = await this.prisma.adInteraction.create({
            data: {
                adId, userId: userId || null, type, metadata,
                ipAddress: metadata?.ipAddress, userAgent: metadata?.userAgent, sessionId: metadata?.sessionId,
            },
        });

        if (type === 'view') await this.prisma.ad.update({ where: { id: adId }, data: { viewCount: { increment: 1 } } });
        if (type === 'call') await this.prisma.ad.update({ where: { id: adId }, data: { callCount: { increment: 1 } } });

        return { success: true, interaction, cost };
    }

    async isAdSaved(adId: string, userId: string | null) {
        if (!userId) return { isSaved: false };
        const saved = await this.prisma.adInteraction.findFirst({
            where: { adId, userId, type: 'save' },
        });
        return { isSaved: !!saved };
    }

    async getAdStats(adId: string) {
        const interactions = await this.prisma.adInteraction.groupBy({ by: ['type'], where: { adId }, _count: true });
        const uniqueViews = await this.prisma.adInteraction.groupBy({
            by: ['userId'], where: { adId, type: 'view', userId: { not: null } }, _count: true,
        });

        const summary = {
            totalViews: interactions.find((i) => i.type === 'view')?._count || 0,
            uniqueViews: uniqueViews.length,
            totalSaves: interactions.find((i) => i.type === 'save')?._count || 0,
            totalCalls: interactions.find((i) => i.type === 'call')?._count || 0,
            totalComments: interactions.find((i) => i.type === 'comment')?._count || 0,
            totalShares: interactions.find((i) => i.type === 'share')?._count || 0,
        };

        const interactionList = await this.prisma.adInteraction.findMany({
            where: { adId },
            include: { user: { select: { id: true, fullName: true, phone: true, avatarUrl: true } } },
            orderBy: { createdAt: 'desc' },
        });

        const grouped = interactionList.reduce((acc, item) => {
            const type = item.type;
            if (!acc[type]) acc[type] = [];
            if (item.user) {
                acc[type].push({
                    userId: item.user.id,
                    fullName: item.user.fullName,
                    phone: item.user.phone,
                    avatarUrl: item.user.avatarUrl
                        ? `${process.env.API_BASE_URL || 'http://localhost:3011'}${item.user.avatarUrl.startsWith('/') ? '' : '/'}${item.user.avatarUrl}`
                        : null,
                    interactedAt: item.createdAt,
                });
            }
            return acc;
        }, {} as Record<string, any[]>);

        return {
            summary,
            details: {
                views: grouped.view || [],
                saves: grouped.save || [],
                calls: grouped.call || [],
                comments: grouped.comment || [],
                shares: grouped.share || [],
            },
        };
    }

    // ═══════════════════════════════════════
    // لیست کالاهای یک کاتالوگ — search + statusFilter
    // ═══════════════════════════════════════
    async getCatalogAds(
        catalogId: string,
        page: number = 1,
        limit: number = 10,
        search?: string,
        statusFilter?: string,
    ) {
        const skip = (page - 1) * limit;

        const where: any = {
            catalogId,
            status: { not: 'deleted' },
        };

        const andConds: any[] = [];

        if (statusFilter === 'active') {
            andConds.push({ status: 'active', expiresAt: { gt: new Date() } });
        } else if (statusFilter === 'pending') {
            andConds.push({ status: { in: ['pending', 'rejected'] } });
        } else if (statusFilter === 'archived') {
            andConds.push({
                OR: [
                    { status: 'inactive' },
                    { status: 'expired' },
                    { status: 'active', expiresAt: { lt: new Date() } },
                ],
            });
        }

        if (search) {
            andConds.push({
                OR: [
                    { title: { contains: search, mode: 'insensitive' } },
                    { productType: { contains: search, mode: 'insensitive' } },
                ],
            });
        }

        if (andConds.length) where.AND = andConds;

        const [ads, total] = await Promise.all([
            this.prisma.ad.findMany({
                where,
                include: {
                    unit: { select: { id: true, title: true, shortCode: true } },
                    arm: { select: { id: true, slug: true, name: true, categoryTree: true } },
                    files: {
                        where: { relatedModel: 'Ad' },
                        select: { id: true, path: true, thumbnailPath: true, fieldKey: true },
                    },
                    // ✅ اضافه شدن publications برای نمایش بازارهایی که آگهی در اون‌ها فعاله
                    publications: {
                        where: { status: 'published' },
                        select: {
                            armId: true,
                            status: true,
                            arm: {
                                select: {
                                    id: true,
                                    slug: true,
                                    name: true,
                                    colorPrimary: true,
                                },
                            },
                        },
                    },
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            this.prisma.ad.count({ where }),
        ]);

        return {
            ads,
            total,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    // ═══════════════════════════════════════
    // جستجو — لاگ/پیشنهاد/تاریخچه
    // ═══════════════════════════════════════

    private armIdCache = new Map<string, { id: string; at: number }>();
    private armIdCacheTtl = 10 * 60 * 1000;
    private lastLogAt = new Map<string, number>();
    private readonly LOG_THROTTLE_MS = 30_000;

    private async resolveArmId(slug?: string): Promise<string | null> {
        if (!slug) return null;
        const hit = this.armIdCache.get(slug);
        if (hit && Date.now() - hit.at < this.armIdCacheTtl) return hit.id;
        const arm = await this.prisma.arm.findUnique({
            where: { slug },
            select: { id: true },
        });
        if (!arm) return null;
        this.armIdCache.set(slug, { id: arm.id, at: Date.now() });
        return arm.id;
    }

    async logSearch(userId: string | undefined, dto: SearchLogDto): Promise<void> {
        void (async () => {
            try {
                const term = FA_NORMALIZE(dto.term);
                if (term.length < 2 || term.length > 60) return;

                const armId = await this.resolveArmId(dto.armSlug);
                if (!armId) return;

                const key = `${userId ?? 'anon'}|${armId}|${term}`;
                const now = Date.now();
                if (now - (this.lastLogAt.get(key) ?? 0) < this.LOG_THROTTLE_MS) return;
                this.lastLogAt.set(key, now);
                if (this.lastLogAt.size > 5000) this.lastLogAt.clear();

                await this.prisma.searchLog.create({
                    data: {
                        armId,
                        userId: userId ?? null,
                        term,
                        rawTerm: dto.term.slice(0, 120),
                        resultCount: Math.max(0, Math.floor(dto.resultCount ?? 0)),
                    },
                });
            } catch {
                /* لاگ هیچ‌وقت نباید خطا بدهد */
            }
        })();
    }

    async searchSuggest(armSlug: string, q: string, limit = 8) {
        const term = FA_NORMALIZE(q);
        if (term.length < 2) return { suggestions: [] };

        const armId = await this.resolveArmId(armSlug);
        if (!armId) return { suggestions: [] };

        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        try {
            const result = await this.prisma.$runCommandRaw({
                aggregate: 'search_logs',
                pipeline: [
                    {
                        $match: {
                            armId: { $oid: armId },
                            term: { $regex: `^${escapeRegex(term)}` },
                            createdAt: { $gte: { $date: since.toISOString() } },
                            resultCount: { $gt: 0 },
                        },
                    },
                    {
                        $group: {
                            _id: '$term',
                            searches: { $sum: 1 },
                            users: { $addToSet: '$userId' },
                        },
                    },
                    {
                        $project: {
                            _id: 0,
                            term: '$_id',
                            searches: 1,
                            userCount: {
                                $cond: [
                                    { $in: [null, '$users'] },
                                    { $subtract: [{ $size: '$users' }, 1] },
                                    { $size: '$users' },
                                ],
                            },
                        },
                    },
                    { $sort: { searches: -1, userCount: -1 } },
                    { $limit: Math.min(Math.max(limit, 1), 10) },
                ],
                cursor: {},
            });

            const rows: any[] = (result as any)?.cursor?.firstBatch ?? [];
            return { suggestions: rows };
        } catch {
            return { suggestions: [] };
        }
    }

    async searchHistory(userId: string, armSlug?: string, take = 10) {
        const armId = armSlug ? await this.resolveArmId(armSlug) : null;
        const logs = await this.prisma.searchLog.findMany({
            where: { userId, ...(armId ? { armId } : {}) },
            orderBy: { createdAt: 'desc' },
            take: 100,
            select: { term: true, createdAt: true },
        });

        const seen = new Set<string>();
        const items: { term: string; at: Date }[] = [];
        for (const l of logs) {
            if (seen.has(l.term)) continue;
            seen.add(l.term);
            items.push({ term: l.term, at: l.createdAt });
            if (items.length >= take) break;
        }
        return { items };
    }

    async clearSearchHistory(userId: string, armSlug?: string) {
        const armId = armSlug ? await this.resolveArmId(armSlug) : null;
        const res = await this.prisma.searchLog.deleteMany({
            where: { userId, ...(armId ? { armId } : {}) },
        });
        return { success: true, deleted: res.count };
    }

    async purgeOldSearchLogs(days = 90) {
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const res = await this.prisma.searchLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
        return { deleted: res.count };
    }

    // ═══════════════════════════════════════
    // اعلان‌های مشتق
    // ═══════════════════════════════════════
    async derivedNotifications(userId: string) {
        const userBizIds = (await this.prisma.business.findMany({
            where: { ownerUserId: userId, status: 'active' },
            select: { id: true },
        })).map((b) => b.id);

        const catalogs = await this.prisma.catalog.findMany({
            where: { businessId: { in: userBizIds }, status: 'active' },
            select: { id: true, name: true, slug: true, logoUrl: true, phone: true, shortDescription: true, industryName: true },
        });

        const now = new Date();
        const soon = new Date(Date.now() + 24 * 60 * 60 * 1000);

        const items: any[] = [];
        const catalogIds: string[] = [];

        for (const b of catalogs) {
            catalogIds.push(b.id);

            const expiring = await this.prisma.ad.findMany({
                where: {
                    catalogId: b.id,
                    status: 'active',
                    OR: [{ expiresAt: { lte: soon } }],
                },
                select: { id: true, productType: true, title: true, expiresAt: true },
                orderBy: { expiresAt: 'asc' },
                take: 20,
            });

            for (const ad of expiring) {
                const expired = new Date(ad.expiresAt).getTime() <= now.getTime();
                items.push({
                    id: `exp-${ad.id}`,
                    type: 'price-expired',
                    severity: expired ? 'danger' : 'warning',
                    title: expired
                        ? `قیمت «${ad.productType || ad.title}» تمام شده`
                        : `اعتبار قیمت «${ad.productType || ad.title}» تا امشب تمام می‌شود`,
                    action: { label: expired ? 'تازه‌سازی قیمت' : 'دیدن', href: `/my-catalogs?catalog=${b.id}` },
                    catalogId: b.id,
                });
            }

            if (!b.slug) {
                items.push({
                    id: `noslug-${b.id}`,
                    type: 'incomplete',
                    severity: 'warning',
                    title: `«${b.name}» آدرس اختصاصی ندارد — برای اشتراک‌گذاری تنظیمش کن`,
                    action: { label: 'تنظیم آدرس', href: `/my-catalogs?catalog=${b.id}` },
                    catalogId: b.id,
                });
            }
            if (!b.logoUrl) {
                items.push({
                    id: `nologo-${b.id}`,
                    type: 'incomplete',
                    severity: 'info',
                    title: `«${b.name}» لوگو ندارد — کاتالوگ با لوگو اعتماد بیشتری می‌گیرد`,
                    action: { label: 'افزودن لوگو', href: `/my-catalogs?catalog=${b.id}` },
                    catalogId: b.id,
                });
            }
        }

        const memberships = await this.prisma.armMembership.findMany({
            where: { userId, catalogId: { in: catalogIds.length ? catalogIds : ['__none__'] } },
            select: {
                status: true, catalogId: true, roleType: true, publishState: true,
                joinedAt: true,
                arm: { select: { name: true, slug: true } },
            },
        });

        // ═══ ✅ NEW — عضویتِ تازهٔ فروشنده: جشنِ عضویت (۴۸ ساعت اول) ═══
        const freshSellerMemberships = memberships.filter((m) =>
            m.roleType === 'seller' &&
            m.status === 'active' &&
            m.publishState === 'published' &&
            Date.now() - new Date(m.joinedAt).getTime() < 48 * 60 * 60 * 1000,
        );
        for (const m of freshSellerMemberships) {
            items.unshift({
                id: `joined-${m.catalogId}-${m.arm.slug}`,
                type: 'membership',
                severity: 'success',
                title: `🎉 کاتالوگت فروشندهٔ ${m.arm.name} شد!`,
                body: 'کالاهات حالا کنار رقیب‌هات روی تابلوی قیمت دیده می‌شوند — برای پیدا شدن در فیلترها، دسته‌بندی بازار را برایشان انتخاب کن',
                action: { label: 'تنظیم دسته‌ها', href: `/my-catalogs?catalog=${m.catalogId}&filter=uncat` },
                catalogId: m.catalogId,
            });
        }

        // ═══ ✅ NEW — عضویتِ تازهٔ خریدار ═══
        const freshBuyerMemberships = memberships.filter((m) =>
            m.roleType === 'buyer' &&
            m.status === 'active' &&
            Date.now() - new Date(m.joinedAt).getTime() < 48 * 60 * 60 * 1000,
        );
        for (const m of freshBuyerMemberships) {
            items.unshift({
                id: `buyer-${m.catalogId}-${m.arm.slug}`,
                type: 'membership-buyer',
                severity: 'success',
                title: `به ${m.arm.name} خوش آمدی!`,
                body: 'حالا قیمت‌های روز همهٔ فروشندگان این بازار را می‌بینی — مقایسه کن و مستقیم تماس بگیر',
                action: { label: 'دیدن تابلو', href: `/${m.arm.slug}` },
                catalogId: m.catalogId,
            });
        }

        // کاتالوگ‌های منتشرنشده
        for (const b of catalogs) {
            const has = memberships.some((m) => m.catalogId === b.id && m.status === 'active');
            if (!has && catalogIds.length) {
                items.push({
                    id: `nopub-${b.id}`,
                    type: 'unpublished',
                    severity: 'info',
                    title: `«${b.name}» در هیچ بازاری منتشر نشده`,
                    action: { label: 'انتشار', href: `/my-catalogs?catalog=${b.id}` },
                    catalogId: b.id,
                });
            }
        }

        // کالاهای منتشرشدهٔ بی‌دسته در بازار
        const memberCatIds = memberships
            .filter((m) => m.status === 'active' && m.catalogId)
            .map((m) => m.catalogId!);
        if (memberCatIds.length) {
            const needCatAds = await this.prisma.ad.findMany({
                where: {
                    catalogId: { in: memberCatIds },
                    armId: { not: null },
                    status: 'active',
                    categoryId: null,
                    catalogCategoryId: { not: null },
                },
                select: { catalogId: true, arm: { select: { name: true, slug: true } } },
                take: 500,
            });
            const perCat = new Map<string, { count: number; armName: string }>();
            for (const a of needCatAds) {
                const cur = perCat.get(a.catalogId) ?? { count: 0, armName: (a.arm as any)?.name ?? 'بازار' };
                perCat.set(a.catalogId, { count: cur.count + 1, armName: cur.armName });
            }
            const slugOf = new Map(catalogs.map((b) => [b.id, b.slug]));
            for (const [catId, info] of perCat) {
                items.push({
                    id: `needcat-${catId}`,
                    type: 'market-setup',
                    severity: 'warning',
                    title: `${info.count.toLocaleString('fa-IR')} کالای تو در ${info.armName} دسته‌بندی نشده است`,
                    body: 'برای اینکه در فیلترها و جستجوی بازار پیدا شوی، دسته‌بندی بازار را برای این کالاها انتخاب کن',
                    action: { label: 'تنظیم دسته‌ها', href: `/my-catalogs?catalog=${catId}&filter=uncat` },
                    catalogId: catId,
                });
            }
        }

        const unread = items.filter((i) => i.severity !== 'info').length;
        return { items, unread };
    }
}