// src/config/configuration.ts
export default () => ({
    port: parseInt(process.env.PORT, 10) || 3011,
    jwtSecret: process.env.JWT_SECRET || 'default-secret-change-me',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
    defaultLocale: process.env.DEFAULT_LOCALE || 'fa',
    databaseUrl: process.env.DATABASE_URL,
});