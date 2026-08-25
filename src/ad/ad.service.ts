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
import {  collectCategoryIdsFromTree,  flattenCategoryTree, findNodeInTree, } from '../common/utils/arm.utils';



@Injectable()
export class AdService {
    constructor(
        private prisma: PrismaService,
        private armService: ArmService,
        private creditService: CreditService,
    ) {}

    // ============================================================
    // ✅ متد کمکی برای خواندن مقدار از config با پیش‌فرض
    // ============================================================
    private getConfigValue<T>(config: any, path: string, defaultValue: T): T {
        const keys = path.split('.');
        let value = config;
        for (const key of keys) {
            if (value === undefined || value === null) return defaultValue;
            value = value[key];
        }
        return value !== undefined && value !== null ? value : defaultValue;
    }

    // ============================================================
    // 1. ثبت آگهی جدید (با مدیریت سهمیه رایگان و کسر اعتبار)
    // ============================================================


    async create(userId: string, dto: CreateAdDto) {
        // ۱. پیدا کردن بازار
        const arm = await this.armService.findBySlug(dto.armSlug);
        const config = arm.config as any || {};
        const categoryTree = (arm.categoryTree as any[]) || [];

        // ۲. پیدا کردن کسب‌وکار فعال کاربر
        const business = await this.prisma.business.findFirst({
            where: { ownerUserId: userId, status: 'active' },
        });
        if (!business) {
            throw new BadRequestException({
                errorCode: 'NO_ACTIVE_BUSINESS',
                message: 'ابتدا یک کسب‌وکار ثبت کنید',
            });
        }

        // ۳. بررسی پیوستن به بازار
        const membership = await this.prisma.armMembership.findFirst({
            where: { armId: arm.id, userId: userId, status: 'active' },
        });
        if (!membership) {
            throw new ForbiddenException({
                errorCode: 'NOT_MEMBER',
                message: 'شما به این بازار نپیوسته اید',
            });
        }

        // ============================================================
        // جلوگیری از آگهی تکراری با حداقل خرید یکسان در این بازار
        // ============================================================
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
                    message: 'شما قبلاً برای این آگهی با همین حداقل خرید قیمت ثبت کرده اید. حداقل خرید را تغییر دهید.',
                });
            }
        }

        // ============================================================
        // ۴. اعتبارسنجی با قوانین config
        // ============================================================

        // ۴-۱. انتشار ناشناس
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

        // ============================================================
        // ۴-۲. سهمیه‌ها (دو نوع محدودیت)
        // ============================================================

        // الف) سقف آگهی‌های فعال هم‌زمان روی تابلو
        const maxActiveAdsPerUser = this.getConfigValue(config, 'modules.priceTable.maxActiveAdsPerUser', 5);
        const activeAdsCount = await this.prisma.ad.count({
            where: {
                businessId: business.id,
                armId: arm.id,
                status: 'active',
                expiresAt: { gt: new Date() },
            },
        });
        const hasReachedActiveLimit = activeAdsCount >= maxActiveAdsPerUser;
        const freeActiveSlotsRemaining = Math.max(0, maxActiveAdsPerUser - activeAdsCount - 1);

        // ب) سقف کل آگهی‌های ثبت‌شده (بدون توجه به وضعیت)
        const maxTotalFreeAdPerUser = this.getConfigValue(config, 'modules.priceTable.maxTotalFreeAdPerUser', 50);
        const totalAdsCount = await this.prisma.ad.count({
            where: {
                businessId: business.id,
                armId: arm.id,
                status: { not: 'deleted' },
            },
        });
        const hasReachedTotalLimit = totalAdsCount >= maxTotalFreeAdPerUser;
        const freeTotalSlotsRemaining = Math.max(0, maxTotalFreeAdPerUser - totalAdsCount - 1);

        // آیا نیاز به کسر اعتبار است؟
        const needsCredit = hasReachedActiveLimit || hasReachedTotalLimit;

        // ۴-۳. مدت اعتبار
        const defaultValidityHours = this.getConfigValue(config, 'modules.priceTable.adValidityDefaultDays', 24);
        const validityHours = dto.validityHours || defaultValidityHours;

        // ۴-۴. نیاز به تایید در زمان ثبت
        const requiresApprovalOnCreate = this.getConfigValue(
            config,
            'modules.priceTable.approval.requiresApprovalOnCreate',
            false
        );

        // ✅ ۴-۵. اعتبارسنجی و محاسبه نردبان
        let bumpDurationHours: number | null = null;
        let bumpCostTotal = 0;
        let bumpExpiresAt: Date | null = null;

        if (dto.isBumped) {
            bumpDurationHours = dto.bumpDurationHours ?? 24;
            if (bumpDurationHours > validityHours) {
                throw new BadRequestException({
                    errorCode: 'BUMP_DURATION_EXCEEDS_VALIDITY',
                    message: `مدت نردبان (${bumpDurationHours} ساعت) نمی‌تواند از اعتبار قیمت (${validityHours} ساعت) بیشتر باشد.`,
                });
            }
            const baseCost = this.getConfigValue(config, 'modules.priceTable.bumpCost', 10);
            bumpCostTotal = (bumpDurationHours / 24) * baseCost;
            if (!requiresApprovalOnCreate) {
                bumpExpiresAt = new Date(Date.now() + bumpDurationHours * 60 * 60 * 1000);
            }
        }

        // ۴-۶. کسر اعتبار (در صورت نیاز)
        let creditDeducted = false;
        let totalCost = 0;
        if (needsCredit) {
            const adCost = this.getConfigValue(config, 'modules.priceTable.bumpCost', 10);
            totalCost += adCost;
        }
        if (dto.isBumped && !requiresApprovalOnCreate) {
            totalCost += bumpCostTotal;
        }

        if (totalCost > 0) {
            const balance = await this.creditService.getUserBalance(userId);
            if (balance.balance < totalCost) {
                throw new BadRequestException({
                    errorCode: 'INSUFFICIENT_CREDIT',
                    message: `اعتبار کافی نیست. برای ثبت آگهی خارج از سهمیه نیاز به ${totalCost} اعتبار دارید. موجودی: ${balance.balance}`,
                    data: { needed: totalCost, balance: balance.balance },
                });
            }
            await this.prisma.credit.create({
                data: {
                    userId, businessId: business.id, armId: arm.id,
                    amount: 0, currency: 'IRR', creditCount: -totalCost,
                    pricePerCredit: null, creditType: 'purchased',
                    transactionType: 'spend', status: 'success',
                    description: `ثبت آگهی${dto.isBumped ? ' و نردبان' : ''}`,
                    metadata: { ad_title: dto.title, cost: totalCost, arm_slug: arm.slug },
                },
            });
            creditDeducted = true;
        }

        // ============================================================
        // ۵. اعتبارسنجی دسته‌بندی
        // ============================================================
        if (!dto.categoryId && !dto.customCategoryId) {
            throw new BadRequestException({
                errorCode: 'CATEGORY_REQUIRED',
                message: 'حداقل یکی از categoryId یا customCategoryId باید مقدار داشته باشد.',
            });
        }
        if (dto.categoryId && dto.customCategoryId) {
            throw new BadRequestException({
                errorCode: 'BOTH_CATEGORIES_PROVIDED',
                message: 'فقط یکی از categoryId یا customCategoryId را مقداردهی کنید.',
            });
        }

        let categoryPath: string[] = [];

        if (dto.categoryId) {
            // ✅ اعتبارسنجی فقط از categoryTree
            const categoryIds = collectCategoryIdsFromTree(categoryTree);

            if (!categoryIds.has(dto.categoryId)) {
                throw new BadRequestException({
                    errorCode: 'CATEGORY_NOT_AVAILABLE_IN_ARM',
                    message: 'این دسته‌بندی برای بازاری فعلی فعال نیست.',
                });
            }

            const category = await this.prisma.productCategory.findUnique({
                where: { id: dto.categoryId },
                select: { path: true },
            });
            if (category) {
                const pathSlugs = category.path.split('.');
                const pathNodes = await this.prisma.productCategory.findMany({
                    where: { slug: { in: pathSlugs }, isActive: true },
                    select: { id: true, slug: true },
                });
                pathNodes.sort((a, b) => pathSlugs.indexOf(a.slug) - pathSlugs.indexOf(b.slug));
                categoryPath = pathNodes.map(n => n.id);
            }
        }

        if (dto.customCategoryId) {
            const customCategory = await this.prisma.customCategory.findFirst({
                where: { id: dto.customCategoryId, armId: arm.id, isActive: true },
                select: { path: true },
            });
            if (!customCategory) {
                throw new BadRequestException({
                    errorCode: 'CUSTOM_CATEGORY_NOT_FOUND',
                    message: 'گره اختصاصی یافت نشد.',
                });
            }
        }

        // ============================================================
        // ۶. پیدا کردن unitId
        // ============================================================
        let unitId = dto.unitId;
        if (!unitId && dto.categoryId) {
            const category = await this.prisma.productCategory.findUnique({
                where: { id: dto.categoryId },
                select: { defaultUnitId: true },
            });
            if (category?.defaultUnitId) unitId = category.defaultUnitId;
        }
        if (!unitId) {
            throw new BadRequestException({
                errorCode: 'UNIT_NOT_FOUND',
                message: 'واحد برای این دسته‌بندی یافت نشد.',
            });
        }

        // ============================================================
        // ۷. ساخت title
        // ============================================================
        let title = dto.title;
        if (!title && dto.categoryId) {
            const cat = await this.prisma.productCategory.findUnique({
                where: { id: dto.categoryId },
                select: { title: true },
            });
            title = cat?.title || '';
        }

        // ============================================================
        // ۸. اعتبارسنجی موجودی
        // ============================================================
        if (dto.availableQuantity !== null && dto.availableQuantity !== undefined) {
            if (dto.minQuantity > dto.availableQuantity) {
                throw new BadRequestException({
                    errorCode: 'MIN_QUANTITY_EXCEEDS_STOCK',
                    message: `حداقل حجم خرید (${dto.minQuantity}) نمی‌تواند از موجودی (${dto.availableQuantity}) بیشتر باشد.`,
                    data: { minQuantity: dto.minQuantity, availableQuantity: dto.availableQuantity },
                });
            }
        }

        // ============================================================
        // ۹. محاسبه expiresAt
        // ============================================================
        const expiresAt = new Date();
        expiresAt.setHours(validityHours, 0, 0, 0);
        expiresAt.setDate(expiresAt.getDate());

        // ✅ پیدا کردن categorySelection فقط از categoryTree
        const categorySelection = findNodeInTree(categoryTree, dto.categoryId);

        // ============================================================
        // ۱۰. ایجاد آگهی
        // ============================================================
        const ad = await this.prisma.ad.create({
            data: {
                armId: arm.id,
                businessId: business.id,
                createdByUserId: userId,
                categoryId: dto.categoryId || null,
                customCategoryId: dto.customCategoryId || null,
                unitId,
                title,
                productType: dto.productType || null,
                paymentMethods: (dto.paymentMethods as any) || null,
                specs: dto.specs || null,
                customFields: (dto.customFields as any) || {},
                description: dto.description || '',
                unitPrice: dto.unitPrice,
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
                categoryPath,
                unitQty: dto.unitQty || null,
                unitIsVariableQty: dto.unitIsVariableQty || false,
                unitBaseTitle: categorySelection?.baseUnitTitle || null,
            },
            include: {
                category: { select: { id: true, title: true, path: true } },
                customCategory: { select: { id: true, localTitle: true, path: true } },
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

    // ============================================================
    // 2. ویرایش آگهی - اصلاح شده با حذف فیلد images
    // ============================================================
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

        // ============================================================
        // ✅ ۱. اگر آگهی رد شده است (rejectionReason مقدار دارد)
        // ============================================================
        const isRejected = ad.status === 'rejected' && ad.rejectionReason && ad.rejectionReason.length > 0;

        if (isRejected) {
            updateData.status = 'pending';
            updateData.rejectionReason = null;
        }

        // ============================================================
        // ✅ ۲. اعتبارسنجی تغییر دسته‌بندی و واحد
        // ============================================================
        if (dto.categoryId !== undefined && dto.customCategoryId !== undefined) {
            throw new BadRequestException({
                errorCode: 'BOTH_CATEGORIES_PROVIDED',
                message: 'فقط یکی از categoryId یا customCategoryId را مقداردهی کنید.',
            });
        }

        if (dto.categoryId !== undefined && dto.categoryId !== ad.categoryId) {
            // ✅ اعتبارسنجی فقط از categoryTree
            const categoryIds = collectCategoryIdsFromTree(categoryTree);

            if (!categoryIds.has(dto.categoryId)) {
                throw new BadRequestException({
                    errorCode: 'CATEGORY_NOT_AVAILABLE_IN_ARM',
                    message: 'این دسته‌بندی برای بازاری فعلی فعال نیست.',
                });
            }

            let categoryPath: string[] = [];
            const category = await this.prisma.productCategory.findUnique({
                where: { id: dto.categoryId },
                select: { path: true },
            });
            if (category) {
                const pathSlugs = category.path.split('.');
                const pathNodes = await this.prisma.productCategory.findMany({
                    where: { slug: { in: pathSlugs }, isActive: true },
                    select: { id: true, slug: true },
                });
                pathNodes.sort((a, b) => pathSlugs.indexOf(a.slug) - pathSlugs.indexOf(b.slug));
                categoryPath = pathNodes.map(n => n.id);
            }
            updateData.categoryId = dto.categoryId;
            updateData.categoryPath = categoryPath;
            updateData.customCategoryId = null;

            // ✅ پیدا کردن categorySelection فقط از categoryTree
            const categorySelection = findNodeInTree(categoryTree, dto.categoryId);
            updateData.unitBaseTitle = categorySelection?.baseUnitTitle || null;
        }

        if (dto.customCategoryId !== undefined && dto.customCategoryId !== ad.customCategoryId) {
            const customCategory = await this.prisma.customCategory.findFirst({
                where: { id: dto.customCategoryId, armId: ad.armId, isActive: true },
                select: { id: true },
            });
            if (!customCategory) {
                throw new BadRequestException({
                    errorCode: 'CUSTOM_CATEGORY_NOT_FOUND',
                    message: 'گره اختصاصی یافت نشد.',
                });
            }
            updateData.customCategoryId = dto.customCategoryId;
            updateData.categoryId = null;
            updateData.categoryPath = [];
        }

        // اگر minQuantity تغییر کرده است
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
                    message: 'شما قبلاً برای این آگهی با همین حداقل خرید قیمت ثبت کرده اید. حداقل خرید را تغییر دهید.',
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
        if (dto.unitQty !== undefined) {
            updateData.unitQty = dto.unitQty;
        }
        if (dto.unitIsVariableQty !== undefined) {
            updateData.unitIsVariableQty = dto.unitIsVariableQty;
        }

        // ============================================================
        // ✅ ۳. بررسی نیاز به تایید مجدد (editApproval)
        // ============================================================
        let requiresReApproval = false;
        if (!isRejected) {
            const editApproval = config.modules?.priceTable?.approval?.editApproval;
            if (editApproval?.enabled === true) {
                const fieldsToCheck = editApproval.fields || {};
                const changedFields: string[] = [];
                if (fieldsToCheck.title && dto.title !== undefined && dto.title !== ad.title) changedFields.push('title');
                if (fieldsToCheck.description && dto.description !== undefined && dto.description !== ad.description) changedFields.push('description');
                if (fieldsToCheck.unitPrice && dto.unitPrice !== undefined && dto.unitPrice !== ad.unitPrice) changedFields.push('unitPrice');
                if (fieldsToCheck.minQuantity && dto.minQuantity !== undefined && dto.minQuantity !== ad.minQuantity) changedFields.push('minQuantity');
                if (fieldsToCheck.availableQuantity && dto.availableQuantity !== undefined && dto.availableQuantity !== ad.availableQuantity) changedFields.push('availableQuantity');
                if (fieldsToCheck.city && dto.city !== undefined && dto.city !== ad.city) changedFields.push('city');
                if (fieldsToCheck.isAnonymous && dto.isAnonymous !== undefined && dto.isAnonymous !== ad.isAnonymous) changedFields.push('isAnonymous');
                if (fieldsToCheck.productType && dto.productType !== undefined && dto.productType !== ad.productType) changedFields.push('productType');
                if (fieldsToCheck.categoryId && dto.categoryId !== undefined && dto.categoryId !== ad.categoryId) changedFields.push('categoryId');
                if (changedFields.length > 0) requiresReApproval = true;
            }
        }

        // ============================================================
        // ✅ ۴. اعتبارسنجی موجودی
        // ============================================================
        const newMinQuantity = dto.minQuantity !== undefined ? dto.minQuantity : ad.minQuantity;
        const newAvailableQuantity = dto.availableQuantity !== undefined ? dto.availableQuantity : ad.availableQuantity;
        if (newAvailableQuantity !== null && newAvailableQuantity !== undefined) {
            if (newMinQuantity > newAvailableQuantity) {
                throw new BadRequestException({
                    errorCode: 'MIN_QUANTITY_EXCEEDS_STOCK',
                    message: `حداقل حجم خرید (${newMinQuantity}) نمی‌تواند از موجودی انبار (${newAvailableQuantity}) بیشتر باشد.`,
                    data: { minQuantity: newMinQuantity, availableQuantity: newAvailableQuantity },
                });
            }
        }

        // ============================================================
        // ✅ ۵. مدیریت نردبان (Bump)
        // ============================================================
        const isBumpActive = ad.isBumped && ad.bumpExpiresAt && ad.bumpExpiresAt > new Date();

        if (isBumpActive) {
            if (dto.isBumped === true) {
                throw new BadRequestException({
                    errorCode: 'BUMP_ALREADY_ACTIVE',
                    message: `این آگهی تا تاریخ ${ad.bumpExpiresAt.toLocaleDateString('fa-IR')} در حال نردبان است. تا پایان آن صبر کنید.`,
                });
            }
            if (dto.bumpDurationHours !== undefined) {
                throw new BadRequestException({
                    errorCode: 'BUMP_DURATION_CHANGE_NOT_ALLOWED',
                    message: 'در حالی که نردبان فعال است، نمی‌توانید مدت آن را تغییر دهید.',
                });
            }
        }

        if (dto.isBumped !== undefined && dto.isBumped !== ad.isBumped) {
            if (dto.isBumped === true) {
                let bumpDurationHours = dto.bumpDurationHours ?? ad.bumpDurationHours ?? 24;
                const validityHours = dto.validityHours ?? ad.validityHours;
                if (bumpDurationHours > validityHours) {
                    throw new BadRequestException({
                        errorCode: 'BUMP_DURATION_EXCEEDS_VALIDITY',
                        message: `مدت نردبان (${bumpDurationHours} ساعت) نمی‌تواند از اعتبار قیمت (${validityHours} ساعت) بیشتر باشد.`,
                    });
                }
                const baseCost = config.economy?.bumpCost || 10;
                const bumpCostTotal = (bumpDurationHours / 24) * baseCost;

                if (ad.status === 'active') {
                    const balance = await this.creditService.getUserBalance(userId);
                    if (balance.balance < bumpCostTotal) {
                        throw new BadRequestException({
                            errorCode: 'INSUFFICIENT_CREDIT',
                            message: `اعتبار کافی نیست. برای نردبان به ${bumpCostTotal} اعتبار نیاز دارید.`,
                            data: { needed: bumpCostTotal, balance: balance.balance },
                        });
                    }
                    await this.prisma.credit.create({
                        data: {
                            userId, businessId: ad.businessId, armId: ad.armId,
                            amount: 0, currency: 'IRR', creditCount: -bumpCostTotal,
                            creditType: 'purchased', status: 'success',
                            transactionType: 'spend',
                            description: `نردبان آگهی "${ad.title}" (ویرایش)`,
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
        } else if (dto.bumpDurationHours !== undefined && !isBumpActive && ad.isBumped) {
            const newDuration = dto.bumpDurationHours;
            const validityHours = dto.validityHours ?? ad.validityHours;
            if (newDuration > validityHours) {
                throw new BadRequestException({
                    errorCode: 'BUMP_DURATION_EXCEEDS_VALIDITY',
                    message: `مدت نردبان (${newDuration} ساعت) نمی‌تواند از اعتبار قیمت (${validityHours} ساعت) بیشتر باشد.`,
                });
            }
            const baseCost = config.economy?.bumpCost || 10;
            const oldCost = (ad.bumpDurationHours / 24) * baseCost;
            const newCost = (newDuration / 24) * baseCost;
            const diff = newCost - oldCost;
            if (diff > 0 && ad.status === 'active') {
                const balance = await this.creditService.getUserBalance(userId);
                if (balance.balance < diff) {
                    throw new BadRequestException({
                        errorCode: 'INSUFFICIENT_CREDIT',
                        message: `برای افزایش مدت نردبان به ${diff} اعتبار اضافی نیاز دارید. موجودی: ${balance.balance}`,
                        data: { needed: diff, balance: balance.balance },
                    });
                }
                await this.prisma.credit.create({
                    data: {
                        userId, businessId: ad.businessId, armId: ad.armId,
                        amount: 0, currency: 'IRR', creditCount: -diff,
                        creditType: 'purchased', status: 'success',
                        transactionType: 'spend',
                        description: `افزایش مدت نردبان آگهی "${ad.title}"`,
                        metadata: { ad_id: id, cost: diff },
                    },
                });
            }
            if (ad.status === 'active') {
                const bumpExpiresAt = new Date(Date.now() + newDuration * 60 * 60 * 1000);
                updateData.bumpExpiresAt = bumpExpiresAt;
                updateData.lastBumpCreditsSpent = newCost;
            }
            updateData.bumpDurationHours = newDuration;
        }

        // ============================================================
        // ✅ ۶. فعال‌سازی آگهی (خارج از سهمیه)
        // ============================================================
        if (dto.status === 'active' && ad.status !== 'active') {
            const maxActiveAds = config.modules?.priceTable?.maxActiveAdsPerUser || 5;
            const bumpCost = config.economy?.bumpCost || 10;
            const activeAdsCount = await this.prisma.ad.count({
                where: { businessId: ad.businessId, status: 'active', expiresAt: { gt: new Date() }, id: { not: id } },
            });
            if (activeAdsCount >= maxActiveAds) {
                const balance = await this.creditService.getUserBalance(userId);
                if (balance.balance < bumpCost) {
                    throw new BadRequestException({
                        errorCode: 'INSUFFICIENT_CREDIT',
                        message: `اعتبار کافی نیست. برای فعال‌سازی به ${bumpCost} اعتبار نیاز دارید.`,
                        data: { needed: bumpCost, balance: balance.balance },
                    });
                }
                await this.prisma.credit.create({
                    data: {
                        userId, businessId: ad.businessId, armId: ad.armId,
                        amount: 0, currency: 'IRR', creditCount: -bumpCost,
                        creditType: 'purchased', status: 'success',
                        transactionType: 'spend',
                        description: `فعال‌سازی آگهی "${ad.title}" (خارج از سهمیه)`,
                        metadata: { ad_id: id, cost: bumpCost },
                    },
                });
            }
            if (ad.isBumped && !ad.bumpExpiresAt) {
                const bumpDurationHours = ad.bumpDurationHours ?? 24;
                const baseCost = config.economy?.bumpCost || 10;
                const bumpCostTotal = (bumpDurationHours / 24) * baseCost;
                const balance = await this.creditService.getUserBalance(userId);
                if (balance.balance < bumpCostTotal) {
                    throw new BadRequestException({
                        errorCode: 'INSUFFICIENT_CREDIT',
                        message: `برای فعال‌سازی نردبان به ${bumpCostTotal} اعتبار نیاز دارید. موجودی: ${balance.balance}`,
                        data: { needed: bumpCostTotal, balance: balance.balance },
                    });
                }
                await this.prisma.credit.create({
                    data: {
                        userId, businessId: ad.businessId, armId: ad.armId,
                        amount: 0, currency: 'IRR', creditCount: -bumpCostTotal,
                        creditType: 'purchased', status: 'success',
                        transactionType: 'spend',
                        description: `نردبان آگهی "${ad.title}" در زمان فعال‌سازی`,
                        metadata: { ad_id: id, cost: bumpCostTotal },
                    },
                });
                const bumpExpiresAt = new Date(Date.now() + bumpDurationHours * 60 * 60 * 1000);
                updateData.bumpExpiresAt = bumpExpiresAt;
                updateData.lastBumpCreditsSpent = bumpCostTotal;
            }
        }

        // ============================================================
        // ✅ ۷. به‌روزرسانی سایر فیلدها
        // ============================================================
        if (dto.status !== undefined) updateData.status = dto.status;
        if (dto.unitPrice !== undefined) updateData.unitPrice = dto.unitPrice;
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

        // ============================================================
        // ✅ ۸. تاریخچه قیمت و مدت اعتبار
        // ============================================================
        if (dto.unitPrice !== undefined && dto.unitPrice !== ad.unitPrice) {
            const history = (ad.priceHistory as any[]) || [];
            history.push({ price: dto.unitPrice, updatedAt: new Date().toISOString(), note: 'ویرایش قیمت' });
            updateData.priceHistory = history;
        }
        if (dto.validityHours !== undefined && dto.validityHours !== ad.validityHours) {
            const expiresAt = new Date();
            expiresAt.setHours(dto.validityHours, 0, 0, 0);
            expiresAt.setDate(expiresAt.getDate());
            updateData.validityHours = dto.validityHours;
            updateData.expiresAt = expiresAt;
        }

        // ============================================================
        // ✅ ۹. وضعیت نهایی آگهی
        // ============================================================
        if (!isRejected && requiresReApproval && ad.status === 'active') {
            updateData.status = 'pending';
        }

        updateData.updatedAt = new Date();

        // ============================================================
        // ✅ ۱۰. ذخیره و بازگردانی
        // ============================================================
        return this.prisma.ad.update({
            where: { id },
            data: updateData,
            include: {
                category: { select: { id: true, title: true, path: true } },
                customCategory: { select: { id: true, localTitle: true, path: true } },
                unit: { select: { id: true, title: true, shortCode: true } },
                business: { select: { id: true, name: true, verificationTier: true, trustScore: true } },
            },
        });
    }

    // ============================================================
    // 3. تابلوی قیمت (ویترین زنده)
    // ============================================================



    async getVitrine(armSlug: string, query: AdListQueryDto) {
        // ✅ ۱. دریافت id و config و categoryTree بازار
        const arm = await this.prisma.arm.findUnique({
            where: { slug: armSlug },
            select: {
                id: true,
                config: true,
                categoryTree: true,
            },
        });

        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازار یافت نشد',
            });
        }

        // ✅ ساخت لیست فلت از categoryTree
        const flatCategory = flattenCategoryTree(arm.categoryTree);

        // ✅ ساخت Map برای دسترسی سریع
        const categoryMap = new Map(
            flatCategory.map((s: any) => [s.categoryId, s])
        );

        const page = query.page || 1;
        const limit = query.limit || 20;
        const skip = (page - 1) * limit;

        const where: any = {
            armId: arm.id,
            status: 'active',
            expiresAt: { gt: new Date() },
        };

        const orderBy: any[] = [{ isBumped: 'desc' }, { updatedAt: 'desc' }];

        const [ads, total] = await Promise.all([
            this.prisma.ad.findMany({
                where,
                orderBy,
                skip,
                take: limit,
                select: {
                    id: true,
                    productType: true,
                    unitPrice: true,
                    minQuantity: true,
                    availableQuantity: true,
                    city: true,
                    isBumped: true,
                    unitQty: true,
                    unitIsVariableQty: true,
                    unitBaseTitle: true,
                    categoryId: true,
                    isAnonymous: true,
                    updatedAt: true,
                    unit: {
                        select: { shortCode: true, title: true },
                    },
                    category: {
                        select: { id: true, title: true, path: true },
                    },
                    business: {
                        select: {
                            name: true,
                            verificationTier: true,
                            type: true,
                            city: true,
                            phone: true,
                        },
                    },
                    files: {
                        where: { relatedModel: 'Ad' },
                        select: { thumbnailPath: true },
                        take: 1,
                    },
                },
            }),
            this.prisma.ad.count({ where }),
        ]);

        // ✅ جایگزینی category.title با customLabel
        const adsWithCustomLabel = ads.map(ad => {
            const selection = categoryMap.get(ad.categoryId) as any | undefined;

            if (selection?.customLabel && ad.category) {
                ad.category = {
                    ...ad.category,
                    title: selection.customLabel,
                };
            }

            return {
                ...ad,
                unitBaseTitle: selection?.baseUnitTitle || ad.unitBaseTitle || null,
            };
        });

        return {
            ads: adsWithCustomLabel,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    // ============================================================
    // 4. نردبان (Bump)
    // ============================================================
    async bump(id: string, userId: string) {
        console.log('🚀 bump() called with:', { id, userId });
        const ad = await this.prisma.ad.findUnique({
            where: { id },
            include: {
                arm: true,
                business: { select: { ownerUserId: true, id: true } },
            },
        });

        if (!ad) {
            throw new NotFoundException({
                errorCode: 'AD_NOT_FOUND',
                message: 'آگهی یافت نشد',
            });
        }

        if (ad.business.ownerUserId !== userId) {
            throw new ForbiddenException({
                errorCode: 'FORBIDDEN',
                message: 'شما اجازه نردبان این آگهی را ندارید',
            });
        }

        if (ad.status !== 'active') {
            throw new BadRequestException({
                errorCode: 'AD_NOT_ACTIVE',
                message: 'فقط آگهی‌های فعال قابل نردبان هستند',
            });
        }

        // ✅ هزینه نردبان از config
        const config = ad.arm.config as any || {};
        const bumpCost = this.getConfigValue(config, 'economy.bumpCost', 10);

        // ✅ بررسی موجودی اعتبار کاربر
        const balance = await this.creditService.getUserBalance(userId);
        if (balance.balance < bumpCost) {
            throw new BadRequestException({
                errorCode: 'INSUFFICIENT_CREDIT',
                message: `اعتبار کافی برای نردبان ندارید. نیاز به ${bumpCost} اعتبار دارید. موجودی شما: ${balance.balance}`,
                data: {
                    needed: bumpCost,
                    balance: balance.balance,
                },
            });
        }

        // ✅ ثبت تراکنش کسر اعتبار (با فیلدهای جدید)
        await this.prisma.credit.create({
            data: {
                userId: userId,
                businessId: ad.businessId,
                armId: ad.armId,
                amount: 0,
                currency: 'IRR',
                creditCount: -bumpCost,
                pricePerCredit: null,
                creditType: 'purchased',
                transactionType: 'spend',
                description: `نردبان آگهی "${ad.title}" در بازار ${ad.arm.name}`,
                relatedEntityId: ad.id,
                relatedEntityType: 'Ad',
                metadata: {
                    ad_title: ad.title,
                    cost: bumpCost,
                    previous_bump_count: ad.bumpCount,
                    arm_name: ad.arm.name,
                    arm_slug: ad.arm.slug,
                },
            },
        });

        const bumpExpiresAt = new Date();
        bumpExpiresAt.setDate(bumpExpiresAt.getDate() + 1);

        return this.prisma.ad.update({
            where: { id },
            data: {
                isBumped: true,
                bumpExpiresAt: bumpExpiresAt,
                bumpCount: { increment: 1 },
                lastBumpedAt: new Date(),
                lastBumpCreditsSpent: bumpCost,
                updatedAt: new Date(),
            },
            include: {
                business: {
                    select: {
                        id: true,
                        name: true,
                        verificationTier: true,
                    },
                },
            },
        });
    }

    // ============================================================
    // 5. لیست آگهی‌های یک کسب‌وکار (عمومی)
    // ============================================================
    async getBusinessAds(businessId: string) {
        return this.prisma.ad.findMany({
            where: {
                businessId,
                status: { not: 'deleted' },
                expiresAt: { gt: new Date() },
            },
            include: {
                category: { select: { id: true, title: true, path: true } },
                customCategory: { select: { id: true, localTitle: true, path: true } },
                unit: { select: { id: true, title: true, shortCode: true } },
                arm: { select: { id: true, slug: true, name: true } },
                files: {
                    where: { relatedModel: 'Ad' },
                    select: {
                        id: true,
                        path: true,
                        thumbnailPath: true,
                        fieldKey: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
    }

    // ============================================================
    // 6. دریافت کامل آگهی با تمام اطلاعات مرتبط (برای صفحه جزئیات)
    // ============================================================


    async findOne(id: string) {
        // ✅ فقط فیلدهای ضروری را برگردان
        const ad = await this.prisma.ad.findUnique({
            where: { id },
            select: {
                id: true,
                title: true,
                productType: true,
                unitPrice: true,
                minQuantity: true,
                availableQuantity: true,
                city: true,
                province: true,
                isBumped: true,
                isAnonymous: true,
                description: true,
                updatedAt: true,
                createdAt: true,
                expiresAt: true,
                viewCount: true,
                callCount: true,
                category: { select: { id: true, title: true, path: true } },
                unit: { select: { id: true, title: true, shortCode: true } },
                unitQty: true,
                unitIsVariableQty: true,
                unitBaseTitle: true,
                business: {
                    select: {
                        id: true,
                        name: true,
                        shortDescription: true,
                        description: true,
                        type: true,
                        city: true,
                        province: true,
                        phone: true,
                        website: true,
                        verificationTier: true,
                        trustScore: true,
                        logoUrl: true,
                        createdAt: true,
                        // ✅ اضافه کردن فایل‌های لوگو
                        files: {
                            where: { fieldKey: 'logo' },
                            select: { id: true, path: true, thumbnailPath: true },
                            take: 1,
                        },
                        owner: {
                            select: {
                                id: true,
                                fullName: true,
                                phone: true,
                                avatarUrl: true,
                                files: {
                                    where: { fieldKey: 'avatar' },
                                    select: { id: true, path: true, thumbnailPath: true },
                                    take: 1,
                                },
                            },
                        },
                        activities: {
                            select: {
                                activity: {
                                    select: { id: true, title: true },
                                },
                            },
                            take: 10,
                        },
                    },
                },
                files: {
                    where: { relatedModel: 'Ad' },
                    select: { id: true, path: true, thumbnailPath: true, fieldKey: true },
                },
            },
        });

        if (!ad) {
            throw new NotFoundException({
                errorCode: 'AD_NOT_FOUND',
                message: 'آگهی یافت نشد',
            });
        }

        // ✅ افزایش بازدید به صورت غیرهمزمان (بدون منتظر ماندن)
        this.prisma.ad.update({
            where: { id },
            data: { viewCount: { increment: 1 } },
        }).catch(() => {});

        // ✅ ساختاردهی ساده‌تر
        const business = ad.business;
        const owner = business?.owner;
        const ownerAvatar = owner?.files?.[0];
        const logoFile = business?.files?.[0];

        // ✅ ساخت URL کامل برای لوگو و آواتار
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
                province: business.province,
                phone: business.phone,
                website: business.website,
                verificationTier: business.verificationTier,
                trustScore: business.trustScore,
                // ✅ اگر فایل لوگو وجود دارد، URL کامل بساز
                logoUrl: logoFile ? getFileUrl(logoFile, true) : business.logoUrl,
                logoFile: logoFile ? {
                    id: logoFile.id,
                    path: logoFile.path,
                    thumbnailPath: logoFile.thumbnailPath,
                    fullUrl: getFileUrl(logoFile),
                    thumbnailUrl: getFileUrl(logoFile, true),
                } : null,
                createdAt: business.createdAt,
                owner: owner ? {
                    id: owner.id,
                    fullName: owner.fullName,
                    phone: owner.phone,
                    avatarUrl: ownerAvatar ? getFileUrl(ownerAvatar, true) : owner.avatarUrl,
                    avatarFile: ownerAvatar ? {
                        id: ownerAvatar.id,
                        path: ownerAvatar.path,
                        thumbnailPath: ownerAvatar.thumbnailPath,
                        fullUrl: getFileUrl(ownerAvatar),
                        thumbnailUrl: getFileUrl(ownerAvatar, true),
                    } : null,
                } : null,
                activities: business.activities?.map((a: any) => a.activity) || [],
            } : null,
        };
    }

    // ============================================================
// 7. تمدید آگهی (با همان قیمت) - اصلاح‌شده با اعتبارسنجی سهمیه و اعتبار
// ============================================================

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

        // ۱. محاسبه هزینه فعال‌سازی (در صورت پر بودن سهمیه)
        let activationCost = 0;
        const activeAdsCount = await this.prisma.ad.count({
            where: {
                businessId: ad.businessId,
                status: 'active',
                expiresAt: { gt: new Date() },
                id: { not: id },
            },
        });

        if (activeAdsCount >= maxActiveAds) {
            activationCost = bumpCostPerDay;
        }

        // ۲. محاسبه هزینه نردبان (در صورت فعال بودن)
        let bumpCost = 0;
        let bumpDurationHours = 0;
        let bumpExpiresAt: Date | null = null;

        if (dto.isBumped) {
            bumpDurationHours = dto.bumpDurationHours ?? defaultBumpHours;
            bumpCost = (bumpDurationHours / 24) * bumpCostPerDay;
            bumpExpiresAt = new Date(Date.now() + bumpDurationHours * 60 * 60 * 1000);
        }

        const totalCost = activationCost + bumpCost;

        // ۳. کسر اعتبار
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
                    businessId: ad.businessId,
                    armId: ad.armId,
                    amount: 0,
                    currency: 'IRR',
                    creditCount: -totalCost,
                    creditType: 'purchased',
                    status: 'success',
                    transactionType: 'spend',
                    description: `تمدید آگهی "${ad.title}"${dto.isBumped ? ' + نردبان' : ''}`,
                    metadata: {
                        ad_id: id,
                        activationCost,
                        bumpCost,
                        bumpDurationHours,
                    },
                },
            });
        }

        // ۴. به‌روزرسانی آگهی
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
                bumpExpiresAt: bumpExpiresAt,
                bumpDurationHours: dto.isBumped ? bumpDurationHours : null,
                bumpCount: dto.isBumped ? { increment: 1 } : undefined,
                lastBumpedAt: dto.isBumped ? new Date() : undefined,
                lastBumpCreditsSpent: dto.isBumped ? bumpCost : undefined,
            },
            include: {
                category: { select: { id: true, title: true, path: true } },
                unit: { select: { id: true, title: true, shortCode: true } },
                business: { select: { id: true, name: true, verificationTier: true, trustScore: true } },
            },
        });
    }

    // ============================================================
    // 8. حذف آگهی (soft delete)
    // ============================================================
    async remove(id: string, userId: string) {
        const ad = await this.prisma.ad.findUnique({
            where: { id },
            include: {
                business: { select: { ownerUserId: true } },
            },
        });

        if (!ad) {
            throw new NotFoundException({
                errorCode: 'AD_NOT_FOUND',
                message: 'آگهی یافت نشد',
            });
        }

        if (ad.business.ownerUserId !== userId) {
            throw new ForbiddenException({
                errorCode: 'FORBIDDEN',
                message: 'شما اجازه حذف این آگهی را ندارید',
            });
        }

        return this.prisma.ad.update({
            where: { id },
            data: {
                status: 'deleted',
                updatedAt: new Date(),
            },
        });
    }

    // ============================================================
    // 9. دریافت تاریخچه قیمت یک آگهی
    // ============================================================
    async getPriceHistory(id: string, userId?: string) {
        const ad = await this.prisma.ad.findUnique({
            where: { id },
            select: {
                id: true,
                title: true,
                unitPrice: true,
                priceHistory: true,
                business: {
                    select: { ownerUserId: true },
                },
            },
        });

        if (!ad) {
            throw new NotFoundException({
                errorCode: 'AD_NOT_FOUND',
                message: 'آگهی یافت نشد',
            });
        }

        // اگر کاربر لاگین است و مالک آگهی است، تاریخچه کامل را نشان بده
        if (userId && ad.business?.ownerUserId === userId) {
            return {
                currentPrice: ad.unitPrice,
                history: ad.priceHistory || [],
            };
        }

        // برای سایر کاربران، فقط ۵ تغییر آخر را نشان بده
        const history = (ad.priceHistory as any[]) || [];
        return {
            currentPrice: ad.unitPrice,
            history: history.slice(-5),
        };
    }

    // ============================================================
    // 10. Cron Job: منقضی کردن آگهی‌ها
    // ============================================================
    async expireAds() {
        const expired = await this.prisma.ad.updateMany({
            where: {
                status: 'active',
                expiresAt: { lt: new Date() },
            },
            data: {
                status: 'expired',
                isBumped: false,
                updatedAt: new Date(),
            },
        });

        return { expiredCount: expired.count };
    }

    // ============================================================
    // 11. Cron Job: منقضی کردن نردبان
    // ============================================================
    async expireBumps() {
        const expired = await this.prisma.ad.updateMany({
            where: {
                status: 'active',
                isBumped: true,
                bumpExpiresAt: { lt: new Date() },
            },
            data: {
                isBumped: false,
                updatedAt: new Date(),
            },
        });

        return { expiredCount: expired.count };
    }

    // ============================================================
    // 12. دریافت شماره تماس آگهی (با محدودیت روزانه)
    // ============================================================
    async getContactInfo(adId: string, userId: string) {
        // ۱. پیدا کردن آگهی
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
                    },
                },
            },
        });

        if (!ad) {
            throw new NotFoundException({
                errorCode: 'AD_NOT_FOUND',
                message: 'آگهی یافت نشد',
            });
        }

        if (ad.status !== 'active') {
            throw new BadRequestException({
                errorCode: 'AD_NOT_ACTIVE',
                message: 'این آگهی فعال نیست',
            });
        }

        // . بررسی پیوستن به بازار توسط کاربر
        const membership = await this.prisma.armMembership.findFirst({
            where: {
                armId: ad.armId,
                userId: userId,
                status: 'active',
            },
        });

        if (!membership) {
            throw new ForbiddenException({
                errorCode: 'NOT_MEMBER',
                message: 'شما به این بازار نپیوسته اید.',
            });
        }

        // ۳. بررسی محدودیت روزانه (از config بازار یا پیش‌فرض ۲۰)
        const config = ad.arm.config as any || {};
        const dailyCallLimit = config.features?.dailyCallLimit || 20;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const callsToday = await this.prisma.callEvent.count({
            where: {
                callerId: userId,
                initiatedAt: { gte: today },
            },
        });

        if (callsToday >= dailyCallLimit) {
            throw new BadRequestException({
                errorCode: 'DAILY_CALL_LIMIT_EXCEEDED',
                message: `شما امروز ${callsToday} تماس گرفته‌اید. سقف تماس روزانه ${dailyCallLimit} است.`,
            });
        }

        // ✅ ۴. ثبت تماس در CallEvent (اصلاح شده)
        await this.prisma.callEvent.create({
            data: {
                adId: ad.id,           // ✅ فقط adId
                callerId: userId,      // ✅ فقط callerId
                initiatedAt: new Date(),
                source: 'direct',
            },
        });

        // ۵. افزایش شمارنده تماس آگهی
        await this.prisma.ad.update({
            where: { id: adId },
            data: { callCount: { increment: 1 } },
        });

        // ۶. بازگرداندن شماره تماس
        return {
            businessName: ad.business.name,
            phone: ad.business.phone,
            remainingCalls: dailyCallLimit - (callsToday + 1),
            dailyLimit: dailyCallLimit,
        };
    }

    // ============================================================
    // 13. به‌روزرسانی گروهی قیمت آگهی‌ها
    // ============================================================
    async bulkUpdate(userId: string, updates: { id: string; unitPrice: number }[]) {
        if (!updates || updates.length === 0) {
            throw new BadRequestException('هیچ آگهی برای به‌روزرسانی ارسال نشده است.');
        }

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
                throw new ForbiddenException(`شما مالک آگهی با شناسه ${ad.id} نیستید.`);
            }
        }

        const updatePromises = updates.map(update =>
            this.prisma.ad.update({
                where: { id: update.id },
                data: {
                    unitPrice: update.unitPrice,
                    updatedAt: new Date(),
                    priceHistory: {
                        push: {
                            price: update.unitPrice,
                            updatedAt: new Date().toISOString(),
                            note: 'ویرایش گروهی قیمت',
                        },
                    },
                },
                select: { id: true, unitPrice: true },
            })
        );

        const results = await this.prisma.$transaction(updatePromises);
        return { message: `${results.length} آگهی با موفقیت به‌روزرسانی شد`, updatedAds: results };
    }

    // ============================================================
    // 14. ثبت تعامل (بازدید، ذخیره، تماس، کامنت، اشتراک)
    // ============================================================
    // src/ad/ad.service.ts – متد trackInteraction (نسخه بهبودیافته)

    // src/ad/ad.service.ts – متد trackInteraction (نسخه نهایی)

    async trackInteraction(
        adId: string,
        userId: string | null,
        type: 'view' | 'save' | 'call' | 'comment' | 'share',
        metadata?: any,
    ) {
        try {
            const ad = await this.prisma.ad.findUnique({
                where: { id: adId },
                include: { arm: { select: { config: true } } },
            });

            if (!ad) {
                throw new NotFoundException({
                    errorCode: 'AD_NOT_FOUND',
                    message: 'آگهی یافت نشد',
                });
            }

            const config = ad.arm.config as any || {};
            const interactionCost = config.economy?.interactionCosts || {};
            const cost = interactionCost[type] || 0;

            // ✅ جلوگیری از ثبت تکراری در ۱۰ ثانیه‌ی اخیر
            const now = new Date();
            const recentThreshold = new Date(now.getTime() - 10 * 1000); // 10 ثانیه قبل

            const existingRecent = await this.prisma.adInteraction.findFirst({
                where: {
                    adId,
                    type,
                    createdAt: { gte: recentThreshold },
                    ...(userId ? { userId } : { sessionId: metadata?.sessionId }),
                },
            });

            if (existingRecent) {
                return { success: false, message: 'لطفاً چند ثانیه صبر کنید و دوباره تلاش کنید' };
            }

            // کسر اعتبار (اگر هزینه > 0 و کاربر لاگین باشد)
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
                        userId,
                        amount: 0,
                        currency: 'IRR',
                        creditCount: -cost,
                        creditType: 'purchased',
                        transactionType: 'spend',
                        status: 'success',
                        description: `هزینه ${type} آگهی "${ad.title}"`,
                        relatedEntityId: adId,
                        relatedEntityType: 'AdInteraction',
                        metadata: {
                            type,
                            cost,
                            ad_id: adId,
                        },
                    },
                });
            }

            // ثبت تعامل
            const interaction = await this.prisma.adInteraction.create({
                data: {
                    adId,
                    userId: userId || null,
                    type,
                    metadata,
                    ipAddress: metadata?.ipAddress,
                    userAgent: metadata?.userAgent,
                    sessionId: metadata?.sessionId,
                },
            });

            // به‌روزرسانی شمارنده‌های آگهی
            if (type === 'view') {
                await this.prisma.ad.update({
                    where: { id: adId },
                    data: { viewCount: { increment: 1 } },
                });
            } else if (type === 'call') {
                await this.prisma.ad.update({
                    where: { id: adId },
                    data: { callCount: { increment: 1 } },
                });
            }

            return { success: true, interaction, cost };
        } catch (error) {
            console.error('❌ trackInteraction error:', error);
            throw error;
        }
    }

    // ============================================================
    // 15. متد دریافت آمار تعاملات (نسخه کامل شده با جزئیات)
    // ============================================================
    async getAdStats(adId: string) {
        // 1. خلاصه آمار (همان قبلی)
        const interactions = await this.prisma.adInteraction.groupBy({
            by: ['type'],
            where: { adId },
            _count: true,
        });

        const uniqueViews = await this.prisma.adInteraction.groupBy({
            by: ['userId'],
            where: {
                adId,
                type: 'view',
                userId: { not: null },
            },
            _count: true,
        });

        const summary = {
            totalViews: interactions.find(i => i.type === 'view')?._count || 0,
            uniqueViews: uniqueViews.length,
            totalSaves: interactions.find(i => i.type === 'save')?._count || 0,
            totalCalls: interactions.find(i => i.type === 'call')?._count || 0,
            totalComments: interactions.find(i => i.type === 'comment')?._count || 0,
            totalShares: interactions.find(i => i.type === 'share')?._count || 0,
        };

        // 2. جزئیات تعاملات (لیست کاربران)
        const interactionList = await this.prisma.adInteraction.findMany({
            where: { adId },
            include: {
                user: {
                    select: {
                        id: true,
                        fullName: true,
                        phone: true,
                        avatarUrl: true,
                    },
                },
            },
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

        const details = {
            views: grouped.view || [],
            saves: grouped.save || [],
            calls: grouped.call || [],
            comments: grouped.comment || [],
            shares: grouped.share || [],
        };

        return { summary, details };
    }


}
