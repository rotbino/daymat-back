// src/admin/category/admin-category.service.ts
import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCategoryDto, UpdateCategoryDto } from './admin-category.dto';

@Injectable()
export class AdminCategoryService {
    constructor(private prisma: PrismaService) {}

    // ============================================================
    // ایجاد دسته‌بندی جدید
    // ============================================================
    async create(dto: CreateCategoryDto) {
        const existing = await this.prisma.productCategory.findUnique({
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
            const parent = await this.prisma.productCategory.findUnique({
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

        const data: any = {
            title: dto.title,
            slug: dto.slug,
            level,
            path,
            example: dto.example || '',
            icon: dto.icon || '',
            description: dto.description || '',
            customFieldsSchema: dto.customFieldsSchema || {},
            defaultMinQuantity: dto.defaultMinQuantity || null,
            isActive: dto.isActive !== undefined ? dto.isActive : true,
            score: 0,
        };

        if (dto.parentId) {
            data.parentId = dto.parentId;
        }

        return this.prisma.productCategory.create({
            data,
        });
    }

    // ============================================================
    // لیست همه دسته‌بندی‌ها (ساختار درختی)
    // ============================================================
    async findAll() {
        const categories = await this.prisma.productCategory.findMany({
            where: { isActive: true },
            orderBy: { path: 'asc' },
        });

        const tree: any[] = [];
        const map = new Map();

        for (const cat of categories) {
            map.set(cat.id, { ...cat, children: [] });
        }

        for (const cat of categories) {
            if (cat.parentId) {
                const parent = map.get(cat.parentId);
                if (parent) {
                    parent.children.push(map.get(cat.id));
                }
            } else {
                tree.push(map.get(cat.id));
            }
        }

        return tree;
    }

    // ============================================================
    // لیست همه دسته‌بندی‌ها (مسطح)
    // ============================================================
    async findAllFlat() {
        return this.prisma.productCategory.findMany({
            where: { isActive: true },
            orderBy: { path: 'asc' },
        });
    }

    // ============================================================
    // دریافت یک دسته‌بندی
    // ============================================================
    async findOne(id: string) {
        const category = await this.prisma.productCategory.findUnique({
            where: { id },
        });

        if (!category) {
            throw new NotFoundException({
                errorCode: 'CATEGORY_NOT_FOUND',
                message: 'دسته‌بندی مورد نظر یافت نشد',
            });
        }

        return category;
    }

    // ============================================================
    // ویرایش دسته‌بندی
    // ============================================================
    async update(id: string, dto: UpdateCategoryDto) {
        await this.findOne(id);

        if (dto.slug) {
            const existing = await this.prisma.productCategory.findFirst({
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

        const updateData: any = { ...dto };

        if (dto.parentId !== undefined) {
            if (dto.parentId) {
                const parent = await this.prisma.productCategory.findUnique({
                    where: { id: dto.parentId },
                });

                if (!parent) {
                    throw new BadRequestException({
                        errorCode: 'PARENT_NOT_FOUND',
                        message: 'والد مورد نظر یافت نشد',
                    });
                }

                if (parent.path.includes(id)) {
                    throw new BadRequestException({
                        errorCode: 'CIRCULAR_REFERENCE',
                        message: 'این تغییر باعث ایجاد حلقه در درخت می‌شود',
                    });
                }

                const current = await this.findOne(id);
                updateData.level = parent.level + 1;
                updateData.path = `${parent.path}.${current.slug}`;
            } else {
                const current = await this.findOne(id);
                updateData.level = 0;
                updateData.path = current.slug;
            }
        }

        return this.prisma.productCategory.update({
            where: { id },
            data: updateData,
        });
    }

    // ============================================================
    // متد کمکی برای یافتن بازارهایی که از یک دسته‌بندی در categoryTree استفاده کرده‌اند
    // ============================================================
    private async getArmsUsingCategory(categoryId: string) {
        const arms = await this.prisma.arm.findMany({
            select: { id: true, name: true, slug: true, categoryTree: true },
            where: { status: { not: 'archived' } },
        });

        return arms.filter(arm => {
            const tree = (arm.categoryTree as any[]) || [];

            // ✅ جستجوی بازگشتی در درخت
            const searchInTree = (nodes: any[]): boolean => {
                for (const node of nodes) {
                    if (node.categoryId === categoryId || node.id === categoryId) return true;
                    if (node.children && node.children.length > 0) {
                        if (searchInTree(node.children)) return true;
                    }
                }
                return false;
            };

            return searchInTree(tree);
        }).map(arm => ({ id: arm.id, name: arm.name, slug: arm.slug }));
    }

    // ============================================================
    // متد remove - با اعتبارسنجی کامل
    // ============================================================
    async remove(id: string) {
        await this.findOne(id);

        const childrenCount = await this.prisma.productCategory.count({
            where: { parentId: id, isActive: true },
        });

        if (childrenCount > 0) {
            throw new ConflictException({
                errorCode: 'CATEGORY_HAS_CHILDREN',
                message: 'این دسته‌بندی دارای زیرمجموعه است و قابل حذف نیست',
            });
        }

        const adsCount = await this.prisma.ad.count({
            where: { categoryId: id },
        });

        if (adsCount > 0) {
            throw new ConflictException({
                errorCode: 'CATEGORY_IN_USE',
                message: `این دسته‌بندی در ${adsCount} آگهی استفاده شده است و قابل حذف نیست`,
            });
        }

        const armsUsingCategory = await this.getArmsUsingCategory(id);
        if (armsUsingCategory.length > 0) {
            const armNames = armsUsingCategory.map(a => a.name).join('، ');
            throw new ConflictException({
                errorCode: 'CATEGORY_USED_IN_ARM',
                message: `این دسته‌بندی در بازار(های) ${armNames} استفاده شده است. ابتدا آن را از تنظیمات بازارها حذف کنید.`,
            });
        }

        return this.prisma.productCategory.update({
            where: { id },
            data: { isActive: false },
        });
    }

    // ============================================================
    // دریافت زیرمجموعه‌های یک دسته‌بندی
    // ============================================================
    async getChildren(id: string) {
        await this.findOne(id);

        return this.prisma.productCategory.findMany({
            where: { parentId: id, isActive: true },
            orderBy: { title: 'asc' },
        });
    }

    // ============================================================
    // دریافت کل مسیر یک دسته‌بندی
    // ============================================================
    async getPath(id: string) {
        const category = await this.findOne(id);

        const parts = category.path.split('.');
        const result = [];

        for (const slug of parts) {
            const cat = await this.prisma.productCategory.findFirst({
                where: { slug },
                select: { id: true, title: true, slug: true },
            });
            if (cat) {
                result.push(cat);
            }
        }

        return result;
    }
}