import { MigrationInterface, QueryRunner } from 'typeorm';

/** Estado do fluxo personalizado em andamento (step = 'CUSTOM'). */
export class AddChatbotCustomFlowState1762200000000
  implements MigrationInterface
{
  name = 'AddChatbotCustomFlowState1762200000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE chatbot_conversations ADD COLUMN IF NOT EXISTS custom jsonb`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE chatbot_conversations DROP COLUMN IF EXISTS custom`,
    );
  }
}
