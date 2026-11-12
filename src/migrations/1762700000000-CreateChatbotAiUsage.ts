import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Consumo da OpenAI, somado por dia, agente, modelo e origem (cliente real ou teste).
 * Guarda só tokens: o custo é calculado na leitura com a tabela de preços, então corrigir um
 * preço corrige também o histórico.
 */
export class CreateChatbotAiUsage1762700000000 implements MigrationInterface {
  name = 'CreateChatbotAiUsage1762700000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE IF NOT EXISTS chatbot_ai_usage_daily (
        dia date NOT NULL,
        agente varchar(40) NOT NULL,
        modelo varchar(80) NOT NULL,
        origem varchar(10) NOT NULL DEFAULT 'cliente',
        chamadas integer NOT NULL DEFAULT 0,
        falhas integer NOT NULL DEFAULT 0,
        tokens_entrada bigint NOT NULL DEFAULT 0,
        tokens_cache bigint NOT NULL DEFAULT 0,
        tokens_saida bigint NOT NULL DEFAULT 0,
        latencia_ms bigint NOT NULL DEFAULT 0,
        PRIMARY KEY (dia, agente, modelo, origem)
      )`,
    );
  }

  public async down(): Promise<void> {
    // Não apaga: a tabela pode ter histórico de gastos.
  }
}
