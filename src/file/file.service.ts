// src/file/file.service.ts
import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from './s3.service';

@Injectable()
export class FileService {
    private readonly maxFileSize = 10 * 1024 * 1024; // ✅ محدودیت آپلود: 10MB

    constructor(
        private prisma: PrismaService,
        private s3Service: S3Service,
    ) {}

    // ============================================================
    // آپلود فایل با S3
    // ============================================================
    // src/file/file.service.ts



    async uploadFile(
        userId: string,
        file: {
            buffer: Buffer;
            originalname: string;
            mimetype: string;
            size: number;
        },
        model: 'User' | 'Business' | 'Ad',
        modelId: string,
        fieldKey?: string,
    ) {
        // ✅ ۱. اگر حجم بیشتر از ۱۰MB است → خطا
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

                // ✅ ۲. فشرده‌سازی با حداکثر ابعاد
                const optimizedBuffer = await sharp(file.buffer)
                    .resize(1280, 1280, {
                        fit: 'inside',
                        withoutEnlargement: true
                    })
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

        // ✅ ۳. آپلود به S3 با فایل فشرده
        const { url, key } = await this.s3Service.uploadFile(
            {
                buffer: finalBuffer,
                originalname: file.originalname,
                mimetype: finalMimetype,
            },
            userId,
            model,
            isValidObjectId ? modelId : undefined,
            fieldKey,
        );

        // ✅ ۴. تامبنیل
        let thumbnailUrl: string | null = null;
        if (isImage) {
            try {
                const sharp = require('sharp');
                const thumbnailBuffer = await sharp(finalBuffer) // ✅ از فایل فشرده
                    .resize(400, 400, {
                        fit: 'inside',
                        withoutEnlargement: true
                    })
                    .jpeg({ quality: 80 })
                    .toBuffer();

                const thumbResult = await this.s3Service.uploadFile(
                    {
                        buffer: thumbnailBuffer,
                        originalname: `thumb-${file.originalname}`,
                        mimetype: 'image/jpeg',
                    },
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

        // ✅ ۵. ذخیره در دیتابیس با حجم فشرده
        const fileRecord = await this.prisma.file.create({
            data: {
                userId,
                name: file.originalname,
                mimeType: finalMimetype,
                size: finalSize, // ✅ حجم فشرده‌شده
                path: url,
                thumbnailPath: thumbnailUrl,
                relatedModel: model,
                relatedId: isValidObjectId ? modelId : null,
                fieldKey: fieldKey || null,
                metadata: {
                    s3Key: key,
                    originalSize: file.size, // ✅ حجم اصلی برای مقایسه
                    thumbnailS3Key: thumbnailUrl ? this.s3Service.getKeyFromUrl(thumbnailUrl) : null,
                },
            },
        });

        return fileRecord;
    }

    // ============================================================
    // حذف فایل قبلی
    // ============================================================
    private async deleteExistingFile(
        userId: string,
        model: string,
        modelId: string,
        fieldKey: string,
    ) {
        const existingFile = await this.prisma.file.findFirst({
            where: {
                userId,
                relatedModel: model,
                relatedId: modelId,
                fieldKey: fieldKey,
            },
        });

        if (existingFile) {
            console.log('🗑️ Found existing file:', existingFile.id);

            const metadata = (existingFile as any).metadata;
            if (metadata?.s3Key) {
                await this.s3Service.deleteFile(metadata.s3Key);
                console.log('✅ File deleted from S3');
            }
            if (metadata?.thumbnailS3Key) {
                await this.s3Service.deleteFile(metadata.thumbnailS3Key);
                console.log('✅ Thumbnail deleted from S3');
            }

            await this.prisma.file.delete({ where: { id: existingFile.id } });
            console.log('✅ Old file record deleted from database');
            return true;
        }
        return false;
    }

    // ============================================================
    // دریافت فایل
    // ============================================================
    async getFile(fileId: string, thumbnail: boolean = false) {
        const file = await this.prisma.file.findUnique({
            where: { id: fileId },
        });

        if (!file) {
            throw new NotFoundException({
                errorCode: 'FILE_NOT_FOUND',
                message: 'فایل یافت نشد',
            });
        }

        const filePath = thumbnail && file.thumbnailPath ? file.thumbnailPath : file.path;

        if (!filePath) {
            throw new NotFoundException({
                errorCode: 'FILE_NOT_FOUND',
                message: 'فایل در فضای ابری یافت نشد',
            });
        }

        return {
            url: filePath,
            mimeType: thumbnail ? 'image/jpeg' : file.mimeType,
            size: file.size,
            name: file.name,
        };
    }

    // ============================================================
    // حذف فایل
    // ============================================================
    async deleteFile(userId: string, fileId: string) {
        const file = await this.prisma.file.findUnique({
            where: { id: fileId },
        });

        if (!file) {
            throw new NotFoundException({
                errorCode: 'FILE_NOT_FOUND',
                message: 'فایل یافت نشد',
            });
        }

        if (file.userId !== userId) {
            throw new ForbiddenException({
                errorCode: 'FORBIDDEN',
                message: 'شما اجازه حذف این فایل را ندارید',
            });
        }

        const metadata = (file as any).metadata;
        if (metadata?.s3Key) {
            await this.s3Service.deleteFile(metadata.s3Key);
        }
        if (metadata?.thumbnailS3Key) {
            await this.s3Service.deleteFile(metadata.thumbnailS3Key);
        }

        await this.prisma.file.delete({ where: { id: fileId } });
        return { message: 'فایل با موفقیت حذف شد' };
    }

    // ============================================================
    // پاکسازی فایل‌های سرگردان
    // ============================================================
    async cleanupOrphanFiles() {
        console.log('🧹 Starting cleanup of orphan files...');
        return { deleted: 0, errors: 0, message: 'Cleanup for S3 is not implemented yet' };
    }

    // ============================================================
    // به‌روزرسانی relatedId
    // ============================================================
    async updateFileRelatedId(fileId: string, modelId: string) {
        return this.prisma.file.update({
            where: { id: fileId },
            data: { relatedId: modelId },
        });
    }
}