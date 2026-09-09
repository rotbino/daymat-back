// src/unit/unit.service.ts
// ✅ سرویس واحدها — با کش یک‌ساعته (دادهٔ تقریباً ثابت)
// باطل‌سازی در AdminUnitService (create/update/delete)

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheHelper } from '../common/services/cache.helper';

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
}
