/**
 * تطبیق دستهٔ کاتالوگ با گرهٔ درخت بازار، از طریق لنگر مرجع.
 * سه شکل دادهٔ موجود در دیتابیس را می‌پذیرد:
 *   ۱) نود بازار refCategoryId دارد → تطبیق مستقیم
 *   ۲) نود بازار categoryId دارد (شکل customCategoryTree تامینو که به ProductCategory لنگر خورده)
 *   ۳) نود بازار id دارد (درخت‌های کلون‌شدهٔ کانورت که id بازار را حفظ کرده‌اند)
 */
export function findNodeByRef(tree: any[], ref: string): any | null {
    if (!ref || !tree?.length) return null;
    const walk = (nodes: any[]): any | null => {
        for (const n of nodes) {
            if (n.refCategoryId === ref || n.categoryId === ref || n.id === ref) return n;
            if (n.children?.length) {
                const found = walk(n.children);
                if (found) return found;
            }
        }
        return null;
    };
    return walk(tree);
}