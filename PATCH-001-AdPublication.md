# PATCH-001: AdPublication — انتشار آگهی در چند بازار

**تاریخ:** 2026-09-06
**هدف:** اجازه دادن به یک آگهی برای انتشار همزمان در چند بازار

## 📋 تغییرات

### Schema
- اضافه شد: مدل `AdPublication` با `@@unique([adId, armId])`
- relation `publications` به `Ad`
- relation `adPublications` به `Arm`

### استراتژی (راه A - snapshot + deprecate)
- فیلدهای `Ad.armId`, `Ad.categoryId`, `Ad.categoryPath` به‌عنوان **cache** نگه داشته می‌شوند
- منبع حقیقت به `AdPublication` منتقل می‌شود
- `stampCatalogAds` هر دو را آپدیت می‌کند
- در فاز بعدی (PATCH-002)، فیلدهای snapshot حذف می‌شوند

### فایل‌های تغییر یافته

#### Backend
| فایل | تغییر |
|---|---|
| `prisma/schema.prisma` | اضافه شدن `AdPublication` model + relations |
| `prisma/scripts/migrate-001-ad-publication.ts` | 🆕 اسکریپت migration (idempotent) |
| `prisma/seed/seed-units.ts` | 🆕 سید ۱۰۹ واحد در ۱۴ دسته‌بندی |
| `src/common/services/catalog-publish.service.ts` | بازنویسی کامل با transaction |
| `src/ad/ad.service.ts` | create/update/bump آپدیت + ۳ متد جدید |
| `src/ad/ad.controller.ts` | 🆕 ۳ endpoint جدید |
| `src/arm/arm.service.ts` | toggleCatalogPublish: ارسال userId |

#### Frontend
| فایل | تغییر |
|---|---|
| `app/my-catalogs/PublishToMarketModal.tsx` | 🆕 مودال مدیریت انتشار در بازارها |
| `app/my-catalogs/MyCatalogsContent.tsx` | دکمه «بازار دیگر» در product row |
| `lib/api/apiService.ts` | 🆕 ۳ متد جدید در ad object |

## 🚀 نحوه اجرا روی Production

### ۱) Pull
```bash
cd daymat-back && git pull origin main
cd daymat-web && git pull origin main
```

### ۲) Push schema به دیتابیس
```bash
cd daymat-back
npx prisma db push
npx prisma generate
```

### ۳) اجرای migration script
```bash
npx tsx prisma/scripts/migrate-001-ad-publication.ts
```

### ۴) (اختیاری) سید واحدها
```bash
npx tsx prisma/seed/seed-units.ts
```

### ۵) Build و deploy
```bash
npm run build
# deploy به Vercel
```

## 🆕 Endpoint های جدید

```
GET  /ad/:id/publications              → لیست بازارهای آگهی
POST /ad/:id/publish-to-market         → انتشار در بازار جدید
DELETE /ad/:id/publish-to-market/:slug → حذف از یک بازار
```

## 🧪 نحوه تست در UI

۱. وارد پنل کاربری شوید → «کاتالوگ‌های من»
۲. یک کاتالوگ با آگهی فعال انتخاب کنید
۳. روی آگهی که در تابلو هست، دکمه **«بازار دیگر»** (با آیکون Store) کلیک کنید
۴. مودال باز می‌شود:
   - بخش بالا: لیست بازارهای فعلی آگهی (با امکان حذف)
   - بخش پایین: لیست بازارهای قابل افزودن
۵. روی یک بازار کلیک کنید → آگهی منتشر می‌شود
۶. اگه بازار دسته‌بندی نداشت، هشدار «نیاز به انتخاب دسته» می‌آید

## ⚠️ نکات مهم

### Backward Compatibility
- تمام endpoint های قبلی کار می‌کنند
- `getVitrine` و `findOne` فعلاً از `Ad.armId` (snapshot) می‌خونن
- در PATCH-002 به `AdPublication` join می‌شن

### محدودیت‌های فعلی
- `bump` فقط در یک بازار (آخرین published) اعمال می‌شود
- `getContactInfo` بر اساس `ad.armId` تصمیم می‌گیره
