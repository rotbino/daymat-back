// src/admin/payment/admin-payment.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminPaymentService {
    constructor(private prisma: PrismaService) {}

    async getPaymentRequests(query: {
        page?: number; limit?: number; search?: string;
        armSlug?: string; status?: string;
        startDate?: string; endDate?: string;
        sortBy?: string; sortOrder?: 'asc' | 'desc';
    }) {
        const { page = 1, limit = 20, search, armSlug, status,
            startDate, endDate, sortBy = 'createdAt', sortOrder = 'desc' } = query;

        const skip = (Number(page) - 1) * Number(limit);
        const where: any = {};

        if (status && status !== 'all') where.status = status;
        if (armSlug && armSlug !== 'all') {
            const arm = await this.prisma.arm.findUnique({ where: { slug: armSlug }, select: { id: true } });
            if (arm) where.armId = arm.id;
        }
        if (search) {
            where.OR = [
                { receiptNote: { contains: search, mode: 'insensitive' } },
                { user: { fullName: { contains: search, mode: 'insensitive' } } },
                { user: { phone: { contains: search, mode: 'insensitive' } } },
            ];
        }
        if (startDate) where.createdAt = { gte: new Date(startDate) };
        if (endDate) where.createdAt = { ...where.createdAt, lte: new Date(endDate + 'T23:59:59.999Z') };

        const [items, total] = await Promise.all([
            this.prisma.creditRequest.findMany({
                where,
                skip, take: Number(limit),
                select: {
                    id: true, amount: true, status: true, receiptImage: true,
                    receiptNote: true, rejectReason: true, createdAt: true,
                    verifiedAt: true, metadata: true,
                    user: { select: { id: true, fullName: true, phone: true } },
                    business: { select: { id: true, name: true, city: true, province: true } },
                    arm: { select: { id: true, slug: true, name: true, colorPrimary: true } },
                },
                orderBy: { [sortBy]: sortOrder },
            }),
            this.prisma.creditRequest.count({ where }),
        ]);

        return {
            items: items.map(item => {
                const metadata = item.metadata as any || {};
                return {
                    ...item,
                    paymentMethod: 'manual',
                    creditCount: metadata.creditCount || Math.floor(item.amount / 2000),
                    creditPrice: metadata.creditPrice || 2000,
                };
            }),
            pagination: { page: Number(page), limit: Number(limit), total, totalPages: Math.ceil(total / Number(limit)) },
        };
    }

    async getStats(query: { armSlug?: string; startDate?: string; endDate?: string }) {
        const where: any = {};
        if (query.armSlug) {
            const arm = await this.prisma.arm.findUnique({ where: { slug: query.armSlug }, select: { id: true } });
            if (arm) where.armId = arm.id;
        }
        if (query.startDate) where.createdAt = { gte: new Date(query.startDate) };
        if (query.endDate) where.createdAt = { ...where.createdAt, lte: new Date(query.endDate + 'T23:59:59.999Z') };

        const [total, pending, approved, rejected, totalAmount] = await Promise.all([
            this.prisma.creditRequest.count({ where }),
            this.prisma.creditRequest.count({ where: { ...where, status: 'pending' } }),
            this.prisma.creditRequest.count({ where: { ...where, status: 'approved' } }),
            this.prisma.creditRequest.count({ where: { ...where, status: 'rejected' } }),
            this.prisma.creditRequest.aggregate({ where: { ...where, status: 'approved' }, _sum: { amount: true } }),
        ]);

        const today = new Date(); today.setHours(0, 0, 0, 0);
        const todayCount = await this.prisma.creditRequest.count({ where: { ...where, createdAt: { gte: today } } });
        const todayAmount = await this.prisma.creditRequest.aggregate({ where: { ...where, createdAt: { gte: today }, status: 'approved' }, _sum: { amount: true } });

        return {
            total, pending, approved, rejected,
            totalAmount: totalAmount._sum.amount || 0,
            todayCount,
            todayTotal: todayAmount._sum.amount || 0,
        };
    }
}