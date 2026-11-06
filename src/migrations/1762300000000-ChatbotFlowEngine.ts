import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Motor de fluxos (v2): o estado da conversa passa a ser um único JSON (`flow`), e `step` só diz se o
 * bot ou um humano está conduzindo. As colunas do motor antigo ficam no banco (não são mais lidas)
 * para permitir voltar a versão sem perder dados; conversas em andamento recomeçam pelo fluxo de início.
 */
export class ChatbotFlowEngine1762300000000 implements MigrationInterface {
  name = 'ChatbotFlowEngine1762300000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE chatbot_conversations ADD COLUMN IF NOT EXISTS flow jsonb`,
    );
    await q.query(
      `ALTER TABLE chatbot_conversations ALTER COLUMN step SET DEFAULT 'BOT'`,
    );
    await q.query(
      `UPDATE chatbot_conversations SET step = 'BOT', flow = NULL WHERE step <> 'HUMANO'`,
    );
    for (const col of [
      'nome_pendente',
      'local',
      'categorias',
      'slots',
      'custom',
    ]) {
      await q
        .query(
          `ALTER TABLE chatbot_conversations ALTER COLUMN ${col} DROP NOT NULL`,
        )
        .catch(() => undefined);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `UPDATE chatbot_conversations SET step = 'MENU' WHERE step = 'BOT'`,
    );
    await q.query(
      `ALTER TABLE chatbot_conversations ALTER COLUMN step SET DEFAULT 'MENU'`,
    );
    await q.query(
      `ALTER TABLE chatbot_conversations DROP COLUMN IF EXISTS flow`,
    );
  }
}
