// src/file/file.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FileController } from './file.controller';
import { FileService } from './file.service';
import { S3Service } from './s3.service';

@Module({
    imports: [ConfigModule],
    controllers: [FileController],
    providers: [FileService, S3Service],
    exports: [FileService, S3Service],
})
export class FileModule {}