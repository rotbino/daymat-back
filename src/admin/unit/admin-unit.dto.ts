// src/admin/unit/admin-unit.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsOptional, IsBoolean } from 'class-validator';

export class CreateUnitDto {
    @ApiProperty({ example: 'تن', description: 'عنوان واحد' })
    @IsNotEmpty({ message: 'عنوان واحد الزامی است' })
    @IsString()
    title: string;

    @ApiProperty({ example: 't', description: 'کد کوتاه واحد' })
    @IsNotEmpty({ message: 'کد کوتاه واحد الزامی است' })
    @IsString()
    shortCode: string;

    @ApiProperty({ example: true, description: 'آیا واحد پیش‌فرض است؟', required: false })
    @IsOptional()
    @IsBoolean()
    isDefault?: boolean;
}

export class UpdateUnitDto {
    @ApiProperty({ example: 'تن', description: 'عنوان واحد', required: false })
    @IsOptional()
    @IsString()
    title?: string;

    @ApiProperty({ example: 't', description: 'کد کوتاه واحد', required: false })
    @IsOptional()
    @IsString()
    shortCode?: string;

    @ApiProperty({ example: true, description: 'آیا واحد پیش‌فرض است؟', required: false })
    @IsOptional()
    @IsBoolean()
    isDefault?: boolean;
}