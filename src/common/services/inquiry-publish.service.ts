// src/common/services/inquiry-publish.service.ts
// ========================================================================
// موتور انتشار تابلوی خرید در بازار — قرینهٔ CatalogPublishService (سمت خرید)
//   فروش: Catalog → Ad → AdPublication
//   خرید: تابلوی خرید (Inquiry) → اقلام فوری (InquiryItem urgent) → InquiryPublication
// یک دفتر می‌تواند همزمان در چند بازار منتشر باشد — هر بازار وضعیت خودش را دارد.
// ========================================================================
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const logger = new Logger('InquiryPublishService');

@Injectable()
export class InquiryPublishService {
    constructor(private prisma: PrismaService) {}

    /**
     * انتشار دفتر خرید در یک بازار — upsert روی (inquiryId, armId)
     * forceRepublish = publish صریح دوباره → انصراف قبلی (optOut) لغو می‌شود
     */
    async publishInquiry(
        armId: string,
        inquiryId: string,
        publishedBy?: string,
        forceRepublish = false,
    ) {
        const pub = await this.prisma.inquiryPublication.upsert({
            where: { inquiryId_armId: { inquiryId, armId } },
            create: {
                inquiryId,
                armId,
                status: 'published',
                publishedBy,
                optOut: false,
            },
            update: {
                status: 'published',
                publishedBy,
                unpublishedAt: null,
                ...(forceRepublish ? { optOut: false } : {}),
                updatedAt: new Date(),
            },
        });
        logger.log(`Published inquiry ${inquiryId} in arm ${armId} (status: ${pub.status})`);
        return pub;
    }

    /**
     * توقف انتشار دفتر در یک بازار — حذف نرم (status=unpublished) تا وضعیت دسته‌بندیِ
     * بازاری برای برگشت بعدی حفظ شود؛ تابلوی خریداران فقط status=published را می‌بیند
     */
    async unpublishInquiry(inquiryId: string, armId: string, opts: { optOut?: boolean } = {}) {
        const pub = await this.prisma.inquiryPublication.updateMany({
            where: { inquiryId, armId, status: { in: ['published', 'paused', 'needs_category'] } },
            data: {
                status: 'unpublished',
                unpublishedAt: new Date(),
                updatedAt: new Date(),
                ...(opts.optOut ? { optOut: true } : {}),
            },
        });
        logger.log(`Unpublished (soft) inquiry ${inquiryId} from arm ${armId} (${pub.count} rows)`);
        return pub;
    }

    /**
     * تغییر وضعیت همهٔ publicationهای یک دفتر در یک بازار — برای مکث/فعال‌سازی خریدار توسط مدیر
     * (قرینهٔ CatalogPublishService.setPublicationsStatus — دسته‌بندی و optOut حفظ می‌شود)
     */
    async setPublicationsStatus(inquiryId: string, armId: string, status: 'paused' | 'published'): Promise<void> {
        await this.prisma.inquiryPublication.updateMany({
            where: { inquiryId, armId, optOut: false, status: { in: ['published', 'paused'] } },
            data: {
                status,
                ...(status === 'paused' ? { unpublishedAt: new Date() } : { unpublishedAt: null }),
                updatedAt: new Date(),
            },
        });
        logger.log(`Inquiry publications of ${inquiryId} in arm ${armId} → ${status}`);
    }

    /**
     * دفترهای منتشرشدهٔ یک بازوی خرید و بازارهایشان — برای تب «انتشار» پنل بازوی خرید
     * (قرینهٔ getCatalogPublications)
     */
    async getInquiryPublications(inquiryId: string) {
        return this.prisma.inquiryPublication.findMany({
            where: { inquiryId, status: { in: ['published', 'paused', 'needs_category'] } },
            include: {
                arm: {
                    select: {
                        id: true,
                        slug: true,
                        name: true,
                        icon: true,
                        colorPrimary: true,
                    },
                },
            },
            orderBy: { publishedAt: 'desc' },
        });
    }
}
