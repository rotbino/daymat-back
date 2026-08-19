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
    ForbiddenException, Put,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { FastifyRequest, FastifyReply } from 'fastify';
import { FileService } from './file.service';
import { DeleteFileDto } from './file.dto';
import { CurrentUser } from '../common/decorators/custom.decorators';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('file')
@Controller('file')
export class FileController {
    constructor(private fileService: FileService) {}

    @Post('upload')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('access-token')
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                model: { type: 'string', enum: ['User', 'Business', 'Ad'] },
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
        let model: 'User' | 'Business' | 'Ad' = 'User';
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
                    model = part.value as 'User' | 'Business' | 'Ad';
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

    @Get(':fileId')
    @ApiOperation({ summary: 'دریافت فایل' })
    async getFile(
        @Param('fileId') fileId: string,
        @Res() res: FastifyReply,
    ) {
        const { stream, mimeType, name } = await this.fileService.getFile(fileId, false);

        res.header('Content-Type', mimeType);
        res.header('Content-Disposition', `inline; filename="${name}"`);

        return res.send(stream);
    }

    @Get(':fileId/thumbnail')
    @ApiOperation({ summary: 'دریافت تامب‌نیل' })
    async getThumbnail(
        @Param('fileId') fileId: string,
        @Res() res: FastifyReply,
    ) {
        const { stream, mimeType } = await this.fileService.getFile(fileId, true);

        res.header('Content-Type', mimeType);

        return res.send(stream);
    }

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

    // ✅ پاکسازی فایل‌های سرگردان - فقط ادمین
    @Delete('cleanup')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('system_admin')
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'پاکسازی فایل‌های سرگردان (فقط ادمین)' })
    async cleanupFiles() {
        // فقط در محیط توسعه
        if (process.env.NODE_ENV === 'production') {
            throw new ForbiddenException({
                errorCode: 'FORBIDDEN',
                message: 'این عملیات در محیط تولید غیرفعال است',
            });
        }
        return this.fileService.cleanupOrphanFiles();
    }


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