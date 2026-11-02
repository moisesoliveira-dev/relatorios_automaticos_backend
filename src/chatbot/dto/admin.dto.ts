import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class SimulateDto {
  @IsString()
  @MaxLength(600)
  text: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  step?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  trilha?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  nome?: string | null;

  @IsOptional()
  @IsBoolean()
  usarIA?: boolean;
}

export class ListConversationsDto {
  @IsOptional()
  @IsString()
  @MaxLength(24)
  step?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  busca?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  erros?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  tamanho?: number;
}
