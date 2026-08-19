// src/activity/activity.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ActivityService {
    constructor(private prisma: PrismaService) {}

    async getAll() {
        return this.prisma.activity.findMany({
            where: { isActive: true },
            orderBy: { title: 'asc' },
            select: {
                id: true,
                title: true,
                slug: true,
                path: true,
                level: true,
                code: true,
                parentId: true,
                icon: true,
                description: true,
                isActive: true,
            },
        });
    }

    async getLeaves() {
        return this.prisma.activity.findMany({
            where: {
                isActive: true,
                children: { none: {} },
            },
            select: {
                id: true,
                title: true,
                slug: true,
                path: true,
                level: true,
                code: true,
                parentId: true,
                icon: true,
                description: true,
            },
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

    async getOne(id: string) {
        const activity = await this.prisma.activity.findUnique({
            where: { id },
            include: {
                children: {
                    select: { id: true, title: true },
                },
                parent: {
                    select: { id: true, title: true },
                },
            },
        });

        if (!activity) {
            throw new NotFoundException({
                errorCode: 'ACTIVITY_NOT_FOUND',
                message: 'فعالیت مورد نظر یافت نشد',
            });
        }

        return activity;
    }

    private buildTree(items: any[]): any[] {
        const map = new Map();
        const roots: any[] = [];

        for (const item of items) {
            map.set(item.id, { ...item, children: [] });
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
}