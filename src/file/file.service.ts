// src/file/file.service.ts
import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from './s3.service';
import { CacheHelper } from '../common/services/cache.helper';

@Injectable()
export class FileService {
    private readonly maxFileSize = 10 * 1024 * 1024; // 10MB

    constructor(
        private prisma: PrismaService,
        private s3Service: S3Service,
        private cache: CacheHelper,
    ) {}

    // ============================================================
    // ✅ حذف همهٔ فایل‌های قبلیِ یک fieldKey — برای جلوگیری از انباشت
    //    فقط User و Catalog (سمنتیک تک‌فایلی).
    //    Ad مستثناست — چند عکس برای هر آگهی عمدی است.
    //    keepId: رکورد تازه‌ساخته‌شده حذف نشود.
    //    S3 best-effort؛ رکورد DB همیشه حذف می‌شود.
    // ============================================================
    private async deleteExistingFiles(
        userId: string,
        model: 'User' | 'Business' | 'Catalog' | 'Ad' | 'ProductReference' | 'Brand',
        modelId: string | null,
        fieldKey: string,
        keepId?: string,
    ): Promise<number> {
        if (model === 'Ad') return 0; // آگهی چند-فایلی است — دست نمی‌زنیم

        const where: any = { userId, relatedModel: model, fieldKey };
        // Business/Catalog: هر نهاد لوگوی خودش — با relatedId جدا کنیم
        // (کاربر ممکن است چند بیزنس/کاتالوگ داشته باشد)
        if ((model === 'Catalog' || model === 'Business') && modelId) {
            where.relatedId = modelId;
        }

        const existing = await this.prisma.file.findMany({
            where,
            select: { id: true, metadata: true },
        });

        let deleted = 0;
        for (const f of existing) {
            if (keepId && f.id === keepId) continue;
            try {
                const meta: any = f.metadata;
                if (meta?.s3Key) await this.s3Service.deleteFile(meta.s3Key).catch(() => {});
                if (meta?.thumbnailS3Key) await this.s3Service.deleteFile(meta.thumbnailS3Key).catch(() => {});
            } catch (e: any) {
                console.warn('⚠️ S3 cleanup of old file failed (non-blocking):', e.message);
            }
            await this.prisma.file.delete({ where: { id: f.id } });
            deleted++;
        }
        if (deleted > 0) console.log(`🗑️ ${deleted} old file(s) removed [${model}/${fieldKey}]`);
        return deleted;
    }

    // ============================================================
    // ✅ همگام‌سازی فیلد تصویر روی رکورد مالک —
    //    User.avatarUrl / Catalog.logoUrl / ProductReference.imageUrl همیشه تصویر تازه را نشان دهند
    // ============================================================
    private async syncOwnerImageField(
        model: 'User' | 'Business' | 'Catalog' | 'Ad' | 'ProductReference' | 'Brand',
        modelId: string | null,
        fieldKey: string | undefined,
        imageUrl: string,
    ): Promise<void> {
        try {
            if (model === 'User' && fieldKey === 'avatar') {
                await this.prisma.user.update({
                    where: { id: modelId },
                    data: { avatarUrl: imageUrl },
                });
            } else if (model === 'Business' && fieldKey === 'logo' && modelId) {
                // ✅ لوگوی کسب‌وکار — ریشهٔ باگ «لوگو ست می‌شود ولی نشان داده نمی‌شد»:
                //    Business.logoUrl قبلاً هرگز sync نمی‌شد
                await this.prisma.business.update({
                    where: { id: modelId },
                    data: { logoUrl: imageUrl },
                });
            } else if (model === 'Catalog' && fieldKey === 'logo' && modelId) {
                await this.prisma.catalog.update({
                    where: { id: modelId },
                    data: { logoUrl: imageUrl },
                });
            } else if (model === 'ProductReference' && modelId) {
                await this.prisma.productReference.update({
                    where: { id: modelId },
                    data: { imageUrl, thumbnailUrl: imageUrl },
                }).catch(() => {});
            }
        } catch (e: any) {
            console.warn('⚠️ Owner image field sync failed (non-blocking):', e.message);
        }
    }

    // ============================================================
    // ✅ باطل‌سازی کش‌های وابسته به تصویر نهادها —
    //    لوگو/آواتار عوض شد → لیست کاتالوگ‌های مالک، صفحهٔ عمومی کاتالوگ
    //    و ویترین بازار باید فوراً تازه شوند (نه تا پایان TTL کش)
    // ============================================================
    private async bustOwnerCaches(
        model: 'User' | 'Business' | 'Catalog' | 'Ad' | 'ProductReference' | 'Brand',
        modelId: string | null,
        userId: string,
    ): Promise<void> {
        try {
            if (model === 'Business' && modelId) {
                await this.cache.bust(`my-catalogs:${userId}`);
            } else if (model === 'Catalog' && modelId) {
                const cat = await this.prisma.catalog.findUnique({
                    where: { id: modelId },
                    select: { slug: true },
                });
                await this.cache.bust(`my-catalogs:${userId}`);
                if (cat?.slug) await this.cache.bust(`catalog-slug:${cat.slug}`);
            } else if (model === 'Ad' && modelId) {
                // عکس آگهی در ویترین/صفحهٔ آگهی دیده می‌شود
                await this.cache.bust(`vitrine`);
            }
        } catch (e: any) {
            console.warn('⚠️ Owner cache bust failed (non-blocking):', e.message);
        }
    }

    // ============================================================
    // آپلود فایل با S3
    // ============================================================
    async uploadFile(
        userId: string,
        file: {
            buffer: Buffer;
            originalname: string;
            mimetype: string;
            size: number;
        },
        model: 'User' | 'Business' | 'Catalog' | 'Ad' | 'ProductReference' | 'Brand',
        modelId: string,
        fieldKey?: string,
    ) {
        if (file.size > this.maxFileSize) {
            throw new BadRequestException({
                errorCode: 'FILE_TOO_LARGE',
                message: `حجم فایل نباید از ${this.maxFileSize / 1024 / 1024} مگابایت بیشتر باشد`,
            });
        }
        const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(modelId);
        let finalBuffer = file.buffer;
        let finalMimetype = file.mimetype;
        let finalSize = file.size;

        const isImage = file.mimetype.startsWith('image/');

        if (isImage) {
            try {
                const sharp = require('sharp');
                const optimizedBuffer = await sharp(file.buffer)
                    .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
                    .jpeg({ quality: 85 })
                    .toBuffer();
                finalBuffer = optimizedBuffer;
                finalMimetype = 'image/jpeg';
                finalSize = optimizedBuffer.length;
                console.log(`✅ Image compressed: ${(file.size / 1024 / 1024).toFixed(2)}MB → ${(finalSize / 1024).toFixed(1)}KB`);
            } catch (error) {
                console.warn('⚠️ Compression failed, using original:', error.message);
            }
        }

        // ۱) آپلود به S3 با فایل فشرده
        const { url, key } = await this.s3Service.uploadFile(
            { buffer: finalBuffer, originalname: file.originalname, mimetype: finalMimetype },
            userId,
            model,
            isValidObjectId ? modelId : undefined,
            fieldKey,
        );

        // ۲) تامبنیل
        let thumbnailUrl: string | null = null;
        if (isImage) {
            try {
                const sharp = require('sharp');
                const thumbnailBuffer = await sharp(finalBuffer)
                    .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
                    .jpeg({ quality: 80 })
                    .toBuffer();
                const thumbResult = await this.s3Service.uploadFile(
                    { buffer: thumbnailBuffer, originalname: `thumb-${file.originalname}`, mimetype: 'image/jpeg' },
                    userId,
                    model,
                    isValidObjectId ? modelId : undefined,
                    fieldKey ? `thumb-${fieldKey}` : 'thumbnail',
                );
                thumbnailUrl = thumbResult.url;
            } catch (error) {
                console.warn('⚠️ Thumbnail failed:', error.message);
            }
        }

        // ۳) ذخیره در دیتابیس
        const fileRecord = await this.prisma.file.create({
            data: {
                userId,
                name: file.originalname,
                mimeType: finalMimetype,
                size: finalSize,
                path: url,
                thumbnailPath: thumbnailUrl,
                relatedModel: model,
                relatedId: isValidObjectId ? modelId : null,
                fieldKey: fieldKey || null,
                metadata: {
                    s3Key: key,
                    originalSize: file.size,
                    thumbnailS3Key: thumbnailUrl ? this.s3Service.getKeyFromUrl(thumbnailUrl) : null,
                },
            },
        });

        // ۴) ✅ حذف قبلی‌ها — بعد از موفقیتِ آپلود جدید
        //    (اگر آپلود جدید شکست بخورد، عکس قبلی کاربر از دست نمی‌رود)
        if (fieldKey) {
            await this.deleteExistingFiles(
                userId,
                model,
                isValidObjectId ? modelId : null,
                fieldKey,
                fileRecord.id,
            );
        }

        // ۴.۵) ✅ تصویر واقعی کاربر برای آگهی آپلود شد → تصویر جایگزینِ مرجع (ad-image-ref) حذف شود
        //       (بک‌اند موقع ساخت آگهی از مرجع، تصویر مرجع را به‌عنوان پیش‌فرض می‌نشیند — عکس خودِ کاربر اولویت دارد)
        if (model === 'Ad' && isValidObjectId && fieldKey?.startsWith('ad-image') && fieldKey !== 'ad-image-ref') {
            await this.prisma.file.deleteMany({
                where: { relatedModel: 'Ad', relatedId: modelId, fieldKey: 'ad-image-ref' },
            });
        }

        // ۵) ✅ همگام‌سازی User.avatarUrl / Business.logoUrl / Catalog.logoUrl
        await this.syncOwnerImageField(
            model,
            isValidObjectId ? modelId : null,
            fieldKey,
            thumbnailUrl || url,
        );

        // ⚠️ کش پروفایل: آواتار/فایل کاربر عوض شد → پروفایل فوراً تازه شود
        if (model === 'User' && isValidObjectId) {
            await this.cache.bust(`profile:${modelId}`);
        }

        // ⚠️ کش نهادها: لوگوی Business/Catalog و عکس Ad در لیست‌ها/صفحات کش‌شده دیده می‌شوند
        await this.bustOwnerCaches(model, isValidObjectId ? modelId : null, userId);

        return fileRecord;
    }

    // ============================================================
    // دریافت فایل
    // ============================================================
    async getFile(fileId: string, thumbnail: boolean = false) {
        const file = await this.prisma.file.findUnique({ where: { id: fileId } });
        if (!file) {
            throw new NotFoundException({ errorCode: 'FILE_NOT_FOUND', message: 'فایل یافت نشد' });
        }
        const filePath = thumbnail && file.thumbnailPath ? file.thumbnailPath : file.path;
        if (!filePath) {
            throw new NotFoundException({ errorCode: 'FILE_NOT_FOUND', message: 'فایل در فضای ابری یافت نشد' });
        }
        return { url: filePath, mimeType: thumbnail ? 'image/jpeg' : file.mimeType, size: file.size, name: file.name };
    }

    // ============================================================
    // حذف فایل
    // ============================================================
    async deleteFile(userId: string, fileId: string) {
        const file = await this.prisma.file.findUnique({ where: { id: fileId } });
        if (!file) {
            throw new NotFoundException({ errorCode: 'FILE_NOT_FOUND', message: 'فایل یافت نشد' });
        }
        if (file.userId !== userId) {
            throw new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'شما اجازه حذف این فایل را ندارید' });
        }
        const metadata = (file as any).metadata;
        if (metadata?.s3Key) await this.s3Service.deleteFile(metadata.s3Key);
        if (metadata?.thumbnailS3Key) await this.s3Service.deleteFile(metadata.thumbnailS3Key);
        await this.prisma.file.delete({ where: { id: fileId } });

        // ⚠️ فایل کاربر حذف شد → کش پروفایلش باطل (آواتار در پروفایل می‌آید)
        if (file.relatedModel === 'User' && file.relatedId) {
            await this.cache.bust(`profile:${file.relatedId}`);
        }
        // ⚠️ لوگو/عکس نهادها هم در لیست‌های کش‌شده می‌آیند → باطل
        if (['Business', 'Catalog', 'Ad'].includes(file.relatedModel)) {
            await this.bustOwnerCaches(
                file.relatedModel as 'Business' | 'Catalog' | 'Ad',
                file.relatedId,
                userId,
            );
        }

        return { message: 'فایل با موفقیت حذف شد' };
    }

    async cleanupOrphanFiles() {
        console.log('🧹 Starting cleanup of orphan files...');
        return { deleted: 0, errors: 0, message: 'Cleanup for S3 is not implemented yet' };
    }

    async updateFileRelatedId(fileId: string, modelId: string) {
        return this.prisma.file.update({ where: { id: fileId }, data: { relatedId: modelId } });
    }
}