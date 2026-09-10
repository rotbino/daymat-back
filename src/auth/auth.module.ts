// src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { SettingsModule } from '../settings/settings.module';

@Module({
    imports: [
        PassportModule,
        JwtModule.registerAsync({
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({
                secret: config.get('jwtSecret'),
                // ⚠️ بدون expiresIn — توکن بی‌انقضا (مدل تلگرام).
                // عمر نشست را tokenVersion در jwt.strategy کنترل می‌کند:
                // logout/تغییر رمز → tokenVersion++ → همهٔ توکن‌های قبلی 401 می‌گیرند.
                // jwtExpiresIn از config الان null است؛ اگر فردا خواستید TTL برگردانید
                // فقط همین‌جا signOptions: { expiresIn: config.get('jwtExpiresIn') } بگذارید.
                signOptions: config.get('jwtExpiresIn')
                    ? { expiresIn: config.get('jwtExpiresIn') }
                    : {},
            }),
        }),
        SettingsModule, // ✅ برای دسترسی به SystemSettingsService
    ],
    controllers: [AuthController],
    providers: [AuthService, JwtStrategy],
    exports: [JwtModule, AuthService],
})
export class AuthModule {}