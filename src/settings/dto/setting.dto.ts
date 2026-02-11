import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class CreateSettingDto {
    @IsString()
    key: string;

    @IsString()
    value: string;

    @IsOptional()
    @IsBoolean()
    isEncrypted?: boolean;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    @IsString()
    category?: string;
}

export class UpdateSettingDto {
    @IsOptional()
    @IsString()
    value?: string;

    @IsOptional()
    @IsString()
    description?: string;
}

export class BulkUpdateSettingsDto {
    @IsOptional()
    settings: { key: string; value: string }[];
}
