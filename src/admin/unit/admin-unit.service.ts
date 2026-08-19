// src/admin/unit/admin-unit.service.ts
import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { CreateUnitDto, UpdateUnitDto } from './admin-unit.dto';
import {PrismaService} from "../../prisma/prisma.service";

@Injectable()
export class AdminUnitService {
    constructor(private prisma: PrismaService) {}

    // ============================================================
    // ایجاد واحد جدید
    // ============================================================
    async create(dto: CreateUnitDto) {
        // بررسی تکراری نبودن عنوان
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

        // بررسی تکراری نبودن (اگر عنوان یا کد کوتاه تغییر کرده)
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
// متد remove - با اعتبارسنجی config
// ============================================================

    private async getArmsUsingUnit(unitId: string) {
        const arms = await this.prisma.arm.findMany({
            select: { id: true, name: true, config: true },
            where: { status: { not: 'archived' } },
        });

        return arms.filter(arm => {
            const config = arm.config as any || {};
            const selections = config.categorySelections || [];
            return selections.some((s: any) => s.overrideUnitId === unitId);
        }).map(arm => ({ id: arm.id, name: arm.name }));
    }

// ============================================================
// متد remove - با استفاده از متد کمکی
// ============================================================
    async remove(id: string) {
        await this.findOne(id);

        // ۱. بررسی استفاده در آگهی‌ها
        const adsCount = await this.prisma.ad.count({
            where: { unitId: id },
        });

        if (adsCount > 0) {
            throw new ConflictException({
                errorCode: 'UNIT_IN_USE',
                message: `این واحد در ${adsCount} آگهی استفاده شده است و قابل حذف نیست`,
            });
        }

        // ✅ ۲. بررسی استفاده در config بازارها
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