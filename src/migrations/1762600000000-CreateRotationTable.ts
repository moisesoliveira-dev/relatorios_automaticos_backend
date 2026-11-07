import { MigrationInterface, QueryRunner } from 'typeorm';

/** O rodízio passa a viver no banco principal (antes era um banco separado, o do n8n). */
export class CreateRotationTable1762600000000 implements MigrationInterface {
  name = 'CreateRotationTable1762600000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE IF NOT EXISTS tb_rotation (
        id text PRIMARY KEY,
        name text,
        turn boolean DEFAULT false,
        identificacao integer,
        queueid integer
      )`,
    );
  }

  public async down(): Promise<void> {
    // Não apaga: a tabela pode ter dados.
  }
}
