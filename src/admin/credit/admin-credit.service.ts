// src/admin/credit/admin-credit.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminCreditService {
    constructor(private prisma: PrismaService) {}

    // ============================================================
    // لیست تراکنش‌های خرید اعتبار
    // ============================================================
    async getTransactions(query: {
        page?: number; limit?: number; search?: string;
        armSlug?: string; categoryId?: string;
        status?: string; creditType?: string; paymentMethod?: string;
        minAmount?: number; maxAmount?: number;
        startDate?: string; endDate?: string;
        city?: string; provinceCode?: string;
        sortBy?: string; sortOrder?: 'asc' | 'desc';
    }) {
        const { page = 1, limit = 20, search, armSlug, categoryId, status, creditType, paymentMethod,
            minAmount, maxAmount, startDate, endDate, city, provinceCode,
            sortBy = 'createdAt', sortOrder = 'desc' } = query;

        const skip = (Number(page) - 1) * Number(limit);
        const where: any = {
            transactionType: 'purchase',
        };

        if (status && status !== 'all') {
            where.status = status;
        }
        if (creditType && creditType !== 'all') {
            where.creditType = creditType;
        }
        if (search) {
            where.OR = [
                { description: { contains: search, mode: 'insensitive' } },
                { user: { fullName: { contains: search, mode: 'insensitive' } } },
                { user: { phone: { contains: search, mode: 'insensitive' } } },
            ];
        }
        if (armSlug && armSlug !== 'all') {
            const arm = await this.prisma.arm.findUnique({ where: { slug: armSlug }, select: { id: true } });
            if (arm) where.armId = arm.id;
        }
        if (minAmount !== undefined) where.amount = { ...where.amount, gte: Number(minAmount) };
        if (maxAmount !== undefined) where.amount = { ...where.amount, lte: Number(maxAmount) };
        if (startDate) where.createdAt = { ...where.createdAt, gte: new Date(startDate) };
        if (endDate) where.createdAt = { ...where.createdAt, lte: new Date(endDate + 'T23:59:59.999Z') };

        // paymentMethod از metadata استخراج میشه
        // برای فیلتر شهر و استان باید از business یا ad استفاده کنیم - فعلاً از metadata

        const orderMap: any = {
            createdAt: { createdAt: sortOrder },
            amount: { amount: sortOrder },
            creditCount: { creditCount: sortOrder },
        };

        const [items, total] = await Promise.all([
            this.prisma.credit.findMany({
                where,
                skip, take: Number(limit),
                select: {
                    id: true, amount: true, creditCount: true, creditType: true,
                    status: true, description: true, createdAt: true,
                    pricePerCredit: true, metadata: true,
                    user: { select: { id: true, fullName: true, phone: true } },
                    business: { select: { id: true, name: true, city: true, province: true } },
                    arm: { select: { id: true, slug: true, name: true, colorPrimary: true } },
                },
                orderBy: orderMap[sortBy] || { createdAt: 'desc' },
            }),
            this.prisma.credit.count({ where }),
        ]);

        // post-process برای استخراج paymentMethod از metadata
        const processedItems = items.map(item => {
            const metadata = item.metadata as any || {};
            return {
                ...item,
                paymentMethod: metadata.paymentMethod || 'manual',
                currencySymbol: metadata.currencySymbol || 'تومان',
            };
        });

        // فیلتر paymentMethod در سطح کد (چون توی metadata هست)
        let filteredItems = processedItems;
        if (paymentMethod && paymentMethod !== 'all') {
            filteredItems = processedItems.filter(i => i.paymentMethod === paymentMethod);
        }

        // فیلتر شهر
        if (city) {
            filteredItems = filteredItems.filter(i =>
                i.business?.city?.toLowerCase().includes(city.toLowerCase())
            );
        }

        return {
            items: filteredItems,
            pagination: {
                page: Number(page), limit: Number(limit), total,
                totalPages: Math.ceil(total / Number(limit)),
            },
        };
    }

    // ============================================================
    // آمار تراکنش‌ها
    // ============================================================
    async getStats(query: { armSlug?: string; startDate?: string; endDate?: string }) {
        const where: any = { transactionType: 'purchase', status: 'success' };

        if (query.armSlug) {
            const arm = await this.prisma.arm.findUnique({ where: { slug: query.armSlug }, select: { id: true } });
            if (arm) where.armId = arm.id;
        }
        if (query.startDate) where.createdAt = { ...where.createdAt, gte: new Date(query.startDate) };
        if (query.endDate) where.createdAt = { ...where.createdAt, lte: new Date(query.endDate + 'T23:59:59.999Z') };

        const [total, totalAmount, totalCredits, avgPrice, todayTotal, todayCount] = await Promise.all([
            this.prisma.credit.count({ where }),
            this.prisma.credit.aggregate({ where, _sum: { amount: true } }),
            this.prisma.credit.aggregate({ where, _sum: { creditCount: true } }),
            this.prisma.credit.aggregate({ where, _avg: { pricePerCredit: true } }),
            this.prisma.credit.aggregate({
                where: { ...where, createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
                _sum: { amount: true },
            }),
            this.prisma.credit.count({
                where: { ...where, createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
            }),
        ]);

        return {
            total,
            totalAmount: totalAmount._sum.amount || 0,
            totalCredits: totalCredits._sum.creditCount || 0,
            avgPricePerCredit: Math.round(avgPrice._avg.pricePerCredit || 0),
            todayTotal: todayTotal._sum.amount || 0,
            todayCount,
        };
    }

    // ============================================================
    // جزئیات یک تراکنش
    // ============================================================
    // src/admin/credit/admin-credit.service.ts
    // src/admin/credit/admin-credit.service.ts
    async getTransactionDetail(id: string) {
        const credit = await this.prisma.credit.findUnique({
            where: { id },
            include: {
                user: { select: { id: true, fullName: true, phone: true } },
                business: { select: { id: true, name: true, city: true, province: true, phone: true } },
                arm: { select: { id: true, slug: true, name: true, colorPrimary: true } },
            },
        });

        if (!credit) return null;

        let receiptImage = null;
        let receiptNote = null;

        // ⬇ فیش از CreditRequest خونده میشه
        if (credit.relatedEntityType === 'CreditRequest' && credit.relatedEntityId) {
            const creditRequest = await this.prisma.creditRequest.findUnique({
                where: { id: credit.relatedEntityId },
                select: { receiptImage: true, receiptNote: true },
            });
            receiptImage = creditRequest?.receiptImage || null;
            receiptNote = creditRequest?.receiptNote || null;
        }

        // ⬇ metadata هم چک کن (بعضی وقتا receiptImage توی metadata ذخیره میشه)
        const metadata = credit.metadata as any || {};
        if (!receiptImage && metadata.receiptImage) {
            receiptImage = metadata.receiptImage;
        }

        return {
            ...credit,
            receiptImage,
            receiptNote,
        };
    }

    // ============================================================
    // بازارها برای فیلتر
    // ============================================================
    async getArmsForFilter() {
        return this.prisma.arm.findMany({
            where: { status: 'active' },
            select: { id: true, slug: true, name: true, colorPrimary: true },
            orderBy: { name: 'asc' },
        });
    }
}