// src/auth/jwt.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(private configService: ConfigService) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: configService.get('jwtSecret'),
        });
    }

    async validate(payload: any) {
        return {
            id: payload.sub,
            phone: payload.phone,
            role: payload.role || 'user',     // ✅ نقش از توکن (با fallback)
            locale: payload.locale || 'fa',   // ✅ زبان از توکن (با fallback)
        };
    }
}