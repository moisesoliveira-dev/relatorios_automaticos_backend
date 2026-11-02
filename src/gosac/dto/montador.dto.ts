import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    IsArray,
    IsBoolean,
    IsNumber,
    IsOptional,
    IsString,
    Max,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator';

const MAX_MONEY = 100_000_000;

export class MontadorEnvironmentDto {
    @IsString()
    @MaxLength(200)
    environmentName: string;

    @IsNumber({ allowNaN: false, allowInfinity: false })
    @Min(0)
    @Max(MAX_MONEY)
    environmentValue: number;
}

/** Corpo dos endpoints que geram o PDF de pagamento do montador (envolve valores em dinheiro). */
export class MontadorPdfDto {
    @IsString()
    @MaxLength(100)
    proposalCode: string;

    @IsString()
    @MaxLength(200)
    customerName: string;

    @IsString()
    @MaxLength(200)
    environmentName: string;

    @IsNumber({ allowNaN: false, allowInfinity: false })
    @Min(0)
    @Max(MAX_MONEY)
    environmentValue: number;

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(200)
    @ValidateNested({ each: true })
    @Type(() => MontadorEnvironmentDto)
    environments?: MontadorEnvironmentDto[];

    @IsOptional()
    @IsNumber({ allowNaN: false, allowInfinity: false })
    @Min(0)
    @Max(100)
    ponttaDiscount?: number;

    @IsOptional()
    @IsNumber({ allowNaN: false, allowInfinity: false })
    @Min(0)
    @Max(100)
    additionalDiscount?: number;

    @IsOptional()
    @IsNumber({ allowNaN: false, allowInfinity: false })
    @Min(0)
    @Max(100)
    montadorPercent?: number;

    @IsOptional()
    @IsString()
    @MaxLength(40)
    deliveryDate?: string;

    @IsOptional()
    @IsString()
    @MaxLength(40)
    assemblyStartDate?: string;

    @IsOptional()
    @IsString()
    @MaxLength(40)
    assemblyEndDate?: string;

    @IsOptional()
    @IsBoolean()
    sendToDrive?: boolean;
}
