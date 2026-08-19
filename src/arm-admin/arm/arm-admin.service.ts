// src/arm-admin/arm/arm-admin.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ArmAdminService {
    constructor(private prisma: PrismaService) {}

    // ============================================================
    // دریافت اطلاعات کامل بازار با آمار
    // ============================================================
    async getArmWithStats(slug: string) {
        const arm = await this.prisma.arm.findUnique({
            where: { slug },
            include: {
                owner: {
                    select: {
                        id: true,
                        fullName: true,
                        phone: true,
                    },
                },
                _count: {
                    select: {
                        memberships: { where: { status: 'active' } },
                        ads: { where: { status: 'active' } },
                    },
                },
            },
        });

        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازار یافت نشد',
            });
        }

        return arm;
    }

    // ============================================================
    // دریافت آمار بازار
    // ============================================================


    async getArmStats(slug: string) {
        const arm = await this.prisma.arm.findUnique({
            where: { slug },
            select: { id: true },
        });

        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازار یافت نشد',
            });
        }

        const armId = arm.id;

        // ۱. آمار اعضا
        const [totalMembers, activeMembers, pendingMembers] = await Promise.all([
            this.prisma.armMembership.count({ where: { armId, status: { not: 'banned' } } }),
            this.prisma.armMembership.count({ where: { armId, status: 'active' } }),
            this.prisma.armMembership.count({ where: { armId, status: 'pending' } }),
        ]);

        // ۲. آمار آگهی‌ها
        const [totalAds, activeAds, pendingAds, rejectedAds, expiredAds] = await Promise.all([
            this.prisma.ad.count({ where: { armId, status: { not: 'deleted' } } }),
            this.prisma.ad.count({ where: { armId, status: 'active', expiresAt: { gt: new Date() } } }),
            this.prisma.ad.count({ where: { armId, status: 'pending' } }),
            this.prisma.ad.count({ where: { armId, status: 'rejected' } }),
            this.prisma.ad.count({ where: { armId, status: 'expired' } }),
        ]);

        // ۳. آمار مالی
        const [pendingPayments, totalCreditsIncome] = await Promise.all([
            this.prisma.creditRequest.count({ where: { armId, status: 'pending' } }),
            this.prisma.credit.aggregate({
                where: { armId, transactionType: 'purchase', status: 'success' },
                _sum: { amount: true },
            }),
        ]);

        return {
            // اعضا
            totalMembers,
            activeMembers,
            pendingMembers,

            // آگهی‌ها
            totalAds,
            activeAds,
            pendingAds,      // ✅ تعداد آگهی‌های در انتظار تایید
            rejectedAds,
            expiredAds,

            // مالی
            pendingPayments, // ✅ تعداد فیش‌های در انتظار
            totalCreditsIncome: totalCreditsIncome._sum.amount || 0,
        };
    }

    // ============================================================
    // دریافت لیست فیش‌های در انتظار
    // ============================================================
    async getPendingPayments(slug: string) {
        const arm = await this.prisma.arm.findUnique({
            where: { slug },
            select: { id: true },
        });

        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازار یافت نشد',
            });
        }

        return this.prisma.creditRequest.findMany({
            where: {
                armId: arm.id,
                status: 'pending',
            },
            include: {
                user: {
                    select: {
                        id: true,
                        fullName: true,
                        phone: true,
                    },
                },
                business: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
        });
    }

    // ============================================================
    // تأیید فیش
    // ============================================================

    async approvePayment(slug: string, paymentId: string, userId: string) {
        const arm = await this.prisma.arm.findUnique({
            where: { slug },
            select: { id: true, config: true },
        });

        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازار یافت نشد',
            });
        }

        const payment = await this.prisma.creditRequest.findFirst({
            where: {
                id: paymentId,
                armId: arm.id,
                status: 'pending',
            },
        });

        if (!payment) {
            throw new NotFoundException({
                errorCode: 'PAYMENT_NOT_FOUND',
                message: 'فیش یافت نشد یا قبلاً بررسی شده است',
            });
        }

        const armConfig = arm.config as any || {};
        const currency = armConfig.modules?.priceTable?.currency || armConfig.economy?.currency || 'IRR';
        const currencySymbol = {
            'IRR': 'تومان',
            'IRR1': 'ریال',
            'USD': 'دلار',
            'EUR': 'یورو',
            'BTC': 'بیت‌کوین',
        }[currency] || 'تومان';

        const metadata = payment.metadata as any || {};
        const creditCount = metadata.creditCount || Math.floor(payment.amount / 2000);
        const creditPrice = metadata.creditPrice || 2000;

        return this.prisma.$transaction(async (prisma) => {
            // ۱. به‌روزرسانی درخواست به approved
            const updatedPayment = await prisma.creditRequest.update({
                where: { id: paymentId },
                data: {
                    status: 'approved',
                    verifiedBy: userId,
                    verifiedAt: new Date(),
                },
            });

            // ۲. ✅ واریز اعتبار با status: 'success'
            await prisma.credit.create({
                data: {
                    userId: payment.userId,
                    businessId: payment.businessId,
                    armId: payment.armId ?? null,
                    amount: payment.amount,
                    currency: currency,
                    creditCount: creditCount,
                    pricePerCredit: creditPrice,
                    creditType: 'purchased',
                    status: 'success',  // ✅ اینجا باید success باشه
                    transactionType: 'purchase',
                    description: `خرید ${creditCount} اعتبار (${creditPrice.toLocaleString()} ${currencySymbol} هر اعتبار) `,
                    relatedEntityId: paymentId,
                    relatedEntityType: 'CreditRequest',
                    metadata: {
                        payment_id: paymentId,
                        verified_by: userId,
                        verified_at: new Date().toISOString(),
                        product_type: 'credit',
                        paymentMethod: 'manual',
                        currency: currency,
                        currencySymbol: currencySymbol,
                        creditCount: creditCount,
                        creditPrice: creditPrice,
                    },
                },
            });

            return updatedPayment;
        });
    }

    // ============================================================
    // رد فیش
    // ============================================================
    // src/arm-admin/arm/arm-admin.service.ts - rejectPayment

    async rejectPayment(slug: string, paymentId: string, userId: string, reason: string) {
        const arm = await this.prisma.arm.findUnique({
            where: { slug },
            select: { id: true },
        });

        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازار یافت نشد',
            });
        }

        const payment = await this.prisma.creditRequest.findFirst({
            where: {
                id: paymentId,
                armId: arm.id,
                status: 'pending',
            },
        });

        if (!payment) {
            throw new NotFoundException({
                errorCode: 'PAYMENT_NOT_FOUND',
                message: 'فیش یافت نشد یا قبلاً بررسی شده است',
            });
        }

        // ✅ فقط وضعیت درخواست رو به rejected تغییر بده (بدون واریز اعتبار)
        return this.prisma.creditRequest.update({
            where: { id: paymentId },
            data: {
                status: 'rejected',
                verifiedBy: userId,
                verifiedAt: new Date(),
                rejectReason: reason,
            },
        });
    }

    // ============================================================
    // دریافت تنظیمات بازار
    // ============================================================
    async getArmSettings(slug: string) {
        const arm = await this.prisma.arm.findUnique({
            where: { slug },
            select: {
                id: true,
                slug: true,
                name: true,
                slogan: true,
                description: true,
                icon: true,
                colorPrimary: true,
                colorSecondary: true,
                logoUrl: true,
                bannerUrl: true,
                mission: true,
                config: true,
            },
        });

        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازار یافت نشد',
            });
        }

        const config = arm.config as any || {};

        return {
            ...arm,
            config: {
                appearance: config.appearance || {},
                features: config.features || {},
                economy: {
                    currency: config.economy?.currency || 'IRR',
                    bumpCost: config.economy?.bumpCost || 10,
                    creditPrice: config.economy?.creditPrice || 2000,
                },
                payment: {
                    paymentMode: config.payment?.paymentMode || 'both',
                    manual: config.payment?.manual || { enabled: false },
                },
            },
        };
    }


    // ============================================================
    // ✅ به‌روزرسانی کامل تنظیمات بازار (برای مدیر بازار)
    // ============================================================
    // src/arm-admin/arm/arm-admin.service.ts

    async updateArmSettings(slug: string, data: any) {
        const arm = await this.prisma.arm.findUnique({
            where: { slug },
            select: { id: true, config: true },
        });

        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازار یافت نشد',
            });
        }

        // ✅ ادغام هوشمندانه
        const currentConfig = arm.config as any || {};
        const newConfig = { ...currentConfig };

        // ۱. اگر data.config وجود داره، اون رو به‌عنوان منبع اصلی config در نظر بگیر
        if (data.config) {
            // همه فیلدهای config رو کپی کن
            for (const key of Object.keys(data.config)) {
                newConfig[key] = data.config[key];
            }
        }

        // ۲. اگر فیلدهای خاصی در خود data هست که باید توی config باشه (مثلاً allowManualRoleSelection)، اضافه کن
        if (data.allowManualRoleSelection !== undefined) {
            newConfig.allowManualRoleSelection = data.allowManualRoleSelection;
        }

        // ۳. فیلدهای اصلی Arm رو به‌روز کن (از خود data)
        const updateData: any = { config: newConfig };
        const armFields = ['name', 'shortName', 'slogan', 'description', 'icon', 'colorPrimary', 'colorSecondary', 'logoUrl', 'bannerUrl', 'mission', 'status'];
        for (const field of armFields) {
            if (data[field] !== undefined) {
                updateData[field] = data[field];
            }
        }

        console.log('📝 Config جدید:', JSON.stringify(newConfig, null, 2));

        return this.prisma.arm.update({
            where: { id: arm.id },
            data: updateData,
        });
    }



    // ============================================================
    // ✅ به‌روزرسانی تنظیمات پرداخت بازار
    // ============================================================
    async updatePaymentSettings(slug: string, data: any) {
        const arm = await this.prisma.arm.findUnique({
            where: { slug },
            select: { id: true, config: true },
        });

        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازار یافت نشد',
            });
        }

        const currentConfig = arm.config as any || {};

        // ✅ به‌روزرسانی بخش payment در config
        const updatedConfig = {
            ...currentConfig,
            payment: {
                ...currentConfig.payment,
                ...data,
            },
        };

        return this.prisma.arm.update({
            where: { id: arm.id },
            data: {
                config: updatedConfig,
            },
        });
    }

    // ============================================================
    // ✅ دریافت تنظیمات پرداخت بازار
    // ============================================================
    async getPaymentSettings(slug: string) {
        const arm = await this.prisma.arm.findUnique({
            where: { slug },
            select: { config: true },
        });

        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازار یافت نشد',
            });
        }

        const config = arm.config as any || {};
        return config.payment || {
            paymentMode: 'manual_only',
            defaultGateway: 'pec',
            gateways: [
                { name: 'pec', pin: '', enabled: false },
                { name: 'zarinpal', merchantId: '', enabled: false },
                { name: 'rayanpay', pin: '', enabled: false },
            ],
            manual: {
                enabled: true,
                cardNumber: '',
                shebaNumber: '',
                accountOwner: '',
                bankName: '',
                instructions: '',
            },
            settlementAccount: {
                type: 'bank_card',
                value: '',
            },
        };
    }

    // سرویس برای صفحه گزارش مالی مدیر بازار
    // src/arm-admin/arm/arm-admin.service.ts

    async getFinancialReport(slug: string, startDate?: string, endDate?: string) {
        const arm = await this.prisma.arm.findUnique({
            where: { slug },
            select: { id: true },
        });

        if (!arm) {
            throw new NotFoundException({
                errorCode: 'ARM_NOT_FOUND',
                message: 'بازار یافت نشد',
            });
        }

        const where: any = {
            armId: arm.id,
            transactionType: 'purchase',
        };

        if (startDate) {
            where.createdAt = {
                ...where.createdAt,
                gte: new Date(startDate),
            };
        }
        if (endDate) {
            where.createdAt = {
                ...where.createdAt,
                lte: new Date(endDate),
            };
        }

        const transactions = await this.prisma.credit.findMany({
            where,
            include: {
                user: {
                    select: {
                        fullName: true,
                        phone: true,
                    },
                },
                business: {
                    select: {
                        name: true,
                    },
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
        });

        return {
            transactions: transactions.map(tx => {
                // ✅ خواندن ایمن از metadata
                const metadata = tx.metadata as any || {};

                return {
                    id: tx.id,
                    amount: tx.amount,
                    creditCount: tx.creditCount || 0,
                    user: tx.user.fullName || tx.user.phone || 'کاربر ناشناس',
                    date: tx.createdAt,
                    type: tx.transactionType === 'purchase' ? 'purchase' : 'spend',
                    paymentMethod: metadata.paymentMethod || 'manual',
                    status: tx.transactionType === 'purchase' ? 'تکمیل شده' : 'مصرف شده',
                };
            }),
        };

    }
}