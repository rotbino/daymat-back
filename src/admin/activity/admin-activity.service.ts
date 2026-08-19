// src/admin/activity/admin-activity.service.ts
import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminActivityService {
    constructor(private prisma: PrismaService) {}

    async getLeaves() {
        return this.prisma.activity.findMany({
            where: { isActive: true, children: { none: {} } },
            select: { id: true, title: true, path: true, level: true, code: true, parentId: true },
            orderBy: { title: 'asc' },
        });
    }

    async getTree() {
        const activities = await this.prisma.activity.findMany({
            where: { isActive: true },
            orderBy: { path: 'asc' },
        });
        return this.buildTree(activities);
    }

    async getAll() {
        return this.prisma.activity.findMany({
            where: { isActive: true },
            orderBy: { path: 'asc' },
        });
    }

    async getOne(id: string) {
        const activity = await this.prisma.activity.findUnique({ where: { id } });
        if (!activity) throw new NotFoundException({ errorCode: 'ACTIVITY_NOT_FOUND', message: 'فعالیت یافت نشد' });
        return activity;
    }

    // ============================================================
    // 🆕 CREATE
    // ============================================================
    async create(dto: { title: string; slug: string; parentId?: string; code?: string; isActive?: boolean }) {
        const existing = await this.prisma.activity.findUnique({ where: { slug: dto.slug } });
        if (existing) throw new ConflictException({ errorCode: 'DUPLICATE_SLUG', message: 'اسلاگ تکراری' });

        let level = 0;
        let path = dto.slug;

        if (dto.parentId) {
            const parent = await this.prisma.activity.findUnique({ where: { id: dto.parentId } });
            if (!parent) throw new BadRequestException({ errorCode: 'PARENT_NOT_FOUND', message: 'والد یافت نشد' });
            level = parent.level + 1;
            path = `${parent.path}.${dto.slug}`;
        }

        return this.prisma.activity.create({
            data: {
                title: dto.title,
                slug: dto.slug,
                parentId: dto.parentId || null,
                level,
                path,
                code: dto.code || null,
                isActive: dto.isActive ?? true,
            },
        });
    }

    // ============================================================
    // 🆕 UPDATE
    // ============================================================
    async update(id: string, dto: { title?: string; slug?: string; parentId?: string; code?: string; isActive?: boolean }) {
        await this.getOne(id);

        if (dto.slug) {
            const dup = await this.prisma.activity.findFirst({ where: { slug: dto.slug, NOT: { id } } });
            if (dup) throw new ConflictException({ errorCode: 'DUPLICATE_SLUG', message: 'اسلاگ تکراری' });
        }

        const data: any = { ...dto };

        if (dto.parentId !== undefined) {
            if (dto.parentId) {
                const parent = await this.prisma.activity.findUnique({ where: { id: dto.parentId } });
                if (!parent) throw new BadRequestException({ errorCode: 'PARENT_NOT_FOUND', message: 'والد یافت نشد' });
                const current = await this.getOne(id);
                if (parent.path.includes(id)) throw new BadRequestException({ errorCode: 'CIRCULAR_REFERENCE', message: 'حلقه ایجاد می‌شود' });
                data.level = parent.level + 1;
                data.path = `${parent.path}.${current.slug}`;
            } else {
                const current = await this.getOne(id);
                data.level = 0;
                data.path = current.slug;
            }
        }

        return this.prisma.activity.update({ where: { id }, data });
    }

    // ============================================================
    // 🆕 DELETE (نرم)
    // ============================================================
    async remove(id: string) {
        const activity = await this.prisma.activity.findUnique({
            where: { id },
            include: { children: { select: { id: true } } },
        });
        if (!activity) throw new NotFoundException({ errorCode: 'ACTIVITY_NOT_FOUND', message: 'فعالیت یافت نشد' });

        if (activity.children.length > 0) {
            throw new ConflictException({ errorCode: 'ACTIVITY_HAS_CHILDREN', message: 'دارای زیرمجموعه است' });
        }

        const businessCount = await this.prisma.businessActivity.count({ where: { activityId: id } });
        if (businessCount > 0) {
            throw new ConflictException({ errorCode: 'ACTIVITY_IN_USE', message: `در ${businessCount} کسب‌وکار استفاده شده` });
        }

        return this.prisma.activity.update({ where: { id }, data: { isActive: false } });
    }

    // ============================================================
    // 🆕 زیرمجموعه‌ها و مسیر
    // ============================================================
    async getChildren(id: string) {
        await this.getOne(id);
        return this.prisma.activity.findMany({ where: { parentId: id, isActive: true }, orderBy: { title: 'asc' } });
    }

    async getPath(id: string) {
        const activity = await this.getOne(id);
        const parts = activity.path.split('.');
        const result = [];
        for (const slug of parts) {
            const item = await this.prisma.activity.findFirst({ where: { slug }, select: { id: true, title: true, slug: true, level: true } });
            if (item) result.push(item);
        }
        return result;
    }

    private buildTree(items: any[]): any[] {
        const map = new Map();
        const roots: any[] = [];
        for (const item of items) map.set(item.id, { ...item, children: [] });
        for (const [id, node] of map) {
            if (node.parentId && map.has(node.parentId)) map.get(node.parentId).children.push(node);
            else roots.push(node);
        }
        return roots;
    }
}