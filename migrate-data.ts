// migrate-data.ts
import { MongoClient } from 'mongodb';
import 'dotenv/config'; // اگر از فایل env استفاده می‌کنید

// ============================================================
// 🔴 اطلاعات واقعی خود را اینجا وارد کنید
// ============================================================
// راه اول: مستقیم در کد (ساده‌تر برای تست)
const USERNAME = "uniqu434343";
const PASSWORD = "MirAli%40434343%2A"; // رمز عبور encode شده
const SHARDS = [
    "megancluster-shard-00-00.jm46r.mongodb.net:27017",
    "megancluster-shard-00-01.jm46r.mongodb.net:27017",
    "megancluster-shard-00-02.jm46r.mongodb.net:27017"
];
const OLD_DB_NAME = "sarnakh_online_db";
const NEW_DB_NAME = "daymat_online_db";

// ============================================================
// ساخت رشته اتصال
// ============================================================
const SHARDS_STRING = SHARDS.join(",");
const OLD_DATABASE_URL = `mongodb://${USERNAME}:${PASSWORD}@${SHARDS_STRING}/${OLD_DB_NAME}?ssl=true&replicaSet=atlas-10bcqm-shard-0&authSource=admin`;
const NEW_DATABASE_URL = `mongodb://${USERNAME}:${PASSWORD}@${SHARDS_STRING}/${NEW_DB_NAME}?ssl=true&replicaSet=atlas-10bcqm-shard-0&authSource=admin`;

// ============================================================
// تابع اصلی انتقال داده
// ============================================================
async function migrate() {
    const oldClient = new MongoClient(OLD_DATABASE_URL);
    const newClient = new MongoClient(NEW_DATABASE_URL);

    try {
        console.log("⏳ در حال اتصال به دیتابیس مبدأ...");
        await oldClient.connect();
        console.log("✅ اتصال به دیتابیس مبدأ برقرار شد.");

        console.log("⏳ در حال اتصال به دیتابیس مقصد...");
        await newClient.connect();
        console.log("✅ اتصال به دیتابیس مقصد برقرار شد.");

        const oldDb = oldClient.db(OLD_DB_NAME);
        const newDb = newClient.db(NEW_DB_NAME);

        // 1. دریافت لیست تمام کالکشن‌ها
        // روش امن‌تر: دریافت مستقیم لیست کالکشن‌ها بدون فیلتر Regex
        const collections = await oldDb.listCollections().toArray();
        console.log(`📂 ${collections.length} کالکشن یافت شد.`);

        // 2. فیلتر کردن کالکشن‌های سیستمی با استفاده از includes
        const systemCollections = ['system.profile', 'system.indexes', 'system.users'];
        const filteredCollections = collections.filter(
            coll => !systemCollections.includes(coll.name)
        );

        console.log(`📂 ${filteredCollections.length} کالکشن برای انتقال (پس از فیلتر سیستم)`);

        for (const collection of filteredCollections) {
            const collName = collection.name;
            console.log(`📦 در حال انتقال کالکشن: ${collName}...`);

            try {
                // دریافت همه اسناد
                const docs = await oldDb.collection(collName).find({}).toArray();

                if (docs.length === 0) {
                    console.log(`⚠️ کالکشن ${collName} خالی است، رد می‌شود.`);
                    continue;
                }

                // حذف داده‌های قبلی در دیتابیس مقصد (اختیاری)
                await newDb.collection(collName).deleteMany({});
                console.log(`🗑️ داده‌های قبلی در ${collName} پاک شد.`);

                // درج داده‌های جدید
                const result = await newDb.collection(collName).insertMany(docs);
                console.log(`✅ ${result.insertedCount} سند به ${collName} منتقل شد.`);
            } catch (error) {
                console.error(`❌ خطا در انتقال کالکشن ${collName}:`, error);
            }
        }

        console.log("🎉 انتقال دیتا با موفقیت انجام شد!");
    } catch (error) {
        console.error("❌ خطا در انتقال:", error);
    } finally {
        await oldClient.close();
        await newClient.close();
        console.log("🔌 اتصالات بسته شد.");
    }
}

// اجرای تابع
migrate();