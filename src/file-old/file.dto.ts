// src/file/file.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class UploadFileDto {
    @ApiProperty({
        example: 'User',
        description: 'نام مدل: User | Business | Ad',
        enum: ['User', 'Business', 'Ad']
    })
    @IsNotEmpty()
    @IsString()
    model: 'User' | 'Business' | 'Ad';

    @ApiProperty({ example: '67a1b2c3d4e5f67890123456', description: 'شناسه رکورد در مدل' })
    @IsNotEmpty()
    @IsString()
    modelId: string;

    @ApiProperty({ example: 'avatar', description: 'کلید فیلد: avatar | logo | images', required: false })
    @IsOptional()
    @IsString()
    fieldKey?: string;

    @ApiProperty({ type: 'string', format: 'binary', description: 'فایل تصویری' })
    file: any;
}

// src/file/file.dto.ts


export class DeleteFileDto {
    @ApiProperty({ example: '6a574435ff497c86a9286f6a', description: 'شناسه فایل' })
    @IsNotEmpty()
    @IsString()
    fileId: string;
}