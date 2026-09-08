// src/prisma/prisma.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const isProduction = process.env.NODE_ENV === 'production';

    if (isProduction) {
      // در production، Prisma خودش DATABASE_URL را از env می‌خواند
      super();
    } else {
      // در development، از datasources استفاده می‌کنیم
      super({
        datasources: {
          db: {
            url: process.env.DATABASE_URL,
          },
        },
      });
    }
  }

  async onModuleInit() {
    await this.$connect();
    console.log('✅ Prisma connected to MongoDB');
    console.log('📋 Environment:', process.env.NODE_ENV || 'development');
    console.log('📋 DATABASE_URL status:', process.env.DATABASE_URL ? 'SET' : 'NOT SET');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}