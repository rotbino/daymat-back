//برای پاک کردن فایلهای سرگردان
// src/file/file-cleanup.service.ts
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';

@Injectable()
export class FileCleanupService {
    constructor(private prisma: PrismaService) {}

    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
    async cleanupOrphanFiles() {
        // پیدا کردن فایل‌هایی که به هیچ مدلی متصل نیستند
        // (در فاز ۲ که فیلد files را به مدل‌ها اضافه کردیم)
        console.log('🧹 Cleaning up orphan files...');
    }
}