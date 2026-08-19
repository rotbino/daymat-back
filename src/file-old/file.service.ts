// src/file/file.service.ts
import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';

// ✅ استفاده از require برای sharp
const sharp = require('sharp');

@Injectable()
export class FileService {
    private readonly uploadDir: string;
    private readonly maxFileSize = 10 * 1024 * 1024; // 10MB

    constructor(private prisma: PrismaService) {
        this.uploadDir = path.join(process.cwd(), 'uploads');
        this.init();
    }

    private async init() {
        try {
            await fs.mkdir(this.uploadDir, { recursive: true });
            console.log('✅ Upload directory created:', this.uploadDir);
        } catch (error) {
            console.error('❌ Failed to create upload directory:', error);
        }
    }

    // ============================================================
    // آپلود فایل با تامب‌نیل
    // ============================================================
    // src/file/file.service.ts

    // src/file/file.service.ts

    // src/file/file.service.ts

    // src/file/file.service.ts

// ============================================================
// اصلاح متد uploadFile - برای پذیرش modelId="temp" یا "manual"
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

        // ۱. بررسی حجم
        if (file.size > this.maxFileSize) {
            throw new BadRequestException({
                errorCode: 'FILE_TOO_LARGE',
                message: `حجم فایل نباید از ${this.maxFileSize / 1024 / 1024} مگابایت بیشتر باشد`,
            });
        }

        // ✅ ۲. بررسی اعتبار ObjectId
        const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(modelId);

        // ✅ ۳. حذف فایل قبلی (فقط اگر modelId معتبر باشد)
        if (isValidObjectId && fieldKey) {
            try {
                await this.deleteExistingFile(userId, model, modelId, fieldKey);
            } catch (error) {
                console.warn('⚠️ Error while deleting existing file:', error.message);
            }
        } else {
            console.log('ℹ️ Skipping existing file deletion (modelId is temporary or invalid)');
        }

        // ۴. ایجاد فولدر کاربر
        const userFolder = path.join(this.uploadDir, 'users', userId);
        await fs.mkdir(userFolder, { recursive: true });

        // ۵. نام فایل
        const ext = path.extname(file.originalname);
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}${ext}`;
        const filePath = path.join(userFolder, fileName);
        console.log('📄 New file path:', filePath);

        // ۶. ذخیره فایل
        await fs.writeFile(filePath, file.buffer);
        console.log('✅ File saved successfully');

        // ۷. ساخت تامب‌نیل
        let thumbnailPath: string | null = null;
        const isImage = file.mimetype.startsWith('image/');

        if (isImage) {
            try {
                const sharp = require('sharp');
                const thumbFileName = `thumb-${fileName}`;
                const thumbPath = path.join(userFolder, thumbFileName);

                console.log('🖼️ Creating thumbnail...');
                await sharp(file.buffer)
                    .resize(100, 100, {
                        fit: 'cover',
                        position: 'center'
                    })
                    .jpeg({ quality: 60 })
                    .toFile(thumbPath);

                thumbnailPath = thumbPath;
                console.log('✅ Thumbnail created:', thumbPath);
            } catch (error) {
                console.warn('⚠️ Thumbnail creation failed:', error.message);
                thumbnailPath = null;
            }
        }

        // ✅ ۸. ذخیره در دیتابیس - اگر modelId نامعتبر بود، relatedId رو null بذار
        const fileRecord = await this.prisma.file.create({
            data: {
                userId,
                name: file.originalname,
                mimeType: file.mimetype,
                size: file.size,
                path: filePath,
                thumbnailPath: thumbnailPath,
                relatedModel: model,
                relatedId: isValidObjectId ? modelId : null,  // ✅ تغییر اینجا
                fieldKey: fieldKey || null,
            },
        });

        console.log('✅ Database record created:', fileRecord.id);
        return fileRecord;
    }

    // src/file/file.service.ts

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
            console.log('📁 Path:', existingFile.path);
            console.log('📁 Thumbnail:', existingFile.thumbnailPath);

            // ✅ حذف فایل فیزیکی
            let fileDeleted = false;
            let thumbDeleted = false;

            try {
                if (existingFile.path && existsSync(existingFile.path)) {
                    await fs.unlink(existingFile.path);
                    console.log('✅ File deleted from disk:', existingFile.path);
                    fileDeleted = true;
                } else {
                    console.log('⚠️ File not found on disk:', existingFile.path);
                }
            } catch (error) {
                console.error('❌ Error deleting file:', error.message);
            }

            try {
                if (existingFile.thumbnailPath && existsSync(existingFile.thumbnailPath)) {
                    await fs.unlink(existingFile.thumbnailPath);
                    console.log('✅ Thumbnail deleted from disk:', existingFile.thumbnailPath);
                    thumbDeleted = true;
                }
            } catch (error) {
                console.error('❌ Error deleting thumbnail:', error.message);
            }

            // ✅ حذف از دیتابیس (حتی اگر فایل فیزیکی وجود نداشت)
            await this.prisma.file.delete({
                where: { id: existingFile.id },
            });
            console.log('✅ Old file record deleted from database');

            return { fileDeleted, thumbDeleted };
        } else {
            console.log('ℹ️ No existing file found with key:', fieldKey);
            return null;
        }
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

        if (!filePath || !existsSync(filePath)) {
            throw new NotFoundException({
                errorCode: 'FILE_NOT_FOUND',
                message: 'فایل روی دیسک یافت نشد',
            });
        }

        return {
            stream: require('fs').createReadStream(filePath),
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

        try {
            if (existsSync(file.path)) {
                await fs.unlink(file.path);
            }
            if (file.thumbnailPath && existsSync(file.thumbnailPath)) {
                await fs.unlink(file.thumbnailPath);
            }
        } catch (error) {
            console.warn('⚠️ Could not delete file:', error.message);
        }

        await this.prisma.file.delete({
            where: { id: fileId },
        });

        return { message: 'فایل با موفقیت حذف شد' };
    }

    // src/file/file.service.ts

// ============================================================
// پاکسازی فایل‌های سرگردان (فایل‌هایی که در دیتابیس نیستند)
// ============================================================
    async cleanupOrphanFiles() {
        console.log('🧹 Starting cleanup of orphan files...');

        const userFolder = path.join(this.uploadDir, 'users');
        if (!existsSync(userFolder)) {
            console.log('📁 No users folder found');
            return { deleted: 0, errors: 0 };
        }

        // دریافت همه فایل‌های موجود در دیتابیس
        const allFiles = await this.prisma.file.findMany({
            select: { path: true, thumbnailPath: true }
        });

        const validPaths = new Set();
        allFiles.forEach(file => {
            if (file.path) validPaths.add(file.path);
            if (file.thumbnailPath) validPaths.add(file.thumbnailPath);
        });

        console.log(`📊 Found ${validPaths.size} valid file paths in database`);

        let deletedCount = 0;
        let errorCount = 0;

        // اسکن فولدر کاربران
        const userDirs = await fs.readdir(userFolder).catch(() => []);

        for (const userDir of userDirs) {
            const userPath = path.join(userFolder, userDir);
            const stats = await fs.stat(userPath).catch(() => null);
            if (!stats || !stats.isDirectory()) continue;

            const files = await fs.readdir(userPath).catch(() => []);
            for (const file of files) {
                const filePath = path.join(userPath, file);
                // اگر فایل در دیتابیس نبود، حذفش کن
                if (!validPaths.has(filePath)) {
                    try {
                        await fs.unlink(filePath);
                        console.log(`🗑️ Deleted orphan file: ${filePath}`);
                        deletedCount++;
                    } catch (error) {
                        console.error(`❌ Error deleting ${filePath}:`, error.message);
                        errorCount++;
                    }
                }
            }
        }

        console.log(`✅ Cleanup complete: ${deletedCount} files deleted, ${errorCount} errors`);
        return { deleted: deletedCount, errors: errorCount };
    }

    async updateFileRelatedId(fileId: string, modelId: string) {
        return this.prisma.file.update({
            where: { id: fileId },
            data: { relatedId: modelId },
        });
    }
}