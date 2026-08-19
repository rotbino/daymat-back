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

        return this.prisma.productCategory.create({
            data: {
                title: dto.title,
                slug: dto.slug,
                parentId: dto.parentId || null,
                level,
                path,
                example: dto.example || '',
                icon: dto.icon || '',
                description: dto.description || '',
                customFieldsSchema: dto.customFieldsSchema || {},
                defaultMinQuantity: dto.defaultMinQuantity || null,
                isActive: dto.isActive !== undefined ? dto.isActive : true,
                score: 0,
            },
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

        // ساخت درخت
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
// src/admin/category/admin-category.service.ts

    // ============================================================
    // لیست همه دسته‌بندی‌ها (مسطح) - نسخه اصلاح شده
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

        // اگر slug تغییر کرده، بررسی تکراری نبودن
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

        // اگر parentId تغییر کرده، مسیر را به‌روز کن
        const updateData: any = { ...dto };

        if (dto.parentId !== undefined) {
            // بررسی وجود والد جدید
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

                // جلوگیری از ایجاد حلقه
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
                // اگر parentId null شد، ریشه است
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
    // حذف دسته‌بندی (فقط اگر زیرمجموعه یا آگهی نداشته باشد)
    // ============================================================
    // src/admin/category/admin-category.service.ts

// ============================================================
// متد کمکی برای یافتن بازارهایی که از یک دسته‌بندی در config استفاده کرده‌اند
// ============================================================
    private async getArmsUsingCategory(categoryId: string) {
        const arms = await this.prisma.arm.findMany({
            select: { id: true, name: true, slug: true, config: true },
            where: { status: { not: 'archived' } },
        });

        return arms.filter(arm => {
            const config = arm.config as any || {};
            const selections = config.categorySelections || [];
            return selections.some((s: any) => s.categoryId === categoryId);
        }).map(arm => ({ id: arm.id, name: arm.name, slug: arm.slug }));
    }

// ============================================================
// متد remove - با اعتبارسنجی کامل
// ============================================================
    async remove(id: string) {
        await this.findOne(id);

        // ۱. بررسی زیرمجموعه‌ها
        const childrenCount = await this.prisma.productCategory.count({
            where: { parentId: id, isActive: true },
        });

        if (childrenCount > 0) {
            throw new ConflictException({
                errorCode: 'CATEGORY_HAS_CHILDREN',
                message: 'این دسته‌بندی دارای زیرمجموعه است و قابل حذف نیست',
            });
        }

        // ۲. بررسی استفاده در آگهی‌ها
        const adsCount = await this.prisma.ad.count({
            where: { categoryId: id },
        });

        if (adsCount > 0) {
            throw new ConflictException({
                errorCode: 'CATEGORY_IN_USE',
                message: `این دسته‌بندی در ${adsCount} آگهی استفاده شده است و قابل حذف نیست`,
            });
        }

        // ✅ ۳. بررسی استفاده در config بازارها
        const armsUsingCategory = await this.getArmsUsingCategory(id);
        if (armsUsingCategory.length > 0) {
            const armNames = armsUsingCategory.map(a => a.name).join('، ');
            throw new ConflictException({
                errorCode: 'CATEGORY_USED_IN_ARM',
                message: `این دسته‌بندی در بازار(های) ${armNames} استفاده شده است. ابتدا آن را از تنظیمات بازارها حذف کنید.`,
            });
        }

        // ۴. غیرفعال‌سازی دسته‌بندی (حذف نرم)
        return this.prisma.productCategory.update({
            where: { id },
            data: {
                isActive: false,
            },
        });
    }



    // ============================================================
    // دریافت زیرمجموعه‌های یک دسته‌بندی
    // ============================================================
    async getChildren(id: string) {
        await this.findOne(id);

        return this.prisma.productCategory.findMany({
            where: {
                parentId: id,
                isActive: true,
            },
            orderBy: { title: 'asc' },
        });
    }

    async getUnits(id: string) {
        const mappings = await this.prisma.categoryUnitMapping.findMany({
            where: { categoryId: id },
            include: {
                unit: {
                    select: {
                        id: true,
                        title: true,
                        shortCode: true,
                    },
                },
            },
        });

        return mappings.map(m => m.unit);
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

    // src/admin/category/admin-category.service.ts
// ⬇ این متدها رو به کلاس AdminCategoryService اضافه کن


    async getCategoryUnits(categoryId: string) {
        const mappings = await this.prisma.categoryUnitMapping.findMany({
            where: { categoryId },
            include: {
                unit: {
                    select: {
                        id: true,
                        title: true,
                        shortCode: true,
                        isDefault: true,
                    },
                },
            },
        });

        // ✅ برگرداندن شناسهٔ واقعی Unit (نه شناسهٔ Mapping)
        return mappings.map(m => ({
            id: m.unit.id,          // ← اینجا قبلاً m.id بود
            title: m.unit.title,
            shortCode: m.unit.shortCode,
            isDefault: m.isDefault,
        }));
    }

// ============================================================
// افزودن واحد به دسته‌بندی
// ============================================================
    async addUnitToCategory(categoryId: string, unitId: string) {
        // بررسی وجود دسته‌بندی
        await this.findOne(categoryId);

        // بررسی وجود واحد
        const unit = await this.prisma.unit.findUnique({ where: { id: unitId } });
        if (!unit) {
            throw new NotFoundException({
                errorCode: 'UNIT_NOT_FOUND',
                message: 'واحد مورد نظر یافت نشد',
            });
        }

        // بررسی تکراری نبودن
        const existing = await this.prisma.categoryUnitMapping.findFirst({
            where: { categoryId, unitId },
        });
        if (existing) {
            throw new ConflictException({
                errorCode: 'UNIT_ALREADY_MAPPED',
                message: 'این واحد قبلاً به این دسته‌بندی اضافه شده است',
            });
        }

        return this.prisma.categoryUnitMapping.create({
            data: { categoryId, unitId, isDefault: false },
            include: {
                unit: {
                    select: { id: true, title: true, shortCode: true },
                },
            },
        });
    }

// ============================================================
// حذف واحد از دسته‌بندی
// ============================================================
    async removeUnitFromCategory(categoryId: string, unitId: string) {
        const mapping = await this.prisma.categoryUnitMapping.findFirst({
            where: { categoryId, unitId },
        });

        if (!mapping) {
            throw new NotFoundException({
                errorCode: 'MAPPING_NOT_FOUND',
                message: 'این واحد به این دسته‌بندی متصل نیست',
            });
        }

        return this.prisma.categoryUnitMapping.delete({
            where: { id: mapping.id },
        });
    }

// ============================================================
// تنظیم واحد پیش‌فرض برای دسته‌بندی
// ============================================================
    async setDefaultUnit(categoryId: string, unitId: string) {
        // ۱. همه واحدهای این دسته‌بندی رو غیرپیش‌فرض کن
        await this.prisma.categoryUnitMapping.updateMany({
            where: { categoryId },
            data: { isDefault: false },
        });

        // ۲. واحد مورد نظر رو پیش‌فرض کن
        const mapping = await this.prisma.categoryUnitMapping.findFirst({
            where: { categoryId, unitId },
        });

        if (!mapping) {
            throw new NotFoundException({
                errorCode: 'MAPPING_NOT_FOUND',
                message: 'این واحد به این دسته‌بندی متصل نیست',
            });
        }

        return this.prisma.categoryUnitMapping.update({
            where: { id: mapping.id },
            data: { isDefault: true },
            include: {
                unit: {
                    select: { id: true, title: true, shortCode: true },
                },
            },
        });
    }
}