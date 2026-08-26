// src/common/utils/arm.utils.ts

/**
 * ابزارهای عمومی برای کار با ساختار درختی بازار (Arm)
 */

/**
 * جمع‌آوری categoryId ها از درخت دسته‌بندی
 */
export function collectCategoryIdsFromTree(tree: any): Set<string> {
    const ids = new Set<string>();
    const nodes = Array.isArray(tree) ? tree : [];
    const collect = (list: any[]) => {
        for (const node of list) {
            if (node.isLeaf === true) {
                ids.add(node.categoryId || node.id);
            }
            if (node.children && node.children.length > 0) {
                collect(node.children);
            }
        }
    };
    collect(nodes);
    return ids;
}

/**
 * ساخت لیست فلت از درخت دسته‌بندی
 */
export function flattenCategoryTree(tree: any): any[] {
    const result: any[] = [];
    const nodes = Array.isArray(tree) ? tree : [];
    const collect = (list: any[]) => {
        for (const node of list) {
            if (node.isLeaf === true) {
                result.push({
                    categoryId: node.categoryId || node.id,
                    customLabel: node.customLabel || null,
                    baseUnitTitle: node.baseUnitTitle || null,
                });
            }
            if (node.children && node.children.length > 0) {
                collect(node.children);
            }
        }
    };
    collect(nodes);
    return result;
}

/**
 * پیدا کردن نود در درخت دسته‌بندی
 */
export function findNodeInTree(tree: any, categoryId: string): any {
    const nodes = Array.isArray(tree) ? tree : [];
    const search = (list: any[]): any => {
        for (const node of list) {
            if (node.id === categoryId || node.categoryId === categoryId) return node;
            if (node.children && node.children.length > 0) {
                const found = search(node.children);
                if (found) return found;
            }
        }
        return null;
    };
    return search(nodes);
}

/**
 * جمع‌آوری تمام نودهای برگ از درخت
 */
export function collectLeafNodes(tree: any): any[] {
    const result: any[] = [];
    const nodes = Array.isArray(tree) ? tree : [];
    const collect = (list: any[]) => {
        for (const node of list) {
            if (node.isLeaf === true) {
                result.push(node);
            }
            if (node.children && node.children.length > 0) {
                collect(node.children);
            }
        }
    };
    collect(nodes);
    return result;
}

/**
 * بررسی وجود categoryId در درخت
 */
export function isCategoryInTree(tree: any, categoryId: string): boolean {
    return collectCategoryIdsFromTree(tree).has(categoryId);
}

/**
 * دریافت واحدهای قابل انتخاب برای یک کتگوری از درخت
 */
export function getAvailableUnitsFromTree(tree: any, categoryId: string): any[] {
    const node = findNodeInTree(tree, categoryId);
    if (!node) return [];

    const units: any[] = [];

    if (node.overrideUnitId) {
        units.push({
            unitId: node.overrideUnitId,
            unitTitle: node.overrideUnitTitle || '',
            unitShortCode: node.overrideUnitShortCode || '',
            isVariableQty: node.overrideUnitIsVariableQty === true,
            qty: node.overrideUnitQty ?? null,
            isDefault: true,
        });
    }

    (node.alternativeUnits || []).forEach((au: any) => {
        if (au.unitId && au.isActive !== false) {
            units.push({
                unitId: au.unitId,
                unitTitle: au.unitTitle || '',
                unitShortCode: au.unitShortCode || '',
                isVariableQty: au.isVariableQty === true,
                qty: au.qty ?? null,
                isDefault: false,
            });
        }
    });

    return units;
}

/**
 * دریافت محدودیت‌های حداقل/حداکثر برای یک کتگوری
 */
export function getCategoryConstraintsFromTree(tree: any, categoryId: string): { min: number | null; max: number | null } {
    const node = findNodeInTree(tree, categoryId);
    if (!node) return { min: null, max: null };

    return {
        min: node.minQuantityOverride ?? null,
        max: node.maxQuantityOverride ?? null,
    };
}


/**
 * پیدا کردن مسیر کامل یک گره در درخت دسته‌بندی
 * @param tree - درخت دسته‌بندی
 * @param categoryId - شناسه گره هدف
 * @returns آرایه‌ای از شناسه‌های مسیر از ریشه تا برگ
 */
export function findCategoryPathInTree(tree: any[], categoryId: string): string[] {
    if (!tree || !categoryId) return [];

    function search(nodes: any[], path: string[]): string[] | null {
        for (const node of nodes) {
            const currentPath = [...path, node.id || node.categoryId];

            // اگر گره فعلی هدف باشد
            if (node.id === categoryId || node.categoryId === categoryId) {
                return currentPath;
            }

            // جستجو در فرزندان
            if (node.children && node.children.length > 0) {
                const found = search(node.children, currentPath);
                if (found) return found;
            }
        }
        return null;
    }

    return search(tree, []) || [];
}