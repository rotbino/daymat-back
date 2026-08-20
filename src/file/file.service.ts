// src/file/file.service.ts
import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from './s3.service';

@Injectable()
export class FileService {
    private readonly maxFileSize = 10 * 1024 * 1024; // 10MB

    constructor(
        private prisma: PrismaService,
        private s3Service: S3Service,
    ) {}

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
        model: 'User' | 'Business' | 'Ad',
        modelId: string,
        fieldKey?: string,
    ) {
        console.log('📤 Uploading file:', file.originalname);
        console.log('📁 FieldKey:', fieldKey);
        console.log('📁 modelId:', modelId);

        if (file.size > this.maxFileSize) {
            throw new BadRequestException({
                errorCode: 'FILE_TOO_LARGE',
                message: `حجم فایل نباید از ${this.maxFileSize / 1024 / 1024} مگابایت بیشتر باشد`,
            });
        }

        const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(modelId);

        if (isValidObjectId && fieldKey) {
            try {
                await this.deleteExistingFile(userId, model, modelId, fieldKey);
            } catch (error) {
                console.warn('⚠️ Error while deleting existing file:', error.message);
            }
        }

        // آپلود به S3
        const { url, key } = await this.s3Service.uploadFile(
            {
                buffer: file.buffer,
                originalname: file.originalname,
                mimetype: file.mimetype,
            },
            userId,
            model,
            isValidObjectId ? modelId : undefined,
            fieldKey,
        );

        // ساخت تامب‌نیل
        let thumbnailUrl: string | null = null;
        const isImage = file.mimetype.startsWith('image/');

        if (isImage) {
            try {
                const sharp = require('sharp');
                const thumbnailBuffer = await sharp(file.buffer)
                    .resize(200, 200, { fit: 'cover', position: 'center' })
                    .jpeg({ quality: 90 })
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
                console.log('✅ Thumbnail uploaded to S3');
            } catch (error) {
                console.warn('⚠️ Thumbnail creation failed:', error.message);
                thumbnailUrl = null;
            }
        }

        // ذخیره در دیتابیس
        const fileRecord = await this.prisma.file.create({
            data: {
                userId,
                name: file.originalname,
                mimeType: file.mimetype,
                size: file.size,
                path: url,
                thumbnailPath: thumbnailUrl,
                relatedModel: model,
                relatedId: isValidObjectId ? modelId : null,
                fieldKey: fieldKey || null,
                metadata: {
                    s3Key: key,
                    thumbnailS3Key: thumbnailUrl ? this.s3Service.getKeyFromUrl(thumbnailUrl) : null,
                },
            },
        });

        console.log('✅ Database record created:', fileRecord.id);
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