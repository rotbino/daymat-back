//برای پاک کردن فایلهای سرگردان
// src/file/file-cleanup.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from './s3.service';

@Injectable()
export class FileCleanupService {
    private readonly logger = new Logger(FileCleanupService.name);

    /** فایل‌های استیجینگِ ایمپورت (عکس‌های اکسل که هرگز ثبت نشدند) بعد از این روزها پاک می‌شوند */
    private static readonly STAGING_TTL_DAYS = 7;

    constructor(
        private prisma: PrismaService,
        private s3: S3Service,
    ) {}

    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
    async cleanupOrphanFiles() {
        // پیدا کردن فایل‌هایی که به هیچ مدلی متصل نیستند
        // (در فاز ۲ که فیلد files را به مدل‌ها اضافه کردیم)
        console.log('🧹 Cleaning up orphan files...');

        // 🖼️ عکس‌های استیجینگِ ایمپورت — پارس شدند ولی کاربر هرگز «ثبت» نزد؛
        //    بعد از TTL از S3 و دیتابیس پاک می‌شوند تا انبار شلوغ نشود
        try {
            const cutoff = new Date(Date.now() - FileCleanupService.STAGING_TTL_DAYS * 24 * 60 * 60 * 1000);
            const stale = await this.prisma.file.findMany({
                where: { relatedModel: 'Ad', relatedId: null, fieldKey: 'import-staging', updatedAt: { lt: cutoff } },
                select: { id: true, metadata: true },
                take: 500,
            });
            let deleted = 0;
            for (const f of stale) {
                try {
                    const meta: any = f.metadata;
                    if (meta?.s3Key) await this.s3.deleteFile(meta.s3Key).catch(() => {});
                    if (meta?.thumbnailS3Key) await this.s3.deleteFile(meta.thumbnailS3Key).catch(() => {});
                    await this.prisma.file.delete({ where: { id: f.id } });
                    deleted++;
                } catch (e: any) {
                    this.logger.warn(`staging file cleanup failed (${f.id}): ${e?.message}`);
                }
            }
            if (deleted > 0) this.logger.log(`🧹 ${deleted} import-staging file(s) purged (>${FileCleanupService.STAGING_TTL_DAYS}d old)`);
        } catch (e: any) {
            this.logger.warn(`import-staging cleanup failed: ${e?.message}`);
        }
    }
}
