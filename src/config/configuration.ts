// src/config/configuration.ts
export default () => {
    console.log('🔍 configuration.ts is being executed!');

    // ✅ خواندن مستقیم از process.env
    const rawAccessKey = process.env.ARVAN_ACCESS_KEY;
    const rawSecretKey = process.env.ARVAN_SECRET_KEY;

    console.log('📋 RAW values from process.env:');
    console.log('  - ARVAN_ACCESS_KEY RAW:', rawAccessKey);
    console.log('  - ARVAN_SECRET_KEY RAW:', rawSecretKey ? `${rawSecretKey.substring(0, 4)}...${rawSecretKey.substring(rawSecretKey.length - 4)}` : 'NOT SET');
    console.log('  - ARVAN_ENDPOINT RAW:', process.env.ARVAN_ENDPOINT);
    console.log('  - ARVAN_BUCKET_NAME RAW:', process.env.ARVAN_BUCKET_NAME);

    const config = {
        port: parseInt(process.env.PORT, 10) || 3011,
        jwtSecret: process.env.JWT_SECRET || 'default-secret-change-me',
        // ⚠️ منسوخ — توکن‌ها بی‌انقضا صادر می‌شوند (مدل تلگرام).
        // باطل‌سازی فقط با tokenVersion در jwt.strategy انجام می‌شود (لاگ‌اوت/تغییر رمز).
        // مقدار JWT_EXPIRES_IN در env نادیده گرفته می‌شود و می‌توان از پارامترهای استقرار حذفش کرد.
        jwtExpiresIn: null as string | null,
        defaultLocale: process.env.DEFAULT_LOCALE || 'fa',
        databaseUrl: process.env.DATABASE_URL,

        arvan: {
            endpoint: process.env.ARVAN_ENDPOINT,
            region: process.env.ARVAN_REGION,
            accessKey: process.env.ARVAN_ACCESS_KEY,
            secretKey: process.env.ARVAN_SECRET_KEY,
            bucketName: process.env.ARVAN_BUCKET_NAME,
        },
    };

    // ✅ لاگ نهایی
    console.log('📋 Final config.arvan:');
    console.log('  - endpoint:', config.arvan.endpoint);
    console.log('  - region:', config.arvan.region);
    console.log('  - accessKey:', config.arvan.accessKey ? `"${config.arvan.accessKey}" (length: ${config.arvan.accessKey.length})` : 'NOT SET');
    console.log('  - secretKey:', config.arvan.secretKey ? `"${config.arvan.secretKey.substring(0, 4)}...${config.arvan.secretKey.substring(config.arvan.secretKey.length - 4)}" (length: ${config.arvan.secretKey.length})` : 'NOT SET');
    console.log('  - bucketName:', config.arvan.bucketName);

    return config;
};