import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Caixa de entrada durável do chatbot. Toda mensagem do cliente é gravada aqui assim que o
 * webhook chega — antes de qualquer processamento. Isso dá, usando só o Postgres:
 *  - deduplicação entre instâncias (message_id único);
 *  - debounce de mensagens picadas (espera ficar quieto e junta tudo);
 *  - nenhuma mensagem perdida se o backend reiniciar no meio.
 */
@Entity('chatbot_inbox')
export class ChatbotInboxMessage {
  /** bigint volta como string no driver pg. */
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Index({ unique: true })
  @Column({ name: 'message_id', type: 'varchar', length: 80 })
  messageId: string;

  @Index()
  @Column({ name: 'contact_id', type: 'int' })
  contactId: number;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ name: 'received_at', type: 'timestamptz', default: () => 'now()' })
  receivedAt: Date;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt: Date | null;
}
