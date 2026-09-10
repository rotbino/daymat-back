// src/arm-admin/reference/arm-admin-reference.service.ts
// ✅ مدیریت برندها و کالاهای مرجع برای مالک بازار
// محدوده: کالا/برندهایی که از طریق همین بازار یا اعضای (فروشندگان) همین بازار ثبت شده‌اند
import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminProductService, ReferenceScope } from '../../admin/product/admin-product.service';
import { AdminBrandService } from '../../admin/brand/admin-brand.service';
import { AdminUpdateProductDto } from '../../admin/product/admin-product.dto';
import { AdminUpdateBrandDto } from '../../admin/brand/admin-brand.dto';

@Injectable()
export class ArmAdminReferenceService {
    constructor(
        private prisma: PrismaService,
        private adminProductService: AdminProductService,
        private adminBrandService: AdminBrandService,
    ) {}

    // ────────────────────────────────────────────────
    // ساخت محدودهٔ بازار: armId + شناسهٔ همهٔ اعضای فعال بازار
    // ────────────────────────────────────────────────
    async buildScope(armId: string): Promise<ReferenceScope> {
        const memberships = await this.prisma.armMembership.findMany({
            where: { armId, status: 'active' },
            select: { userId: true },
        });
        return { armId, memberUserIds: memberships.map((m) => m.userId) };
    }

    // ────────────────────────────────────────────────
    // بررسی تعلق یک کالای مرجع به محدودهٔ بازار (برای ویرایش/حذف)
    // ────────────────────────────────────────────────
    private async assertProductInScope(productId: string, scope: ReferenceScope) {
        const row = await this.prisma.productReference.findUnique({
            where: { id: productId },
            select: { id: true, armId: true, createdByUserId: true },
        });
        if (!row) return; // findOne بعداً PRODUCT_NOT_FOUND می‌دهد
        const inScope =
            (scope.armId && row.armId === scope.armId) ||
            (row.createdByUserId && scope.memberUserIds?.includes(row.createdByUserId));
        if (!inScope) {
            throw new ForbiddenException({ errorCode: 'OUT_OF_SCOPE', message: 'این کالای مرجع به بازار شما تعلق ندارد' });
        }
    }

    private async assertBrandInScope(brandId: string, scope: ReferenceScope) {
        const row = await this.prisma.brand.findUnique({
            where: { id: brandId },
            select: { id: true, armId: true, createdByUserId: true },
        });
        if (!row) return;
        const inScope =
            (scope.armId && row.armId === scope.armId) ||
            (row.createdByUserId && scope.memberUserIds?.includes(row.createdByUserId));
        if (!inScope) {
            throw new ForbiddenException({ errorCode: 'OUT_OF_SCOPE', message: 'این برند به بازار شما تعلق ندارد' });
        }
    }

    // ────────────────────────────────────────────────
    // کالاهای مرجع
    // ────────────────────────────────────────────────
    async getProducts(armId: string, filters: any) {
        const scope = await this.buildScope(armId);
        return this.adminProductService.findAll(filters, scope);
    }

    async getProduct(armId: string, id: string) {
        const scope = await this.buildScope(armId);
        return this.adminProductService.findOne(id, scope);
    }

    async getProductAds(armId: string, id: string, page: number, limit: number) {
        const scope = await this.buildScope(armId);
        await this.adminProductService.findOne(id, scope); // فقط برای چک محدوده
        return this.adminProductService.getAds(id, page, limit);
    }

    async updateProduct(armId: string, id: string, dto: AdminUpdateProductDto) {
        const scope = await this.buildScope(armId);
        await this.assertProductInScope(id, scope);
        return this.adminProductService.update(id, dto);
    }

    async removeProduct(armId: string, id: string) {
        const scope = await this.buildScope(armId);
        await this.assertProductInScope(id, scope);
        return this.adminProductService.remove(id);
    }

    // ────────────────────────────────────────────────
    // برندها
    // ────────────────────────────────────────────────
    async getBrands(armId: string, filters: any) {
        const scope = await this.buildScope(armId);
        return this.adminBrandService.findAll(filters, scope);
    }

    async getBrand(armId: string, id: string) {
        const scope = await this.buildScope(armId);
        return this.adminBrandService.findOne(id, scope);
    }

    async getBrandAds(armId: string, id: string, page: number, limit: number) {
        const scope = await this.buildScope(armId);
        await this.adminBrandService.findOne(id, scope); // فقط برای چک محدوده
        return this.adminBrandService.getAds(id, page, limit);
    }

    async getBrandProducts(armId: string, id: string, page: number, limit: number) {
        const scope = await this.buildScope(armId);
        await this.adminBrandService.findOne(id, scope); // فقط برای چک محدوده
        return this.adminBrandService.getProducts(id, page, limit);
    }

    async updateBrand(armId: string, id: string, dto: AdminUpdateBrandDto) {
        const scope = await this.buildScope(armId);
        await this.assertBrandInScope(id, scope);
        return this.adminBrandService.update(id, dto);
    }

    async removeBrand(armId: string, id: string) {
        const scope = await this.buildScope(armId);
        await this.assertBrandInScope(id, scope);
        return this.adminBrandService.remove(id);
    }
}
