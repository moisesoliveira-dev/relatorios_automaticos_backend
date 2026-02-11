import { IsString, IsEnum, IsBoolean, IsOptional, IsInt, Min, Max, Matches } from 'class-validator';

export class CreateJobDto {
    @IsString()
    name: string;

    @IsEnum(['occurrences', 'monthly', 'custom'])
    reportType: 'occurrences' | 'monthly' | 'custom';

    @IsEnum(['daily', 'weekly', 'monthly'])
    frequency: 'daily' | 'weekly' | 'monthly';

    @IsString()
    @Matches(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/, { message: 'Time must be in HH:mm format' })
    time: string;

    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(6)
    dayOfWeek?: number;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(31)
    dayOfMonth?: number;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @IsOptional()
    filters?: {
        limit?: number;
        startDate?: string;
        endDate?: string;
    };

    @IsEnum(['excel', 'csv'])
    format: 'excel' | 'csv';

    @IsOptional()
    @IsBoolean()
    sendToFixedEmails?: boolean;
}

export class UpdateJobDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsEnum(['occurrences', 'monthly', 'custom'])
    reportType?: 'occurrences' | 'monthly' | 'custom';

    @IsOptional()
    @IsEnum(['daily', 'weekly', 'monthly'])
    frequency?: 'daily' | 'weekly' | 'monthly';

    @IsOptional()
    @IsString()
    @Matches(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/, { message: 'Time must be in HH:mm format' })
    time?: string;

    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(6)
    dayOfWeek?: number;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(31)
    dayOfMonth?: number;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @IsOptional()
    filters?: {
        limit?: number;
        startDate?: string;
        endDate?: string;
    };

    @IsOptional()
    @IsEnum(['excel', 'csv'])
    format?: 'excel' | 'csv';

    @IsOptional()
    @IsBoolean()
    sendToFixedEmails?: boolean;
}
