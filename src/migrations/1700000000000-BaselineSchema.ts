import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Schema base do app (gerado a partir das entidades em 2025-11).
 * Em bancos que já existem (produção/dev criados por synchronize) NÃO faz nada: se a tabela
 * "users" já existe, assume-se que o schema base está presente.
 */
export class BaselineSchema1700000000000 implements MigrationInterface {
  name = 'BaselineSchema1700000000000';

  private readonly up_queries = [
    "CREATE TYPE \"public\".\"users_role_enum\" AS ENUM('master', 'admin', 'user', 'manager')",
    "CREATE TYPE \"public\".\"users_status_enum\" AS ENUM('pending', 'active', 'inactive')",
    'CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying NOT NULL, "password" character varying NOT NULL, "name" character varying NOT NULL, "role" "public"."users_role_enum" NOT NULL DEFAULT \'user\', "tabs" text, "status" "public"."users_status_enum" NOT NULL DEFAULT \'pending\', "isActive" boolean NOT NULL DEFAULT true, "avatarUrl" character varying, "invitedBy" character varying, "inviteToken" character varying, "inviteCode" character varying(6), "inviteExpiresAt" TIMESTAMP, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "lastLoginAt" TIMESTAMP, CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))',
    "CREATE TYPE \"public\".\"reports_type_enum\" AS ENUM('occurrences', 'monthly', 'custom')",
    "CREATE TYPE \"public\".\"reports_status_enum\" AS ENUM('pending', 'processing', 'success', 'failed')",
    'CREATE TABLE "reports" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "description" character varying, "type" "public"."reports_type_enum" NOT NULL DEFAULT \'occurrences\', "status" "public"."reports_status_enum" NOT NULL DEFAULT \'pending\', "totalRecords" integer NOT NULL DEFAULT \'0\', "filePath" character varying, "filters" jsonb, "errorMessage" character varying, "createdById" uuid NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "completedAt" TIMESTAMP, CONSTRAINT "PK_d9013193989303580053c0b5ef6" PRIMARY KEY ("id"))',
    'CREATE TABLE "report_emails" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying NOT NULL, "name" character varying, "reportType" character varying NOT NULL, "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_3db009460c0f43449ad969ab18a" PRIMARY KEY ("id"))',
    "CREATE TYPE \"public\".\"report_executions_status_enum\" AS ENUM('pending', 'processing', 'success', 'failed')",
    'CREATE TABLE "report_executions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "reportId" uuid, "status" "public"."report_executions_status_enum" NOT NULL DEFAULT \'pending\', "recordsProcessed" integer NOT NULL DEFAULT \'0\', "emailsSentTo" text, "errorMessage" character varying, "executedById" uuid, "executedAt" TIMESTAMP NOT NULL DEFAULT now(), "completedAt" TIMESTAMP, "durationMs" integer, CONSTRAINT "PK_b15c410814ef00f0d69cebb2c29" PRIMARY KEY ("id"))',
    'CREATE TABLE "dashboard_metrics" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "metricType" character varying NOT NULL, "value" integer NOT NULL DEFAULT \'0\', "previousValue" integer NOT NULL DEFAULT \'0\', "period" character varying NOT NULL, "recordedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_a200fe0709a8e721c1630f80bf5" PRIMARY KEY ("id"))',
    'CREATE TABLE "system_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "service" character varying NOT NULL, "status" character varying NOT NULL, "latencyMs" integer, "message" character varying, "checkedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_56861c4b9d16aa90259f4ce0a2c" PRIMARY KEY ("id"))',
    "CREATE TYPE \"public\".\"scheduled_jobs_reporttype_enum\" AS ENUM('occurrences', 'monthly', 'custom', 'gosac-grupos', 'gosac-pagamento-montador')",
    "CREATE TYPE \"public\".\"scheduled_jobs_frequency_enum\" AS ENUM('daily', 'weekly', 'monthly')",
    'CREATE TYPE "public"."scheduled_jobs_format_enum" AS ENUM(\'excel\', \'csv\')',
    'CREATE TABLE "scheduled_jobs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "reportType" "public"."scheduled_jobs_reporttype_enum" NOT NULL, "frequency" "public"."scheduled_jobs_frequency_enum" NOT NULL, "time" TIME NOT NULL, "dayOfWeek" integer, "dayOfMonth" integer, "isActive" boolean NOT NULL DEFAULT true, "filters" jsonb, "format" "public"."scheduled_jobs_format_enum" NOT NULL DEFAULT \'excel\', "sendToFixedEmails" boolean NOT NULL DEFAULT true, "lastRun" TIMESTAMP, "nextRun" TIMESTAMP, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_119312a5470a95ee9c733a5246d" PRIMARY KEY ("id"))',
    'CREATE TABLE "settings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "key" character varying NOT NULL, "value" text NOT NULL, "isEncrypted" boolean NOT NULL DEFAULT false, "description" character varying, "category" character varying NOT NULL DEFAULT \'general\', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_c8639b7626fa94ba8265628f214" UNIQUE ("key"), CONSTRAINT "PK_0669fe20e252eb692bf4d344975" PRIMARY KEY ("id"))',
    'CREATE TABLE "gosac_groups" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "gosacTicketId" integer NOT NULL, "gosacContactId" integer NOT NULL DEFAULT \'0\', "gosacTicketName" character varying NOT NULL, "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_ab0d1e2c3f2274c8a16924bf29d" UNIQUE ("gosacTicketId"), CONSTRAINT "PK_52468190c75a6fb70201b3fba2d" PRIMARY KEY ("id"))',
    'CREATE TABLE "pontta_sales_orders" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "ponttaId" character varying NOT NULL, "code" character varying NOT NULL, "customerName" character varying NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_9170cdc7c4d3e2259970ee47867" UNIQUE ("ponttaId"), CONSTRAINT "PK_b90a9784a3087918ef38af511eb" PRIMARY KEY ("id"))',
    'CREATE TABLE "gosac_sales_order_links" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "gosacGroupId" uuid NOT NULL, "salesOrderId" uuid NOT NULL, "ponttaOccurrenceId" character varying, "ponttaOccurrenceNumber" integer, "ponttaOccurrenceStatus" character varying NOT NULL DEFAULT \'pending\', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_997b104e4a93e67c6c6492bf5c6" UNIQUE ("gosacGroupId", "salesOrderId"), CONSTRAINT "PK_0deb2822f593dd868f54510d62e" PRIMARY KEY ("id"))',
    'CREATE TABLE "auto_task_processed_orders" ("id" SERIAL NOT NULL, "sales_order_id" character varying(255) NOT NULL, "code" character varying(255) NOT NULL, "sale_date" date NOT NULL, "processed_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_274d398ed0e4c32a8be86d83dd1" UNIQUE ("code"), CONSTRAINT "PK_b7913e64786df4a43fe6fb19044" PRIMARY KEY ("id"))',
    'CREATE INDEX "IDX_55a7ece2907ecd5d98ace82f26" ON "auto_task_processed_orders" ("processed_at") ',
    'CREATE INDEX "IDX_c4107d284814350733d5ba2608" ON "auto_task_processed_orders" ("sale_date") ',
    'CREATE UNIQUE INDEX "IDX_274d398ed0e4c32a8be86d83dd" ON "auto_task_processed_orders" ("code") ',
    'ALTER TABLE "reports" ADD CONSTRAINT "FK_fddee96a7e01bddcc3e5eb610bf" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION',
    'ALTER TABLE "report_executions" ADD CONSTRAINT "FK_b63700d6af25c07e51ce1d277f8" FOREIGN KEY ("reportId") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    'ALTER TABLE "report_executions" ADD CONSTRAINT "FK_620534dd59d1ebc010b92709f1c" FOREIGN KEY ("executedById") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION',
    'ALTER TABLE "gosac_sales_order_links" ADD CONSTRAINT "FK_acb0031ebdd9ecc701085936cb7" FOREIGN KEY ("gosacGroupId") REFERENCES "gosac_groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
    'ALTER TABLE "gosac_sales_order_links" ADD CONSTRAINT "FK_81b92a7d33cc6f35701d3d20ae2" FOREIGN KEY ("salesOrderId") REFERENCES "pontta_sales_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
  ];

  private readonly down_queries = [
    'ALTER TABLE "gosac_sales_order_links" DROP CONSTRAINT "FK_81b92a7d33cc6f35701d3d20ae2"',
    'ALTER TABLE "gosac_sales_order_links" DROP CONSTRAINT "FK_acb0031ebdd9ecc701085936cb7"',
    'ALTER TABLE "report_executions" DROP CONSTRAINT "FK_620534dd59d1ebc010b92709f1c"',
    'ALTER TABLE "report_executions" DROP CONSTRAINT "FK_b63700d6af25c07e51ce1d277f8"',
    'ALTER TABLE "reports" DROP CONSTRAINT "FK_fddee96a7e01bddcc3e5eb610bf"',
    'DROP INDEX "public"."IDX_274d398ed0e4c32a8be86d83dd"',
    'DROP INDEX "public"."IDX_c4107d284814350733d5ba2608"',
    'DROP INDEX "public"."IDX_55a7ece2907ecd5d98ace82f26"',
    'DROP TABLE "auto_task_processed_orders"',
    'DROP TABLE "gosac_sales_order_links"',
    'DROP TABLE "pontta_sales_orders"',
    'DROP TABLE "gosac_groups"',
    'DROP TABLE "settings"',
    'DROP TABLE "scheduled_jobs"',
    'DROP TYPE "public"."scheduled_jobs_format_enum"',
    'DROP TYPE "public"."scheduled_jobs_frequency_enum"',
    'DROP TYPE "public"."scheduled_jobs_reporttype_enum"',
    'DROP TABLE "system_logs"',
    'DROP TABLE "dashboard_metrics"',
    'DROP TABLE "report_executions"',
    'DROP TYPE "public"."report_executions_status_enum"',
    'DROP TABLE "report_emails"',
    'DROP TABLE "reports"',
    'DROP TYPE "public"."reports_status_enum"',
    'DROP TYPE "public"."reports_type_enum"',
    'DROP TABLE "users"',
    'DROP TYPE "public"."users_status_enum"',
    'DROP TYPE "public"."users_role_enum"',
  ];

  public async up(q: QueryRunner): Promise<void> {
    if (await q.hasTable('users')) return;
    await q.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    for (const sql of this.up_queries) await q.query(sql);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const sql of this.down_queries) await q.query(sql);
  }
}
