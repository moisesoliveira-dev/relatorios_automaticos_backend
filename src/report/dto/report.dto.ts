import { IsString, IsEmail, IsOptional, IsEnum, IsBoolean, IsNumber, IsArray } from 'class-validator';
import { ReportType } from '../entities/report.entity';

export class CreateReportDto {
    @IsString()
    name: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    @IsEnum(ReportType)
    type?: ReportType;

    @IsOptional()
    filters?: {
        status?: string;
        limit?: number;
        startDate?: string;
        endDate?: string;
    };
}

export class UpdateReportDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    filters?: {
        status?: string;
        limit?: number;
        startDate?: string;
        endDate?: string;
    };
}

export class CreateReportEmailDto {
    @IsEmail()
    email: string;

    @IsOptional()
    @IsString()
    name?: string;

    @IsString()
    reportType: string;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

export class UpdateReportEmailDto {
    @IsOptional()
    @IsEmail()
    email?: string;

    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    reportType?: string;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

export class ExecuteReportDto {
    @IsOptional()
    @IsArray()
    @IsEmail({}, { each: true })
    additionalEmails?: string[];

    @IsOptional()
    @IsBoolean()
    sendToFixedEmails?: boolean;

    @IsOptional()
    filters?: {
        status?: string;
        limit?: number;
        startDate?: string;
        endDate?: string;
    };
}

export class GenerateReportDto {
    @IsOptional()
    @IsString()
    status?: string;

    @IsOptional()
    @IsNumber()
    limit?: number;

    @IsOptional()
    @IsString()
    startDate?: string;

    @IsOptional()
    @IsString()
    endDate?: string;

    @IsOptional()
    @IsArray()
    @IsEmail({}, { each: true })
    emails?: string[];

    @IsOptional()
    @IsBoolean()
    useFixedEmails?: boolean;
}
