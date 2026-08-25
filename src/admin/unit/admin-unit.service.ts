// src/admin/unit/admin-unit.service.ts
import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { CreateUnitDto, UpdateUnitDto } from './admin-unit.dto';
import { PrismaService } from "../../prisma/prisma.service";
import { collectLeafNodes } from '../../common/utils/arm.utils';

@Injectable()
export class AdminUnitService {
    constructor(private prisma: PrismaService) {}

    // ============================================================
    // ایجاد واحد جدید
    // ============================================================
    async create(dto: CreateUnitDto) {
        const existing = await this.prisma.unit.findFirst({
            where: {
                OR: [
                    { title: dto.title },
                    { shortCode: dto.shortCode },
                ],
            },
        });

        if (existing) {
            throw new ConflictException({
                errorCode: 'DUPLICATE_UNIT',
                message: 'واحد با این عنوان یا کد کوتاه قبلاً ثبت شده است',
            });
        }

        return this.prisma.unit.create({
            data: {
                title: dto.title,
                shortCode: dto.shortCode,
                isDefault: dto.isDefault || false,
            },
        });
    }

    // ============================================================
    // لیست همه واحدها
    // ============================================================
    async findAll() {
        return this.prisma.unit.findMany({
            orderBy: { title: 'asc' },
        });
    }

    // ============================================================
    // دریافت یک واحد
    // ============================================================
    async findOne(id: string) {
        const unit = await this.prisma.unit.findUnique({
            where: { id },
        });

        if (!unit) {
            throw new NotFoundException({
                errorCode: 'UNIT_NOT_FOUND',
                message: 'واحد مورد نظر یافت نشد',
            });
        }

        return unit;
    }

    // ============================================================
    // ویرایش واحد
    // ============================================================
    async update(id: string, dto: UpdateUnitDto) {
        await this.findOne(id);

        if (dto.title || dto.shortCode) {
            const existing = await this.prisma.unit.findFirst({
                where: {
                    OR: [
                        { title: dto.title },
                        { shortCode: dto.shortCode },
                    ],
                    NOT: { id },
                },
            });

            if (existing) {
                throw new ConflictException({
                    errorCode: 'DUPLICATE_UNIT',
                    message: 'واحد با این عنوان یا کد کوتاه قبلاً ثبت شده است',
                });
            }
        }

        return this.prisma.unit.update({
            where: { id },
            data: {
                title: dto.title,
                shortCode: dto.shortCode,
                isDefault: dto.isDefault,
            },
        });
    }

    // ============================================================
    // متد کمکی: پیدا کردن بازارهایی که از این واحد استفاده می‌کنند
    // ============================================================
    private async getArmsUsingUnit(unitId: string) {
        const arms = await this.prisma.arm.findMany({
            select: { id: true, name: true, categoryTree: true },
            where: { status: { not: 'archived' } },
        });

        return arms.filter(arm => {
            // ✅ جمع‌آوری همه برگ‌های درخت
            const leafNodes = collectLeafNodes(arm.categoryTree);

            return leafNodes.some((node: any) => {
                // ✅ چک واحد پیش‌فرض
                if (node.overrideUnitId === unitId) return true;

                // ✅ چک واحد اصلی
                if (node.baseUnitId === unitId) return true;

                // ✅ چک واحدهای فرعی
                const altUnits = node.alternativeUnits || [];
                return altUnits.some((au: any) => au.unitId === unitId);
            });
        }).map(arm => ({ id: arm.id, name: arm.name }));
    }

    // ============================================================
    // متد remove
    // ============================================================
    async remove(id: string) {
        await this.findOne(id);

        const adsCount = await this.prisma.ad.count({
            where: { unitId: id },
        });

        if (adsCount > 0) {
            throw new ConflictException({
                errorCode: 'UNIT_IN_USE',
                message: `این واحد در ${adsCount} آگهی استفاده شده است و قابل حذف نیست`,
            });
        }

        const armsUsingUnit = await this.getArmsUsingUnit(id);
        if (armsUsingUnit.length > 0) {
            const armNames = armsUsingUnit.map(a => a.name).join('، ');
            throw new ConflictException({
                errorCode: 'UNIT_USED_IN_ARM',
                message: `این واحد در بازار(های) ${armNames} استفاده شده است. ابتدا آن را از تنظیمات بازارها حذف کنید.`,
            });
        }

        return this.prisma.unit.delete({
            where: { id },
        });
    }
}