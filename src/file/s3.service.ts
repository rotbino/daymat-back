// src/file/s3.service.ts
import { Injectable, BadRequestException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
    S3Client,
    PutObjectCommand,
    DeleteObjectCommand,
    GetObjectCommand,
    ListBucketsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as path from 'path';

@Injectable()
export class S3Service {
    private s3: S3Client;
    private bucket: string;
    private endpoint: string;

    constructor(private configService: ConfigService) {
        console.log('🔍 S3Service constructor called');

        // ✅ ۱. خواندن از ConfigService
        const arvanConfig = this.configService.get('arvan');


        // ✅ ۳. بررسی مقدار accessKey از ConfigService
        const accessKey = arvanConfig?.accessKey;
        const secretKey = arvanConfig?.secretKey;


        if (!accessKey || !secretKey) {
            console.error('❌ S3 credentials are missing!');
            throw new Error('S3 credentials are not configured properly.');
        }

        this.bucket = arvanConfig.bucketName;
        this.endpoint = arvanConfig.endpoint;



        this.s3 = new S3Client({
            endpoint: arvanConfig.endpoint,
            region: arvanConfig.region,
            credentials: {
                accessKeyId: accessKey,
                secretAccessKey: secretKey,
            },
            forcePathStyle: true,
        });

        console.log('✅ S3Client created successfully');

        // ✅ ۵. تست اتصال
        this.testConnection().catch(err => {
            console.warn('⚠️ S3 connection test failed at startup:', err.message);
        });
    }

    // ============================================================
    // تست اتصال به S3 با لاگ کامل
    // ============================================================
    async testConnection() {
        try {
            console.log('🔍 Testing S3 connection...');

            // ✅ لاگ کامل درخواست
            console.log('🔍 S3 Request details:');
            console.log('  - Bucket:', this.bucket);
            console.log('  - Endpoint:', this.endpoint);

            const command = new ListBucketsCommand({});
            const response = await this.s3.send(command);

            console.log('✅ S3 Connection successful!');
            console.log('📋 Response:', response);
            return response;
        } catch (error) {
            console.error('❌ S3 Connection test failed:');
            console.error('  - name:', error.name);
            console.error('  - code:', error.Code);
            console.error('  - message:', error.message);
            console.error('  - metadata:', error.$metadata);

            // ✅ لاگ کامل خطا برای بررسی
            console.error('  - Full error object:', JSON.stringify(error, null, 2));

            throw error;
        }
    }

    // ============================================================
    // آپلود فایل
    // ============================================================
    async uploadFile(
        file: {
            buffer: Buffer;
            originalname: string;
            mimetype: string;
        },
        userId: string,
        model: string,
        modelId?: string,
        fieldKey?: string,
    ): Promise<{ url: string; key: string }> {
        console.log('📤 Uploading to S3...');

        // ✅ لاگ قبل از آپلود
        console.log('🔍 Upload details:');
        console.log('  - Bucket:', this.bucket);
        console.log('  - Endpoint:', this.endpoint);
        console.log('  - AccessKeyId:', this.configService.get('arvan')?.accessKey);

        const timestamp = Date.now();
        const randomStr = Math.random().toString(36).substring(2, 8);
        const ext = path.extname(file.originalname);
        const fileName = `${timestamp}-${randomStr}${ext}`;

        let key = `users/${userId}/${fileName}`;
        if (modelId) {
            key = `${model}s/${modelId}/${fieldKey || 'file'}/${fileName}`;
        }

        console.log('  - Key:', key);

        const command = new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: file.buffer,
            ContentType: file.mimetype,
            ACL: 'public-read',
        });

        try {
            await this.s3.send(command);
            const url = `${this.endpoint}/${this.bucket}/${key}`;
            console.log('✅ File uploaded to S3:', url);
            return { url, key };
        } catch (error) {
            console.error('❌ S3 Upload Error:');
            console.error('  - name:', error.name);
            console.error('  - code:', error.Code);
            console.error('  - message:', error.message);
            console.error('  - metadata:', error.$metadata);
            throw new BadRequestException({
                errorCode: 'UPLOAD_FAILED',
                message: `آپلود فایل در فضای ابری با خطا مواجه شد: ${error.message}`,
            });
        }
    }


    // ============================================================
    // حذف فایل
    // ============================================================
    async deleteFile(key: string): Promise<void> {
        const command = new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: key,
        });

        try {
            await this.s3.send(command);
            console.log(`✅ File deleted from S3: ${key}`);
        } catch (error) {
            console.error(`❌ S3 Delete Error:`, error.message);
            throw new BadRequestException({
                errorCode: 'DELETE_FAILED',
                message: 'حذف فایل از فضای ابری با خطا مواجه شد',
            });
        }
    }

    // ============================================================
    // استخراج کلید از URL
    // ============================================================
    getKeyFromUrl(url: string): string | null {
        try {
            const urlObj = new URL(url);
            const pathParts = urlObj.pathname.split('/').filter(Boolean);
            if (pathParts.length > 0 && pathParts[0] === this.bucket) {
                return pathParts.slice(1).join('/');
            }
            return pathParts.join('/');
        } catch (error) {
            console.error('❌ Error extracting key from URL:', error);
            return null;
        }
    }

    // ============================================================
    // گرفتن لینک موقت
    // ============================================================
    async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
        const command = new GetObjectCommand({
            Bucket: this.bucket,
            Key: key,
        });

        try {
            return await getSignedUrl(this.s3, command, { expiresIn });
        } catch (error) {
            console.error('❌ Signed URL Error:', error);
            throw new BadRequestException({
                errorCode: 'SIGNED_URL_FAILED',
                message: 'ایجاد لینک موقت با خطا مواجه شد',
            });
        }
    }
}