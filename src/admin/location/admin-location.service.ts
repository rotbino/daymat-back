// src/admin/location/admin-location.service.ts
import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminLocationService {
    constructor(private prisma: PrismaService) {}

    // ============================================================
    // دریافت درخت کامل
    // ============================================================
    async getTree() {
        const locations = await this.prisma.location.findMany({
            where: { isActive: true },
            orderBy: { path: 'asc' },
        });
        return this.buildTree(locations);
    }

    // ============================================================
    // دریافت لیست مسطح
    // ============================================================
    async getFlat() {
        return this.prisma.location.findMany({
            where: { isActive: true },
            select: {
                id: true,
                title: true,
                type: true,
                provinceCode: true,
                cityCode: true,
                countryCode: true,
                parentId: true,
                level: true,
                path: true,
            },
            orderBy: { path: 'asc' },
        });
    }

    // ============================================================
    // دریافت کشورها
    // ============================================================
    async getCountries() {
        return this.prisma.location.findMany({
            where: { type: 'country', isActive: true },
            select: { id: true, title: true, slug: true, countryCode: true, level: true, path: true },
            orderBy: { title: 'asc' },
        });
    }

    // ============================================================
    // دریافت زیرمجموعه‌های یک گره
    // ============================================================
    async getChildren(id: string) {
        return this.prisma.location.findMany({
            where: { parentId: id, isActive: true },
            orderBy: { title: 'asc' },
            select: { id: true, title: true, type: true, provinceCode: true, cityCode: true, countryCode: true, level: true, path: true },
        });
    }

    // ============================================================
    // دریافت یک گره
    // ============================================================
    async getOne(id: string) {
        const loc = await this.prisma.location.findUnique({
            where: { id },
            include: {
                parent: { select: { id: true, title: true, type: true } },
                children: { select: { id: true, title: true, type: true }, take: 5 },
            },
        });
        if (!loc) throw new NotFoundException({ errorCode: 'LOCATION_NOT_FOUND', message: 'موقعیت یافت نشد' });
        return loc;
    }

    // ============================================================
    // ایجاد موقعیت جدید
    // ============================================================
    async create(dto: {
        title: string;
        type: string;        // country | province | city | district | region
        parentId?: string;
        countryCode?: string;
        provinceCode?: string;
        cityCode?: string;
    }) {
        let level = 0;
        let path = '';
        let slug = '';

        if (dto.parentId) {
            const parent = await this.prisma.location.findUnique({ where: { id: dto.parentId } });
            if (!parent) throw new BadRequestException({ errorCode: 'PARENT_NOT_FOUND', message: 'والد یافت نشد' });

            level = parent.level + 1;

            // slug یکتا = کد دلخواه یا timestamp
            slug = `${parent.slug}-${Date.now().toString(36)}`;
            path = `${parent.path}.${slug}`;
        } else {
            // کشور - slug از title
            slug = dto.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
            path = slug;
        }

        const existing = await this.prisma.location.findUnique({ where: { slug } });
        if (existing) throw new ConflictException({ errorCode: 'DUPLICATE_SLUG', message: 'اسلاگ تکراری' });

        return this.prisma.location.create({
            data: {
                title: dto.title,
                slug,
                parentId: dto.parentId || null,
                path,
                level,
                type: dto.type,
                countryCode: dto.countryCode || null,
                provinceCode: dto.provinceCode || null,
                cityCode: dto.cityCode || null,
                isActive: true,
            },
        });
    }

    // ============================================================
    // ویرایش موقعیت
    // ============================================================
    async update(id: string, dto: { title?: string; type?: string; countryCode?: string; provinceCode?: string; cityCode?: string }) {
        const loc = await this.getOne(id);
        const data: any = { ...dto };
        return this.prisma.location.update({ where: { id }, data });
    }

    // ============================================================
    // حذف موقعیت
    // ============================================================
    async remove(id: string) {
        const loc = await this.prisma.location.findUnique({
            where: { id },
            include: { children: { select: { id: true } } },
        });
        if (!loc) throw new NotFoundException({ errorCode: 'LOCATION_NOT_FOUND', message: 'موقعیت یافت نشد' });
        if (loc.children.length > 0) {
            throw new ConflictException({ errorCode: 'LOCATION_HAS_CHILDREN', message: 'دارای زیرمجموعه است' });
        }
        return this.prisma.location.update({ where: { id }, data: { isActive: false } });
    }

    // ============================================================
    // buildTree
    // ============================================================
    private buildTree(items: any[]): any[] {
        const map = new Map();
        const roots: any[] = [];
        for (const item of items) map.set(item.id, { ...item, children: [] });
        for (const [id, node] of map) {
            if (node.parentId && map.has(node.parentId)) {
                map.get(node.parentId).children.push(node);
            } else {
                roots.push(node);
            }
        }
        return roots;
    }
}