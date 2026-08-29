import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsNumber, MaxLength, Min } from 'class-validator';

export class SearchLogDto {
    @ApiProperty({ description: 'عبارت جستجوی اجراشده', maxLength: 120 })
    @IsString()
    @IsNotEmpty()
    @MaxLength(120)
    term!: string;

    @ApiPropertyOptional({ description: 'تعداد نتایج آن جستجو (از pagination)' })
    @IsOptional()
    @IsNumber()
    @Min(0)
    resultCount?: number;

    @ApiPropertyOptional({ description: 'slug بازار' })
    @IsOptional()
    @IsString()
    @MaxLength(64)
    armSlug?: string;
}