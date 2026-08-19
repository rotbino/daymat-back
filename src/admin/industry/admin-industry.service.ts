// src/admin/industry/admin-industry.service.ts
import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateIndustryDto, UpdateIndustryDto } from './admin-industry.dto';

@Injectable()
export class AdminIndustryService {
    constructor(private prisma: PrismaService) {}

    async search(query: string, limit: number, offset: number, leavesOnly = false) {
        const where: any = {
            isActive: true,
            title: { contains: query, mode: 'insensitive' },
        };

        if (leavesOnly) {
            where.children = { none: {} };   // فقط برگ‌ها
        }

        const [data, total] = await Promise.all([
            this.prisma.industry.findMany({
                where,
                take: limit,
                skip: offset,
                orderBy: { title: 'asc' },
                select: { id: true, title: true },   // فقط شناسه و عنوان برگردد
            }),
            this.prisma.industry.count({ where }),
        ]);

        return { data, total };
    }

    // ============================================================
    // دریافت فقط برگ‌ها (صنف‌های سطح آخر) - قابل انتخاب
    // ============================================================
    async getLeaves() {
        return this.prisma.industry.findMany({
            where: {
                isActive: true,
                children: { none: {} },
            },
            select: {
                id: true,
                title: true,
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

    // ============================================================
    // دریافت درخت کامل صنف‌ها
    // ============================================================
    async getTree() {
        const industries = await this.prisma.industry.findMany({
            where: { isActive: true },
            orderBy: { path: 'asc' },
        });
        return this.buildTree(industries);
    }

    // ============================================================
    // دریافت همه صنف‌ها (مسطح)
    // ============================================================
    async getAll() {
        return this.prisma.industry.findMany({
            where: { isActive: true },
            orderBy: { path: 'asc' },
        });
    }

    // ============================================================
    // دریافت یک صنف با id
    // ============================================================
    async getOne(id: string) {
        const industry = await this.prisma.industry.findUnique({
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

        if (!industry) {
            throw new NotFoundException({
                errorCode: 'INDUSTRY_NOT_FOUND',
                message: 'صنف مورد نظر یافت نشد',
            });
        }

        return industry;
    }

    // ============================================================
    // ایجاد صنف جدید
    // ============================================================
    async create(dto: CreateIndustryDto) {
        // بررسی تکراری نبودن slug
        const existing = await this.prisma.industry.findUnique({
            where: { slug: dto.slug },
        });

        if (existing) {
            throw new ConflictException({
                errorCode: 'DUPLICATE_SLUG',
                message: 'این slug قبلاً استفاده شده است',
            });
        }

        let level = 0;
        let path = dto.slug;

        if (dto.parentId) {
            const parent = await this.prisma.industry.findUnique({
                where: { id: dto.parentId },
            });

            if (!parent) {
                throw new BadRequestException({
                    errorCode: 'PARENT_NOT_FOUND',
                    message: 'والد مورد نظر یافت نشد',
                });
            }

            level = parent.level + 1;
            path = `${parent.path}.${dto.slug}`;
        }

        return this.prisma.industry.create({
            data: {
                title: dto.title,
                slug: dto.slug,
                parentId: dto.parentId || null,
                level,
                path,
                code: dto.code || null,
                icon: dto.icon || null,
                description: dto.description || null,
                isActive: dto.isActive !== undefined ? dto.isActive : true,
            },
        });
    }

    // ============================================================
    // ویرایش صنف
    // ============================================================
    async update(id: string, dto: UpdateIndustryDto) {
        await this.getOne(id);

        // اگر slug تغییر کرده، بررسی تکراری نبودن
        if (dto.slug) {
            const existing = await this.prisma.industry.findFirst({
                where: {
                    slug: dto.slug,
                    NOT: { id },
                },
            });

            if (existing) {
                throw new ConflictException({
                    errorCode: 'DUPLICATE_SLUG',
                    message: 'این slug قبلاً استفاده شده است',
                });
            }
        }

        // اگر parentId تغییر کرده، مسیر و level را به‌روز کن
        const updateData: any = { ...dto };

        if (dto.parentId !== undefined) {
            if (dto.parentId) {
                const parent = await this.prisma.industry.findUnique({
                    where: { id: dto.parentId },
                });

                if (!parent) {
                    throw new BadRequestException({
                        errorCode: 'PARENT_NOT_FOUND',
                        message: 'والد مورد نظر یافت نشد',
                    });
                }

                // جلوگیری از ایجاد حلقه
                const current = await this.getOne(id);
                if (parent.path.includes(id)) {
                    throw new BadRequestException({
                        errorCode: 'CIRCULAR_REFERENCE',
                        message: 'این تغییر باعث ایجاد حلقه در درخت می‌شود',
                    });
                }

                updateData.level = parent.level + 1;
                updateData.path = `${parent.path}.${current.slug}`;
            } else {
                // اگر parentId null شد، ریشه است
                const current = await this.getOne(id);
                updateData.level = 0;
                updateData.path = current.slug;
            }
        }

        return this.prisma.industry.update({
            where: { id },
            data: updateData,
        });
    }

    // ============================================================
    // حذف صنف (فقط اگر زیرمجموعه نداشته باشد)
    // ============================================================
    async remove(id: string) {
        const industry = await this.getOne(id);

        // بررسی زیرمجموعه‌ها
        if (industry.children && industry.children.length > 0) {
            throw new ConflictException({
                errorCode: 'INDUSTRY_HAS_CHILDREN',
                message: 'این صنف دارای زیرمجموعه است و قابل حذف نیست',
            });
        }

        // بررسی استفاده در Business
        const businessCount = await this.prisma.business.count({
            where: { industryId: id },
        });

        if (businessCount > 0) {
            throw new ConflictException({
                errorCode: 'INDUSTRY_IN_USE',
                message: `این صنف در ${businessCount} کسب‌وکار استفاده شده است و قابل حذف نیست`,
            });
        }

        // بررسی استفاده در config بازارها
        const armsWithIndustry = await this.prisma.arm.findMany({
            select: { id: true, name: true, config: true },
            where: { status: { not: 'archived' } },
        });

        const usedInArms = armsWithIndustry.filter(arm => {
            const config = arm.config as any || {};
            const supplierIds = config.supplierIndustryIds || [];
            const buyerIds = config.buyerIndustryIds || [];
            return supplierIds.includes(id) || buyerIds.includes(id);
        });

        if (usedInArms.length > 0) {
            const armNames = usedInArms.map(a => a.name).join('، ');
            throw new ConflictException({
                errorCode: 'INDUSTRY_USED_IN_ARM',
                message: `این صنف در بازار(های) ${armNames} استفاده شده است. ابتدا آن را از تنظیمات بازارها حذف کنید.`,
            });
        }

        return this.prisma.industry.update({
            where: { id },
            data: { isActive: false },
        });
    }

    // ============================================================
    // دریافت زیرمجموعه‌های یک صنف
    // ============================================================
    async getChildren(id: string) {
        await this.getOne(id);
        return this.prisma.industry.findMany({
            where: {
                parentId: id,
                isActive: true,
            },
            orderBy: { title: 'asc' },
        });
    }

    // ============================================================
    // دریافت کل مسیر یک صنف
    // ============================================================
    async getPath(id: string) {
        const industry = await this.getOne(id);
        const parts = industry.path.split('.');
        const result = [];

        for (const slug of parts) {
            const item = await this.prisma.industry.findFirst({
                where: { slug },
                select: { id: true, title: true, slug: true, level: true },
            });
            if (item) {
                result.push(item);
            }
        }

        return result;
    }

    // ============================================================
    // ساخت درخت از لیست مسطح
    // ============================================================
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