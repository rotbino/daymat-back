// src/unit/unit.service.ts
// ✅ سرویس واحدها — با کش یک‌ساعته (دادهٔ تقریباً ثابت)
// باطل‌سازی در AdminUnitService و createForUser

import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheHelper } from '../common/services/cache.helper';
import { CreateUserUnitDto } from './unit.dto';
import { normalizeUnitTitle } from '../common/utils/unit.utils';

/** واحدها تقریباً ثابت هستند — کش یک‌ساعته امن است */
const UNITS_CACHE_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class UnitService {
    constructor(private prisma: PrismaService, private cache: CacheHelper) {}

    async getAll(ids?: string[]) {
        const idList = (ids ?? [])
            .map((s) => s.trim())
            .filter((s) => /^[0-9a-fA-F]{24}$/.test(s));

        const key = idList.length ? idList.sort().join(',') : 'all';

        return this.cache.wrap('units', [key], UNITS_CACHE_TTL_MS, async () => {
            return this.prisma.unit.findMany({
                where: idList.length ? { id: { in: idList } } : {},
                orderBy: [{ containsQty: 'asc' }, { title: 'asc' }],
            });
        });
    }

    // ============================================================
    // ✅ ثبت واحد جدید توسط کاربر (مدال واحدهای ویزارد)
    // عنوان تکراری (با نرمال‌سازی) ممنوع — کد کوتاه خودکار از عنوان
    // ============================================================
    async createForUser(userId: string, dto: CreateUserUnitDto) {
        const title = dto.title.trim();
        const norm = normalizeUnitTitle(title);

        // چک تکراری: عنوان/کدِ جدید در برابر همه عنوان‌ها و کدهای موجود
        const existing = await this.prisma.unit.findMany({
            select: { title: true, shortCode: true },
        });
        const dup = existing.find((u) =>
            normalizeUnitTitle(u.title) === norm ||
            normalizeUnitTitle(u.shortCode) === norm,
        );
        if (dup) {
            throw new ConflictException({
                errorCode: 'DUPLICATE_UNIT',
                message: `واحدی با عنوان «${dup.title}» از قبل ثبت شده است`,
            });
        }

        const hasQty = dto.containsQty != null && dto.containsQty >= 2;
        const created = await this.prisma.unit.create({
            data: {
                title,
                // کد کوتاه خودکار از عنوان (لیست قدیمی هم همین الگو را داشت)
                shortCode: title,
                scope: dto.scope,
                containsQty: hasQty ? dto.containsQty : null,
                qtyIsFixed: hasQty ? !!dto.qtyIsFixed : false,
                createdByUserId: userId,
            },
        });
        // ✅ باطل‌سازی کش واحدها
        await this.cache.bust('units');
        return created;
    }
}
