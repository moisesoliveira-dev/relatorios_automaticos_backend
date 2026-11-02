import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Um passo da conversa simulada: a mensagem do cliente + o estado devolvido no passo anterior. */
export class SimulateDto {
  /** Vazio = o cliente acabou de chegar (mostra a primeira tela). */
  @IsOptional()
  @IsString()
  @MaxLength(600)
  texto?: string;

  /** Estado devolvido pela chamada anterior (opaco para o navegador). */
  @IsOptional()
  @IsObject()
  estado?: Record<string, unknown> | null;

  /** Só no começo: iniciar a conversa numa etapa específica do fluxo padrão. */
  @IsOptional()
  @IsObject()
  inicio?: {
    step?: string;
    trilha?: string | null;
    nome?: string | null;
    fluxoId?: string;
  };

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
