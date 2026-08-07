import { IsBoolean, IsInt, IsOptional, IsString, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateRotationDto {
    @IsString()
    @MinLength(1)
    id: string;

    @IsString()
    @MinLength(1)
    name: string;

    @Type(() => Number)
    @IsInt()
    identificacao: number;

    @Type(() => Number)
    @IsInt()
    queueid: number;

    @IsOptional()
    @IsBoolean()
    turn?: boolean;
}

export class UpdateRotationDto {
    @IsOptional()
    @IsString()
    @MinLength(1)
    name?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    identificacao?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    queueid?: number;

    @IsOptional()
    @IsBoolean()
    turn?: boolean;
}
