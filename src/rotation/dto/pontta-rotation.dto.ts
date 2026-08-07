import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

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
}
