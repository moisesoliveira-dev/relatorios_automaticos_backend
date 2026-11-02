import { MigrationInterface, QueryRunner } from 'typeorm';

/** Tabelas do chatbot. Usa IF NOT EXISTS para conviver com bancos criados por synchronize em dev. */
export class CreateChatbotTables1762000000000 implements MigrationInterface {
  name = 'CreateChatbotTables1762000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS chatbot_conversations (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        contact_id integer NOT NULL,
        ticket_id integer NOT NULL,
        numero varchar(32),
        contact_name varchar(120),
        step varchar(24) NOT NULL DEFAULT 'MENU',
        trilha varchar(16),
        nome varchar(80),
        nome_pendente varchar(80),
        local varchar(8),
        categorias jsonb NOT NULL DEFAULT '[]',
        arquivos integer NOT NULL DEFAULT 0,
        invalid_count integer NOT NULL DEFAULT 0,
        off_topic_count integer NOT NULL DEFAULT 0,
        slots jsonb,
        em_atendimento boolean NOT NULL DEFAULT false,
        finalizou_triagem boolean NOT NULL DEFAULT false,
        drive_folder_id varchar(128),
        atendente_id integer,
        fila_id integer,
        agendamento_start timestamptz,
        handoff_error text,
        history jsonb NOT NULL DEFAULT '[]',
        processed_ids jsonb NOT NULL DEFAULT '[]',
        ai_calls_day integer NOT NULL DEFAULT 0,
        ai_calls_date varchar(10),
        last_message_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_chatbot_conversations_contact" ON chatbot_conversations (contact_id)`,
    );
    await q.query(`
      CREATE TABLE IF NOT EXISTS chatbot_booked_slots (
        start_utc timestamptz PRIMARY KEY,
        end_utc timestamptz NOT NULL,
        contact_id integer NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS chatbot_booked_slots`);
    await q.query(`DROP TABLE IF EXISTS chatbot_conversations`);
  }
}
