// src/location/location.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LocationService {
    constructor(private prisma: PrismaService) {}

    // ============================================================
    // 1. دریافت درخت موقعیت‌ها از config بازار
    // ============================================================
    async getArmLocationTree(armId: string) {
        const arm = await this.prisma.arm.findUnique({
            where: { id: armId },
            select: { config: true },
        });

        if (!arm) {
            return [];
        }

        const config = arm.config as any || {};
        const selections = config.locationSelections || [];

        if (selections.length === 0) {
            return [];
        }

        const locationIds = selections.map((s: any) => s.locationId);

        // دریافت اطلاعات کامل موقعیت‌ها از دیتابیس
        const locations = await this.prisma.location.findMany({
            where: {
                id: { in: locationIds },
                isActive: true,
            },
            include: {
                parent: {
                    select: {
                        id: true,
                        title: true,
                        type: true,
                        provinceCode: true,
                    },
                },
            },
        });

        // ساخت Map برای دسترسی سریع به selections
        const selectionMap = new Map();
        selections.forEach((s: any) => {
            selectionMap.set(s.locationId, s);
        });

        // گروه‌بندی بر اساس استان
        const provinceMap = new Map();

        for (const city of locations) {
            const province = city.parent;
            if (!province) continue;

            if (!provinceMap.has(province.id)) {
                provinceMap.set(province.id, {
                    id: province.id,
                    title: province.title,
                    type: province.type,
                    provinceCode: province.provinceCode,
                    isActive: true,
                    children: [],
                    isSelected: false,
                });
            }

            const selection = selectionMap.get(city.id);
            provinceMap.get(province.id).children.push({
                id: city.id,
                title: city.title,
                type: city.type,
                cityCode: city.cityCode,
                isActive: true,
                isSelected: true,
                customLabel: selection?.customLabel || null,
                children: [],
            });
        }

        return Array.from(provinceMap.values());
    }

    // ============================================================
    // 2. دریافت درخت کامل موقعیت‌ها (برای ادمین)
    // ============================================================
    async getFullTree() {
        const locations = await this.prisma.location.findMany({
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
            select: {
                id: true,
                title: true,
                type: true,
                provinceCode: true,
                cityCode: true,
                parentId: true,
                isActive: true,
                sortOrder: true,
                level: true,
                path: true,
                slug: true,
            },
        });

        return this.buildTree(locations);
    }

    // ============================================================
    // 3. اعتبارسنجی موقعیت‌ها بر اساس config
    // ============================================================
    async validateLocations(armId: string, locationIds: string[]): Promise<boolean> {
        const arm = await this.prisma.arm.findUnique({
            where: { id: armId },
            select: { config: true },
        });

        if (!arm) {
            return false;
        }

        const config = arm.config as any || {};
        const selections = config.locationSelections || [];
        const availableIds = selections.map((s: any) => s.locationId);

        return locationIds.every(id => availableIds.includes(id));
    }

    // ============================================================
    // 4. دریافت اطلاعات یک موقعیت با id
    // ============================================================
    async findLocationById(id: string) {
        return this.prisma.location.findUnique({
            where: { id },
        });
    }

    // ============================================================
    // 5. ساخت درخت از لیست مسطح
    // ============================================================
    private buildTree(locations: any[]): any[] {
        const map = new Map();
        const roots: any[] = [];

        for (const loc of locations) {
            map.set(loc.id, {
                ...loc,
                children: [],
            });
        }

        for (const [id, node] of map) {
            if (node.parentId && map.has(node.parentId)) {
                map.get(node.parentId).children.push(node);
            } else {
                roots.push(node);
            }
        }

        return roots;
    }

    // ============================================================
    // 6. دریافت لیست ساده شهرهای یک بازار (برای فیلتر)
    // ============================================================
    async getArmCities(armId: string): Promise<string[]> {
        const arm = await this.prisma.arm.findUnique({
            where: { id: armId },
            select: { config: true },
        });

        if (!arm) {
            return [];
        }

        const config = arm.config as any || {};
        const selections = config.locationSelections || [];

        if (selections.length === 0) {
            return [];
        }

        const locationIds = selections.map((s: any) => s.locationId);
        const locations = await this.prisma.location.findMany({
            where: {
                id: { in: locationIds },
                type: 'city',
                isActive: true,
            },
            select: {
                title: true,
                cityCode: true,
            },
        });

        return locations.map(l => l.title);
    }

    // ============================================================
    // 7. دریافت لیست ساده استان‌های یک بازار (برای فیلتر)
    // ============================================================
    async getArmProvinces(armId: string): Promise<string[]> {
        const arm = await this.prisma.arm.findUnique({
            where: { id: armId },
            select: { config: true },
        });

        if (!arm) {
            return [];
        }

        const config = arm.config as any || {};
        const selections = config.locationSelections || [];

        if (selections.length === 0) {
            return [];
        }

        const locationIds = selections.map((s: any) => s.locationId);
        const locations = await this.prisma.location.findMany({
            where: {
                id: { in: locationIds },
                type: 'province',
                isActive: true,
            },
            select: {
                title: true,
                provinceCode: true,
            },
        });

        return locations.map(l => l.title);
    }
}