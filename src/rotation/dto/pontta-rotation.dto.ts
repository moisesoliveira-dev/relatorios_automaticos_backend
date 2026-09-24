import { IsBoolean, IsIn, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';

export const ASSIGN_BY_PCP_AREA_SETTING_KEY = 'AUTO_TASKS_ASSIGN_BY_PCP_AREA';

export const PONTTA_PCP_AREAS = ['molhada', 'intima', 'social'] as const;
export type PonttaPcpAreaDto = (typeof PONTTA_PCP_AREAS)[number];

export class CreatePonttaRotationDto {
    @IsString()
    @MinLength(1)
    projetistaid: string;

    @IsString()
    @MinLength(1)
    name: string;

    @IsOptional()
    @IsBoolean()
    turn?: boolean;

    @IsOptional()
    @IsBoolean()
    turn_v?: boolean;

    @IsOptional()
    @ValidateIf((_, value) => value !== null && value !== undefined && value !== '')
    @IsIn(PONTTA_PCP_AREAS)
    pcpArea?: PonttaPcpAreaDto | null;
}

export class UpdatePonttaRotationDto {
    @IsOptional()
    @IsString()
    @MinLength(1)
    projetistaid?: string;

    @IsOptional()
    @IsString()
    @MinLength(1)
    name?: string;

    @IsOptional()
    @IsBoolean()
    turn?: boolean;

    @IsOptional()
    @IsBoolean()
    turn_v?: boolean;

    @IsOptional()
    @ValidateIf((_, value) => value !== null && value !== undefined && value !== '')
    @IsIn(PONTTA_PCP_AREAS)
    pcpArea?: PonttaPcpAreaDto | null;
}

export class UpdateAssignByPcpAreaDto {
    @IsBoolean()
    enabled: boolean;
}
