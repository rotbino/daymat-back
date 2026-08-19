// src/common/services/i18n.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class I18nService implements OnModuleInit {
    private translations: Record<string, Record<string, string>> = {};
    private defaultLocale: string;

    constructor(private configService: ConfigService) {
        this.defaultLocale = this.configService.get('defaultLocale') || 'fa';
    }

    async onModuleInit() {
        try {
            const i18nDir = path.join(process.cwd(), 'src', 'i18n');
            const files = fs.readdirSync(i18nDir).filter(f => f.endsWith('.json'));
            for (const file of files) {
                const locale = file.replace('.json', '');
                const content = JSON.parse(fs.readFileSync(path.join(i18nDir, file), 'utf-8'));
                this.translations[locale] = content;
            }

        } catch (error) {
            console.warn('⚠️ Could not load i18n files, using fallback.');
            this.translations = { fa: {} };
        }
    }

    translate(key: string, locale?: string): string {
        const target = locale || this.defaultLocale;
        if (this.translations[target]?.[key]) return this.translations[target][key];
        if (this.translations[this.defaultLocale]?.[key]) return this.translations[this.defaultLocale][key];
        return key;
    }
}