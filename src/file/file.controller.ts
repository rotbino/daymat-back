// src/file/file.controller.ts

import {
    Controller,
    Post,
    Delete,
    Get,
    Param,
    UseGuards,
    Body,
    Res,
    Req,
    BadRequestException,
    ForbiddenException,
    Put,
    NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { FastifyRequest, FastifyReply } from 'fastify';
import { FileService } from './file.service';
import { DeleteFileDto } from './file.dto';
import { CurrentUser } from '../common/decorators/custom.decorators';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('file')
@Controller('file')
export class FileController {
    constructor(
        private fileService: FileService,
        private prisma: PrismaService,
    ) {}

    @Post('upload')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                model: { type: 'string', enum: ['User', 'Catalog', 'Ad', 'ProductReference', 'Brand'] },
                modelId: { type: 'string' },
                fieldKey: { type: 'string' },
                file: { type: 'string', format: 'binary' },
            },
        },
    })
    @ApiOperation({ summary: 'آپلود فایل' })
    async uploadFile(
        @CurrentUser() user: any,
        @Req() req: FastifyRequest,
    ) {
        const parts = req.parts();
        let fileBuffer: Buffer | null = null;
        let fileInfo: { originalname: string; mimetype: string } | null = null;
        let model: 'User' | 'Catalog' | 'Ad' | 'ProductReference' | 'Brand' = 'User';
        let modelId: string = '';
        let fieldKey: string | undefined = undefined;

        for await (const part of parts) {
            if (part.type === 'file') {
                const buffer = await part.toBuffer();
                fileBuffer = buffer;
                fileInfo = {
                    originalname: part.filename,
                    mimetype: part.mimetype,
                };
            } else if (part.type === 'field') {
                if (part.fieldname === 'model') {
                    model = part.value as 'User' | 'Catalog' | 'Ad' | 'ProductReference' | 'Brand';
                }
                if (part.fieldname === 'modelId') {
                    modelId = String(part.value);
                }
                if (part.fieldname === 'fieldKey') {
                    fieldKey = String(part.value);
                }
            }
        }

        if (!fileBuffer || !fileInfo) {
            throw new BadRequestException({
                errorCode: 'FILE_REQUIRED',
                message: 'فایلی برای آپلود ارسال نشده است',
            });
        }

        const actualModelId = model === 'User' ? user.id : modelId;

        return this.fileService.uploadFile(
            user.id,
            {
                buffer: fileBuffer,
                originalname: fileInfo.originalname,
                mimetype: fileInfo.mimetype,
                size: fileBuffer.length,
            },
            model,
            actualModelId,
            fieldKey,
        );
    }

    // ============================================================
    // دریافت فایل (ریدایرکت مستقیم به آروان)
    // ============================================================
    @Get(':fileId')
    @ApiOperation({ summary: 'دریافت فایل' })
    async getFile(
        @Param('fileId') fileId: string,
        @Res() res: FastifyReply,
    ) {
        const file = await this.prisma.file.findUnique({
            where: { id: fileId },
        });

        if (!file) {
            throw new NotFoundException({
                errorCode: 'FILE_NOT_FOUND',
                message: 'فایل یافت نشد',
            });
        }

        // ریدایرکت مستقیم به آدرس فایل در آروان
        return res.status(302).redirect(file.path);
    }

    // ============================================================
    // دریافت تامب‌نیل (ریدایرکت مستقیم به آروان)
    // ============================================================
    @Get(':fileId/thumbnail')
    @ApiOperation({ summary: 'دریافت تامب‌نیل' })
    async getThumbnail(
        @Param('fileId') fileId: string,
        @Res() res: FastifyReply,
    ) {
        const file = await this.prisma.file.findUnique({
            where: { id: fileId },
        });

        if (!file) {
            throw new NotFoundException({
                errorCode: 'FILE_NOT_FOUND',
                message: 'فایل یافت نشد',
            });
        }

        // ریدایرکت مستقیم به آدرس تامب‌نیل در آروان
        return res.status(302).redirect(file.thumbnailPath || file.path);
    }

    // ============================================================
    // حذف فایل
    // ============================================================
    @Delete('delete')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'حذف فایل' })
    async deleteFile(
        @CurrentUser() user: any,
        @Body() dto: DeleteFileDto,
    ) {
        return this.fileService.deleteFile(user.id, dto.fileId);
    }

    // ============================================================
    // پاکسازی فایل‌های سرگردان (فقط ادمین - محیط توسعه)
    // ============================================================
    @Delete('cleanup')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('system_admin')
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'پاکسازی فایل‌های سرگردان (فقط ادمین)' })
    async cleanupFiles() {
        if (process.env.NODE_ENV === 'production') {
            throw new ForbiddenException({
                errorCode: 'FORBIDDEN',
                message: 'این عملیات در محیط تولید غیرفعال است',
            });
        }
        return this.fileService.cleanupOrphanFiles();
    }

    // ============================================================
    // به‌روزرسانی relatedId (برای فایل‌های موقت)
    // ============================================================
    @Put('update-related')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    async updateRelatedId(
        @Body('fileId') fileId: string,
        @Body('modelId') modelId: string,
    ) {
        return this.fileService.updateFileRelatedId(fileId, modelId);
    }
}