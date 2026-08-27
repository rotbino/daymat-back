// src/ad/ad.service.ts
import {
    Injectable,
    NotFoundException,
    ForbiddenException,
    BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ArmService } from '../arm/arm.service';
import { CreateAdDto, UpdateAdDto, AdListQueryDto, ExtendAdDto } from './ad.dto';
import { CreditService } from '../credit/credit.service';
import {
    collectCategoryIdsFromTree,
    flattenCategoryTree,
    findNodeInTree,
    findCategoryPathInTree
} from '../common/utils/arm.utils';

@Injectable()
export class AdService {
    constructor(
        private prisma: PrismaService,
        private armService: ArmService,
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
    // 1. ثبت آگهی جدید
    // ═══════════════════════════════════════
    // src/ad/ad.service.ts

// ═══════════════════════════════════════
// 1. ثبت آگهی جدید
// ═══════════════════════════════════════
    // src/ad/ad.service.ts

// ═══════════════════════════════════════
// 1. ثبت آگهی جدید
// ═══════════════════════════════════════
    async create(userId: string, dto: CreateAdDto) {
        const arm = await this.armService.findBySlug(dto.armSlug);
        const config = arm.config as any || {};
        const categoryTree = (arm.categoryTree as any[]) || [];

        const business = await this.prisma.business.findFirst({
            where: { ownerUserId: userId, status: 'active' },
        });
        if (!business) {
            throw new BadRequestException({
                errorCode: 'NO_ACTIVE_BUSINESS',
                message: 'ابتدا یک کسب‌وکار ثبت کنید',
            });
        }

        const membership = await this.prisma.armMembership.findFirst({
            where: { armId: arm.id, userId: userId, status: 'active' },
        });
        if (!membership) {
            throw new ForbiddenException({
                errorCode: 'NOT_MEMBER',
                message: 'شما به این بازار نپیوسته اید',
            });
        }

        if (dto.categoryId) {
            const existing = await this.prisma.ad.findFirst({
                where: {
                    armId: arm.id,
                    businessId: business.id,
                    categoryId: dto.categoryId,
                    minQuantity: dto.minQuantity,
                    productType: dto.productType,
                    status: { not: 'deleted' },
                },
            });
            if (existing) {
                throw new BadRequestException({
                    errorCode: 'DUPLICATE_MIN_QUANTITY',
                    message: 'شما قبلاً برای این آگهی با همین حداقل خرید قیمت ثبت کرده اید.',
                });
            }
        }

        const allowAnonymous = this.getConfigValue(config, 'modules.priceTable.allowAnonymousPublishing', true);
        if (dto.isAnonymous && !allowAnonymous) {
            throw new BadRequestException({
                errorCode: 'ANONYMOUS_NOT_ALLOWED',
                message: 'انتشار ناشناس در این بازار مجاز نیست',
            });
        }

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

        // ─── خواندن تنظیمات سهمیه‌ها و هزینه‌ها ───
        const maxActiveAdsPerUser = this.getConfigValue(config, 'modules.priceTable.maxActiveAdsPerUser', 5);
        const maxTotalFreeAdPerUser = this.getConfigValue(config, 'modules.priceTable.maxTotalFreeAdPerUser', 20);
        const bumpCostBase = this.getConfigValue(config, 'modules.priceTable.bumpCost', 10);
        const extraActiveAdCostPerDay = this.getConfigValue(config, 'modules.priceTable.extraActiveAdCost', 2);
        const adCreationCostMonthly = this.getConfigValue(config, 'modules.priceTable.adCreationCost', 2);
        const defaultValidityHours = this.getConfigValue(config, 'modules.priceTable.adValidityDefaultHours', 24);
        const requiresApprovalOnCreate = this.getConfigValue(config, 'modules.priceTable.approval.requiresApprovalOnCreate', false);

        // ─── شمارش آگهی‌ها ───
        const activeAdsCount = await this.prisma.ad.count({
            where: { businessId: business.id, armId: arm.id, status: 'active', expiresAt: { gt: new Date() } },
        });
        const totalAdsCount = await this.prisma.ad.count({
            where: { businessId: business.id, armId: arm.id, status: { not: 'deleted' } },
        });

        const hasReachedActiveLimit = activeAdsCount >= maxActiveAdsPerUser;
        const hasReachedTotalLimit = totalAdsCount >= maxTotalFreeAdPerUser;
        const needsCredit = hasReachedActiveLimit || hasReachedTotalLimit;

        const freeActiveSlotsRemaining = Math.max(0, maxActiveAdsPerUser - activeAdsCount - 1);
        const freeTotalSlotsRemaining = Math.max(0, maxTotalFreeAdPerUser - totalAdsCount - 1);

        const validityHours = dto.validityHours || defaultValidityHours;

        // ─── محاسبه هزینه نردبان ───
        let bumpDurationHours: number | null = null;
        let bumpCostTotal = 0;
        let bumpExpiresAt: Date | null = null;

        if (dto.isBumped) {
            bumpDurationHours = dto.bumpDurationHours ?? 24;
            if (bumpDurationHours > validityHours) {
                throw new BadRequestException({
                    errorCode: 'BUMP_DURATION_EXCEEDS_VALIDITY',
                    message: 'مدت نردبان نمی‌تواند از اعتبار قیمت بیشتر باشد.',
                });
            }
            bumpCostTotal = (bumpDurationHours / 24) * bumpCostBase;
            if (!requiresApprovalOnCreate) {
                bumpExpiresAt = new Date(Date.now() + bumpDurationHours * 60 * 60 * 1000);
            }
        }

        // ─── محاسبه هزینه کل ───
        let totalCost = 0;

        // ✅ هزینه آگهی اضافه روی تابلو (روزانه)
        if (hasReachedActiveLimit) {
            const days = Math.max(1, Math.ceil(validityHours / 24));
            totalCost += extraActiveAdCostPerDay * days;
        }

        // ✅ هزینه آگهی اضافه بابت پر شدن سهمیه کل (ماهانه)
        if (hasReachedTotalLimit) {
            totalCost += adCreationCostMonthly;
        }

        // ✅ هزینه نردبان
        if (dto.isBumped && !requiresApprovalOnCreate) {
            totalCost += bumpCostTotal;
        }

        // ─── کسر اعتبار در صورت نیاز ───
        let creditDeducted = false;
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
                    userId,
                    businessId: business.id,
                    armId: arm.id,
                    amount: 0,
                    currency: 'IRR',
                    creditCount: -totalCost,
                    pricePerCredit: null,
                    creditType: 'purchased',
                    transactionType: 'spend',
                    status: 'success',
                    description: `ثبت آگهی${dto.isBumped ? ' و نردبان' : ''}`,
                    metadata: { ad_title: dto.title, cost: totalCost, arm_slug: arm.slug },
                },
            });
            creditDeducted = true;
        }

        // ─── اعتبارسنجی دسته‌بندی ───
        if (!dto.categoryId) {
            throw new BadRequestException({
                errorCode: 'CATEGORY_REQUIRED',
                message: 'categoryId الزامی است.',
            });
        }

        const categoryIds = collectCategoryIdsFromTree(categoryTree);
        if (!categoryIds.has(dto.categoryId)) {
            throw new BadRequestException({
                errorCode: 'CATEGORY_NOT_AVAILABLE_IN_ARM',
                message: 'این دسته‌بندی برای بازاری فعلی فعال نیست.',
            });
        }

        const categorySelection = findNodeInTree(categoryTree, dto.categoryId);
        const categoryPath = findCategoryPathInTree(categoryTree, dto.categoryId);

        if (dto.availableQuantity !== null && dto.availableQuantity !== undefined) {
            if (dto.minQuantity > dto.availableQuantity) {
                throw new BadRequestException({
                    errorCode: 'MIN_QUANTITY_EXCEEDS_STOCK',
                    message: 'حداقل حجم خرید نمی‌تواند از موجودی بیشتر باشد.',
                });
            }
        }

        const expiresAt = new Date();
        expiresAt.setHours(validityHours, 0, 0, 0);
        expiresAt.setDate(expiresAt.getDate());

        const ad = await this.prisma.ad.create({
            data: {
                armId: arm.id,
                businessId: business.id,
                createdByUserId: userId,
                categoryId: dto.categoryId,
                unitId: dto.unitId,
                title: dto.title || categorySelection?.title || '',
                productType: dto.productType || null,
                paymentMethods: (dto.paymentMethods as any) || null,
                specs: dto.specs || null,
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
                countryCode: dto.countryCode || '98',
                provinceCode: dto.provinceCode || null,
                cityCode: dto.cityCode || null,
                locationDetail: dto.locationDetail || '',
                validityHours,
                expiresAt,
                isAnonymous: dto.isAnonymous || false,
                isBumped: dto.isBumped || false,
                bumpDurationHours: dto.isBumped ? bumpDurationHours : null,
                bumpExpiresAt: dto.isBumped ? bumpExpiresAt : null,
                priceHistory: [{ price: dto.unitPrice, updatedAt: new Date().toISOString(), note: 'ثبت اولیه' }],
                status: requiresApprovalOnCreate ? 'pending' : 'active',
                source: 'manual',
                categoryPath: categoryPath,
                unitQty: dto.unitQty || null,
                unitIsVariableQty: dto.unitIsVariableQty || false,
                unitBaseTitle: categorySelection?.baseUnitTitle || null,
            },
            include: {
                unit: { select: { id: true, title: true, shortCode: true } },
                business: { select: { id: true, name: true, verificationTier: true } },
            },
        });

        return {
            ...ad,
            isOverQuota: needsCredit,
            creditDeducted,
            freeQuotaRemaining: Math.min(freeActiveSlotsRemaining, freeTotalSlotsRemaining),
            requiresApproval: requiresApprovalOnCreate,
            isBumped: ad.isBumped,
            bumpStatus: ad.isBumped ? (ad.bumpExpiresAt ? 'active' : 'pending') : 'none',
            bumpDurationHours: ad.bumpDurationHours,
            bumpCostTotal: dto.isBumped ? bumpCostTotal : 0,
        };
    }

// ═══════════════════════════════════════
// 2. ویرایش آگهی
// ═══════════════════════════════════════
    async update(id: string, userId: string, dto: UpdateAdDto) {
        const ad = await this.prisma.ad.findUnique({
            where: { id },
            include: {
                business: { select: { ownerUserId: true } },
                arm: { select: { config: true, id: true, categoryTree: true } },
            },
        });

        if (!ad) throw new NotFoundException({ errorCode: 'AD_NOT_FOUND', message: 'آگهی یافت نشد' });
        if (ad.business.ownerUserId !== userId) throw new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'شما اجازه ویرایش این آگهی را ندارید' });

        const config = ad.arm.config as any || {};
        const categoryTree = (ad.arm.categoryTree as any[]) || [];
        const updateData: any = {};

        const isRejected = ad.status === 'rejected' && ad.rejectionReason && ad.rejectionReason.length > 0;
        if (isRejected) {
            updateData.status = 'pending';
            updateData.rejectionReason = null;
        }

        // ═══════════════════════════════════════
        // ✅ تغییر categoryId و محاسبه categoryPath
        // ═══════════════════════════════════════
        if (dto.categoryId !== undefined && dto.categoryId !== ad.categoryId) {
            const categoryIds = collectCategoryIdsFromTree(categoryTree);
            if (!categoryIds.has(dto.categoryId)) {
                throw new BadRequestException({
                    errorCode: 'CATEGORY_NOT_AVAILABLE_IN_ARM',
                    message: 'این دسته‌بندی برای بازاری فعلی فعال نیست.',
                });
            }

            updateData.categoryId = dto.categoryId;
            const newCategoryPath = findCategoryPathInTree(categoryTree, dto.categoryId);
            updateData.categoryPath = newCategoryPath;

            const categorySelection = findNodeInTree(categoryTree, dto.categoryId);
            updateData.unitBaseTitle = categorySelection?.baseUnitTitle || null;

            if (dto.unitId === undefined && categorySelection) {
                const newUnitId = categorySelection.overrideUnitId || null;
                const newUnitQty = categorySelection.overrideUnitQty || null;
                const newUnitIsVariableQty = categorySelection.overrideUnitIsVariableQty || false;
                if (newUnitId) {
                    updateData.unitId = newUnitId;
                    updateData.unitQty = newUnitQty;
                    updateData.unitIsVariableQty = newUnitIsVariableQty;
                }
            }
        }

        if (dto.minQuantity !== undefined && dto.minQuantity !== ad.minQuantity) {
            const existing = await this.prisma.ad.findFirst({
                where: {
                    armId: ad.armId,
                    businessId: ad.businessId,
                    categoryId: ad.categoryId || dto.categoryId,
                    minQuantity: dto.minQuantity,
                    productType: dto.productType,
                    status: { not: 'deleted' },
                    id: { not: id },
                },
            });
            if (existing) {
                throw new BadRequestException({
                    errorCode: 'DUPLICATE_MIN_QUANTITY',
                    message: 'شما قبلاً برای این آگهی با همین حداقل خرید قیمت ثبت کرده اید.',
                });
            }
        }

        if (dto.unitId !== undefined && dto.unitId !== ad.unitId) {
            const unitExists = await this.prisma.unit.findUnique({ where: { id: dto.unitId } });
            if (!unitExists) {
                throw new BadRequestException({
                    errorCode: 'UNIT_NOT_FOUND',
                    message: 'واحد اندازه‌گیری انتخاب شده معتبر نیست',
                });
            }
            updateData.unitId = dto.unitId;
        }
        if (dto.unitQty !== undefined) updateData.unitQty = dto.unitQty;
        if (dto.unitIsVariableQty !== undefined) updateData.unitIsVariableQty = dto.unitIsVariableQty;

        // ═══════════════════════════════════════
        // نردبان (Bump)
        // ═══════════════════════════════════════
        const isBumpActive = ad.isBumped && ad.bumpExpiresAt && ad.bumpExpiresAt > new Date();

        if (isBumpActive) {
            if (dto.isBumped === true) {
                throw new BadRequestException({ errorCode: 'BUMP_ALREADY_ACTIVE', message: 'آگهی در حال نردبان است.' });
            }
            if (dto.bumpDurationHours !== undefined) {
                throw new BadRequestException({ errorCode: 'BUMP_DURATION_CHANGE_NOT_ALLOWED', message: 'تغییر مدت نردبان مجاز نیست.' });
            }
        }

        if (dto.isBumped !== undefined && dto.isBumped !== ad.isBumped) {
            if (dto.isBumped === true) {
                let bumpDurationHours = dto.bumpDurationHours ?? ad.bumpDurationHours ?? 24;
                const validityHours = dto.validityHours ?? ad.validityHours;
                if (bumpDurationHours > validityHours) {
                    throw new BadRequestException({ errorCode: 'BUMP_DURATION_EXCEEDS_VALIDITY', message: 'مدت نردبان نمی‌تواند بیشتر از اعتبار باشد.' });
                }
                const baseCost = this.getConfigValue(config, 'modules.priceTable.bumpCost', 10);
                const bumpCostTotal = (bumpDurationHours / 24) * baseCost;

                if (ad.status === 'active') {
                    const balance = await this.creditService.getUserBalance(userId);
                    if (balance.balance < bumpCostTotal) {
                        throw new BadRequestException({ errorCode: 'INSUFFICIENT_CREDIT', message: 'اعتبار کافی نیست.', data: { needed: bumpCostTotal, balance: balance.balance } });
                    }
                    await this.prisma.credit.create({
                        data: {
                            userId, businessId: ad.businessId, armId: ad.armId,
                            amount: 0, currency: 'IRR', creditCount: -bumpCostTotal,
                            creditType: 'purchased', status: 'success',
                            transactionType: 'spend', description: `نردبان آگهی "${ad.title}"`,
                            metadata: { ad_id: id, cost: bumpCostTotal },
                        },
                    });
                    const bumpExpiresAt = new Date(Date.now() + bumpDurationHours * 60 * 60 * 1000);
                    updateData.isBumped = true;
                    updateData.bumpDurationHours = bumpDurationHours;
                    updateData.bumpExpiresAt = bumpExpiresAt;
                    updateData.bumpCount = { increment: 1 };
                    updateData.lastBumpedAt = new Date();
                    updateData.lastBumpCreditsSpent = bumpCostTotal;
                } else {
                    updateData.isBumped = true;
                    updateData.bumpDurationHours = bumpDurationHours;
                    updateData.bumpExpiresAt = null;
                }
            } else {
                updateData.isBumped = false;
                updateData.bumpDurationHours = null;
                updateData.bumpExpiresAt = null;
            }
        }

        // ─── سایر فیلدها ───
        if (dto.status !== undefined) updateData.status = dto.status;
        if (dto.unitPrice !== undefined) updateData.unitPrice = dto.unitPrice;
        if (dto.singleUnitPrice !== undefined) updateData.singleUnitPrice = dto.singleUnitPrice;
        if (dto.consumerPrice !== undefined) updateData.consumerPrice = dto.consumerPrice;
        if (dto.minQuantity !== undefined) updateData.minQuantity = dto.minQuantity;
        if (dto.availableQuantity !== undefined) updateData.availableQuantity = dto.availableQuantity;
        if (dto.title !== undefined) updateData.title = dto.title;
        if (dto.productType !== undefined) updateData.productType = dto.productType;
        if (dto.description !== undefined) updateData.description = dto.description;
        if (dto.city !== undefined) updateData.city = dto.city;
        if (dto.cityCode !== undefined) updateData.cityCode = dto.cityCode;
        if (dto.provinceCode !== undefined) updateData.provinceCode = dto.provinceCode;
        if (dto.province !== undefined) updateData.province = dto.province;
        if (dto.locationDetail !== undefined) updateData.locationDetail = dto.locationDetail;
        if (dto.isAnonymous !== undefined) updateData.isAnonymous = dto.isAnonymous;
        if (dto.availableQuantityBucket !== undefined) updateData.availableQuantityBucket = dto.availableQuantityBucket;
        if (dto.customFields !== undefined) updateData.customFields = dto.customFields;
        if (dto.paymentMethods !== undefined) updateData.paymentMethods = dto.paymentMethods;
        if (dto.specs !== undefined) updateData.specs = dto.specs;

        if (dto.unitPrice !== undefined && dto.unitPrice !== ad.unitPrice) {
            const history = (ad.priceHistory as any[]) || [];
            history.push({ price: dto.unitPrice, updatedAt: new Date().toISOString(), note: 'ویرایش قیمت' });
            updateData.priceHistory = history;
        }

        updateData.updatedAt = new Date();

        return this.prisma.ad.update({
            where: { id },
            data: updateData,
            include: {
                unit: { select: { id: true, title: true, shortCode: true } },
                business: { select: { id: true, name: true, verificationTier: true, trustScore: true } },
            },
        });
    }

// ═══════════════════════════════════════
// 3. تابلوی قیمت (ویترین زنده)
// ═══════════════════════════════════════
    async getVitrine(armSlug: string, query: AdListQueryDto) {
        const arm = await this.prisma.arm.findUnique({
            where: { slug: armSlug },
            select: { id: true, config: true, categoryTree: true },
        });

        if (!arm) {
            throw new NotFoundException({ errorCode: 'ARM_NOT_FOUND', message: 'بازار یافت نشد' });
        }

        const flatCategory = flattenCategoryTree(arm.categoryTree);
        const categoryMap = new Map(flatCategory.map((s: any) => [s.categoryId, s]));

        const page = query.page || 1;
        const limit = query.limit || 20;
        const skip = (page - 1) * limit;

        const where: any = {
            armId: arm.id,
            status: 'active',
            expiresAt: { gt: new Date() }
        };

        // ✅ فیلتر بر اساس categoryId (شامل فرزندان)
        if (query.categoryId) {
            const categoryNode = findNodeInTree(arm.categoryTree as any[], query.categoryId);

            if (categoryNode) {
                if (categoryNode.children && categoryNode.children.length > 0) {
                    where.categoryPath = { has: query.categoryId };
                } else {
                    where.categoryId = query.categoryId;
                }
            } else {
                where.categoryId = query.categoryId;
            }
        }

        // ✅ فیلتر شهر
        if (query.cityCode) {
            where.cityCode = query.cityCode;
        }

        // ✅ فیلتر استان
        if (query.provinceCode) {
            where.provinceCode = query.provinceCode;
        }

        // ✅ فیلتر قیمت
        if (query.minPrice !== undefined || query.maxPrice !== undefined) {
            where.unitPrice = {};
            if (query.minPrice !== undefined) where.unitPrice.gte = query.minPrice;
            if (query.maxPrice !== undefined) where.unitPrice.lte = query.maxPrice;
        }

        // ✅ فیلتر موجودی
        if (query.minAvailableQuantity !== undefined || query.maxAvailableQuantity !== undefined) {
            where.availableQuantity = {};
            if (query.minAvailableQuantity !== undefined) where.availableQuantity.gte = query.minAvailableQuantity;
            if (query.maxAvailableQuantity !== undefined) where.availableQuantity.lte = query.maxAvailableQuantity;
        }

        // ✅ فیلتر حداقل سفارش
        if (query.minQuantity !== undefined) {
            where.minQuantity = { gte: query.minQuantity };
        }

        // ✅ فیلتر نردبان
        if (query.bumpFilter === 'bumped') {
            where.isBumped = true;
            where.bumpExpiresAt = { gt: new Date() };
        } else if (query.bumpFilter === 'normal') {
            where.OR = [
                { isBumped: false },
                { bumpExpiresAt: { lt: new Date() } },
            ];
        }

        const orderBy: any[] = [{ isBumped: 'desc' }, { updatedAt: 'desc' }];

        const [ads, total] = await Promise.all([
            this.prisma.ad.findMany({
                where,
                orderBy,
                skip,
                take: limit,
                select: {
                    id: true,
                    title: true,             // ✅ اضافه شد
                    productType: true,
                    unitPrice: true,
                    singleUnitPrice: true,   // ✅ اضافه شد
                    consumerPrice: true,     // ✅ اضافه شد
                    minQuantity: true,
                    availableQuantity: true,
                    city: true,
                    cityCode: true,          // ✅ اضافه شد
                    provinceCode: true,      // ✅ اضافه شد
                    isBumped: true,
                    unitQty: true,
                    unitIsVariableQty: true,
                    unitBaseTitle: true,
                    categoryId: true,
                    categoryPath: true,
                    isAnonymous: true,
                    paymentMethods: true,    // ✅ اضافه شد
                    updatedAt: true,
                    createdAt: true,         // ✅ اضافه شد
                    unit: { select: { shortCode: true, title: true } },
                    business: {
                        select: {
                            name: true,
                            verificationTier: true,
                            type: true,
                            city: true,
                            phone: true
                        },
                    },
                    files: {
                        where: { relatedModel: 'Ad', fieldKey: { startsWith: 'ad-image' } },
                        select: { path: true, thumbnailPath: true }, // ✅ path هم اضافه شد
                        take: 1,
                    },
                },
            }),
            this.prisma.ad.count({ where }),
        ]);

        const adsWithCustomLabel = ads.map(ad => {
            const selection = categoryMap.get(ad.categoryId) as any | undefined;
            return {
                ...ad,
                categoryTitle: selection?.customLabel || selection?.title || ad.categoryId || '',
                unitBaseTitle: selection?.baseUnitTitle || ad.unitBaseTitle || null,
            };
        });

        return {
            ads: adsWithCustomLabel,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            },
        };
    }


    // ═══════════════════════════════════════
    // 4. نردبان
    // ═══════════════════════════════════════
    async bump(id: string, userId: string) {
        const ad = await this.prisma.ad.findUnique({
            where: { id },
            include: {
                arm: true,
                business: { select: { ownerUserId: true, id: true } },
            },
        });

        if (!ad) throw new NotFoundException({ errorCode: 'AD_NOT_FOUND', message: 'آگهی یافت نشد' });
        if (ad.business.ownerUserId !== userId) throw new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'شما اجازه نردبان این آگهی را ندارید' });
        if (ad.status !== 'active') throw new BadRequestException({ errorCode: 'AD_NOT_ACTIVE', message: 'فقط آگهی‌های فعال قابل نردبان هستند' });

        const config = ad.arm.config as any || {};
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
                userId, businessId: ad.businessId, armId: ad.armId,
                amount: 0, currency: 'IRR', creditCount: -bumpCost,
                pricePerCredit: null, creditType: 'purchased',
                transactionType: 'spend', description: `نردبان آگهی "${ad.title}"`,
                relatedEntityId: ad.id, relatedEntityType: 'Ad',
                metadata: { ad_title: ad.title, cost: bumpCost, arm_slug: ad.arm.slug },
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
                business: { select: { id: true, name: true, verificationTier: true } },
            },
        });
    }

    // ═══════════════════════════════════════
    // 5. لیست آگهی‌های یک کسب‌وکار
    // ═══════════════════════════════════════
// src/ad/ad.service.ts

    async getBusinessAds(
        businessId: string,
        page: number = 1,
        limit: number = 10,
        statusFilter?: string, // ✅ جدید: active | pending | archived
    ) {
        const skip = (page - 1) * limit;

        // ✅ ساخت where بر اساس فیلتر
        const where: any = {
            businessId,
            status: { not: 'deleted' },
        };

        if (statusFilter === 'active') {
            where.status = 'active';
            where.expiresAt = { gt: new Date() }; // ✅ فقط فعال و منقضی نشده
        } else if (statusFilter === 'pending') {
            where.status = { in: ['pending', 'rejected'] };
        } else if (statusFilter === 'archived') {
            where.OR = [
                { status: 'inactive' },
                { status: 'expired' },
                { status: 'active', expiresAt: { lt: new Date() } }, // ✅ فعال ولی منقضی شده
            ];
        }

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
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            this.prisma.ad.count({ where }),
        ]);

        return {
            ads,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    // ═══════════════════════════════════════
    // 6. دریافت کامل آگهی
    // ═══════════════════════════════════════
    // src/ad/ad.service.ts

    async findOne(id: string) {
        const ad = await this.prisma.ad.findUnique({
            where: { id },
            select: {
                id: true,
                title: true,
                productType: true,
                unitPrice: true,
                singleUnitPrice: true,  // ✅ اضافه شد
                consumerPrice: true,    // ✅ اضافه شد
                minQuantity: true,
                availableQuantity: true,
                city: true,
                cityCode: true,         // ✅ اضافه شد
                province: true,
                provinceCode: true,     // ✅ اضافه شد
                countryCode: true,      // ✅ اضافه شد
                locationDetail: true,   // ✅ اضافه شد
                isBumped: true,
                isAnonymous: true,
                description: true,
                updatedAt: true,
                createdAt: true,
                expiresAt: true,
                viewCount: true,
                callCount: true,
                categoryId: true,
                categoryPath: true,     // ✅ اضافه شد
                unit: { select: { id: true, title: true, shortCode: true } },
                unitQty: true,
                unitIsVariableQty: true,
                unitBaseTitle: true,
                paymentMethods: true,   // ✅ اضافه شد
                specs: true,            // ✅ اضافه شد
                customFields: true,     // ✅ اضافه شد
                bumpDurationHours: true, // ✅ اضافه شد
                bumpExpiresAt: true,    // ✅ اضافه شد
                business: {
                    select: {
                        id: true,
                        name: true,
                        shortDescription: true,
                        description: true,
                        type: true,
                        city: true,
                        slug: true,
                        cityCode: true,     // ✅ اضافه شد
                        province: true,
                        provinceCode: true, // ✅ اضافه شد
                        countryCode: true,  // ✅ اضافه شد
                        phone: true,
                        website: true,
                        verificationTier: true,
                        trustScore: true,
                        logoUrl: true,
                        createdAt: true,
                        files: { where: { fieldKey: 'logo' }, select: { id: true, path: true, thumbnailPath: true }, take: 1 },
                        owner: {
                            select: {
                                id: true, fullName: true, phone: true, avatarUrl: true,
                                files: { where: { fieldKey: 'avatar' }, select: { id: true, path: true, thumbnailPath: true }, take: 1 },
                            },
                        },
                        activities: { select: { activity: { select: { id: true, title: true } } }, take: 10 },
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

        const business = ad.business;
        const owner = business?.owner;
        const ownerAvatar = owner?.files?.[0];
        const logoFile = business?.files?.[0];
        const API_BASE = process.env.API_BASE_URL || 'http://localhost:3011';

        const getFileUrl = (file: any, isThumbnail = false) => {
            if (!file) return null;
            if (file.path?.startsWith('http')) return file.path;
            if (isThumbnail && file.thumbnailPath) return file.thumbnailPath;
            return `${API_BASE}/file/${file.id}`;
        };

        return {
            ...ad,
            business: business ? {
                id: business.id,
                name: business.name,
                shortDescription: business.shortDescription,
                description: business.description,
                type: business.type,
                city: business.city,
                cityCode: business.cityCode,        // ✅ اضافه شد
                province: business.province,
                provinceCode: business.provinceCode, // ✅ اضافه شد
                countryCode: business.countryCode,   // ✅ اضافه شد
                phone: business.phone,
                website: business.website,
                verificationTier: business.verificationTier,
                trustScore: business.trustScore,
                logoUrl: logoFile ? getFileUrl(logoFile, true) : business.logoUrl,
                logoFile: logoFile ? { id: logoFile.id, path: logoFile.path, thumbnailPath: logoFile.thumbnailPath, fullUrl: getFileUrl(logoFile), thumbnailUrl: getFileUrl(logoFile, true) } : null,
                createdAt: business.createdAt,
                owner: owner ? {
                    id: owner.id, fullName: owner.fullName, phone: owner.phone,
                    avatarUrl: ownerAvatar ? getFileUrl(ownerAvatar, true) : owner.avatarUrl,
                    avatarFile: ownerAvatar ? { id: ownerAvatar.id, path: ownerAvatar.path, thumbnailPath: ownerAvatar.thumbnailPath, fullUrl: getFileUrl(ownerAvatar), thumbnailUrl: getFileUrl(ownerAvatar, true) } : null,
                } : null,
                activities: business.activities?.map((a: any) => a.activity) || [],
            } : null,
        };
    }

    // ═══════════════════════════════════════
    // 7. تمدید آگهی
    // ═══════════════════════════════════════
    async extend(id: string, userId: string, dto: ExtendAdDto) {
        const ad = await this.prisma.ad.findUnique({
            where: { id },
            include: {
                business: { select: { ownerUserId: true } },
                arm: { select: { config: true } },
            },
        });

        if (!ad) throw new NotFoundException();
        if (ad.business.ownerUserId !== userId) throw new ForbiddenException();
        if (ad.status !== 'active' && ad.status !== 'expired' && ad.status !== 'inactive') {
            throw new BadRequestException('آگهی قابل تمدید نیست');
        }

        const config = ad.arm.config as any || {};
        const maxActiveAds = config.modules?.priceTable?.maxActiveAdsPerUser || 5;
        const bumpCostPerDay = config.economy?.bumpCost || 10;
        const defaultBumpHours = 24;

        let activationCost = 0;
        const activeAdsCount = await this.prisma.ad.count({
            where: { businessId: ad.businessId, status: 'active', expiresAt: { gt: new Date() }, id: { not: id } },
        });
        if (activeAdsCount >= maxActiveAds) activationCost = bumpCostPerDay;

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
                    userId, businessId: ad.businessId, armId: ad.armId,
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
                business: { select: { id: true, name: true, verificationTier: true, trustScore: true } },
            },
        });
    }

    // ═══════════════════════════════════════
    // 8-15: بقیه متدها بدون تغییر
    // ═══════════════════════════════════════
    async remove(id: string, userId: string) {
        const ad = await this.prisma.ad.findUnique({
            where: { id },
            include: { business: { select: { ownerUserId: true } } },
        });
        if (!ad) throw new NotFoundException({ errorCode: 'AD_NOT_FOUND', message: 'آگهی یافت نشد' });
        if (ad.business.ownerUserId !== userId) throw new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'شما اجازه حذف این آگهی را ندارید' });
        return this.prisma.ad.update({ where: { id }, data: { status: 'deleted', updatedAt: new Date() } });
    }

    async getPriceHistory(id: string, userId?: string) {
        const ad = await this.prisma.ad.findUnique({
            where: { id },
            select: { id: true, title: true, unitPrice: true, priceHistory: true, business: { select: { ownerUserId: true } } },
        });
        if (!ad) throw new NotFoundException({ errorCode: 'AD_NOT_FOUND', message: 'آگهی یافت نشد' });
        if (userId && ad.business?.ownerUserId === userId) {
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

    async getContactInfo(adId: string, userId: string) {
        const ad = await this.prisma.ad.findUnique({
            where: { id: adId },
            include: {
                arm: true,
                business: {
                    select: {
                        id: true,
                        phone: true,
                        name: true,
                        ownerUserId: true,
                        owner: {
                            select: { phone: true },
                        },
                    },
                },
            },
        });
        if (!ad) throw new NotFoundException({ errorCode: 'AD_NOT_FOUND', message: 'آگهی یافت نشد' });
        if (ad.status !== 'active') throw new BadRequestException({ errorCode: 'AD_NOT_ACTIVE', message: 'این آگهی فعال نیست' });

        const membership = await this.prisma.armMembership.findFirst({
            where: { armId: ad.armId, userId, status: 'active' },
        });
        if (!membership) throw new ForbiddenException({ errorCode: 'NOT_MEMBER', message: 'شما به این بازار نپیوسته اید.' });

        const config = ad.arm.config as any || {};
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

        await this.prisma.callEvent.create({
            data: { adId: ad.id, callerId: userId, initiatedAt: new Date(), source: 'direct' },
        });
        await this.prisma.ad.update({ where: { id: adId }, data: { callCount: { increment: 1 } } });

        return {
            businessName: ad.business.name,
            phone: ad.business.phone || ad.business.owner?.phone || null,
            ownerPhone: ad.business.owner?.phone || null,
            remainingCalls: dailyCallLimit - (callsToday + 1),
            dailyLimit: dailyCallLimit,
        };
    }

    async bulkUpdate(userId: string, updates: { id: string; unitPrice: number }[]) {
        if (!updates || updates.length === 0) throw new BadRequestException('هیچ آگهی ارسال نشده است.');
        const userBusinesses = await this.prisma.business.findMany({
            where: { ownerUserId: userId, status: 'active' },
            select: { id: true },
        });
        const businessIds = userBusinesses.map(b => b.id);

        const ads = await this.prisma.ad.findMany({
            where: { id: { in: updates.map(u => u.id) } },
            select: { id: true, businessId: true },
        });
        for (const ad of ads) {
            if (!businessIds.includes(ad.businessId)) {
                throw new ForbiddenException(`شما مالک آگهی ${ad.id} نیستید.`);
            }
        }

        const updatePromises = updates.map(update =>
            this.prisma.ad.update({
                where: { id: update.id },
                data: {
                    unitPrice: update.unitPrice,
                    updatedAt: new Date(),
                    priceHistory: { push: { price: update.unitPrice, updatedAt: new Date().toISOString(), note: 'ویرایش گروهی قیمت' } },
                },
                select: { id: true, unitPrice: true },
            })
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

        const config = ad.arm.config as any || {};
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
            where: {
                adId,
                userId,
                type: 'save',
            },
        });

        return { isSaved: !!saved };
    }


    async getAdStats(adId: string) {
        const interactions = await this.prisma.adInteraction.groupBy({ by: ['type'], where: { adId }, _count: true });
        const uniqueViews = await this.prisma.adInteraction.groupBy({
            by: ['userId'], where: { adId, type: 'view', userId: { not: null } }, _count: true,
        });

        const summary = {
            totalViews: interactions.find(i => i.type === 'view')?._count || 0,
            uniqueViews: uniqueViews.length,
            totalSaves: interactions.find(i => i.type === 'save')?._count || 0,
            totalCalls: interactions.find(i => i.type === 'call')?._count || 0,
            totalComments: interactions.find(i => i.type === 'comment')?._count || 0,
            totalShares: interactions.find(i => i.type === 'share')?._count || 0,
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

// ✅ متد جدید مخصوص کاتالوگ
    // src/ad/ad.service.ts

    async getCatalogAds(
        businessId: string,
        page: number = 1,
        limit: number = 100,
        search?: string,
    ) {
        const skip = (page - 1) * limit;

        const where: any = {
            businessId,
            status: { not: 'deleted' },
        };

        if (search) {
            where.OR = [
                { title: { contains: search, mode: 'insensitive' } },
                { productType: { contains: search, mode: 'insensitive' } },
            ];
        }

        const [ads, total] = await Promise.all([
            this.prisma.ad.findMany({
                where,
                include: {
                    unit: { select: { id: true, title: true, shortCode: true } },
                    arm: { select: { id: true, slug: true, name: true } },
                    files: {
                        select: { id: true, path: true, thumbnailPath: true, fieldKey: true },
                    },
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            this.prisma.ad.count({ where }),
        ]);

        // ✅ مطمئن شو path مستقیم برگردد
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

}