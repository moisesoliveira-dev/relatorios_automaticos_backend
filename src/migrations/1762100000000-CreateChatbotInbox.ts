import { MigrationInterface, QueryRunner } from 'typeorm';

/** Caixa de entrada durável do chatbot (substitui o debounce em memória / Redis). */
export class CreateChatbotInbox1762100000000 implements MigrationInterface {
  name = 'CreateChatbotInbox1762100000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS chatbot_inbox (
        id bigserial PRIMARY KEY,
        message_id varchar(80) NOT NULL,
        contact_id integer NOT NULL,
        payload jsonb NOT NULL,
        received_at timestamptz NOT NULL DEFAULT now(),
        processed_at timestamptz
      )`);
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_chatbot_inbox_message" ON chatbot_inbox (message_id)`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_chatbot_inbox_contact" ON chatbot_inbox (contact_id)`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_chatbot_inbox_pending" ON chatbot_inbox (received_at) WHERE processed_at IS NULL`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS chatbot_inbox`);
  }
}
