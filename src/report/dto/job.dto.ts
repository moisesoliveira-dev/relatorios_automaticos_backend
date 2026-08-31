import {
  IsString,
  IsEnum,
  IsBoolean,
  IsOptional,
  IsInt,
  Min,
  Max,
  Matches,
  IsArray,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateJobDto {
    @IsString()
    name: string;

    @IsEnum(['occurrences', 'monthly', 'custom', 'gosac-grupos', 'gosac-pagamento-montador'])
    reportType: 'occurrences' | 'monthly' | 'custom' | 'gosac-grupos' | 'gosac-pagamento-montador';

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
    @IsEnum(['occurrences', 'monthly', 'custom', 'gosac-grupos', 'gosac-pagamento-montador'])
    reportType?: 'occurrences' | 'monthly' | 'custom' | 'gosac-grupos' | 'gosac-pagamento-montador';

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

export class RunCodeJobNowDto {
    @IsOptional()
    @IsString()
    @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'salesOrderDate must be in YYYY-MM-DD format' })
    salesOrderDate?: string;
}

export class CodeJobRunTimeDto {
    @IsInt()
    @Min(0)
    @Max(23)
    hour: number;

    @IsInt()
    @Min(0)
    @Max(59)
    minute: number;
}

export class UpdateCodeJobScheduleDto {
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => CodeJobRunTimeDto)
    runTimesManaus: CodeJobRunTimeDto[];
}
