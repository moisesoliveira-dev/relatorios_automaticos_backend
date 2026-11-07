import { MigrationInterface, QueryRunner } from 'typeorm';

/** Lead da conversa no funil comercial do CMSYS (substitui o negócio do Pontta). */
export class AddChatbotCrmLead1762400000000 implements MigrationInterface {
  name = 'AddChatbotCrmLead1762400000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE chatbot_conversations ADD COLUMN IF NOT EXISTS crm_lead_id varchar(64)`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE chatbot_conversations DROP COLUMN IF EXISTS crm_lead_id`,
    );
  }
}
