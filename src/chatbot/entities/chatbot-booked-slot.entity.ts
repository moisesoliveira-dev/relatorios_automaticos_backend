import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * Reserva atômica de horário de medição. A chave primária impede que dois clientes
 * reservem o mesmo horário ao mesmo tempo (o n8n usava uma tabela global sem trava).
 */
@Entity('chatbot_booked_slots')
export class ChatbotBookedSlot {
  @PrimaryColumn({ name: 'start_utc', type: 'timestamptz' })
  startUtc: Date;

  @Column({ name: 'end_utc', type: 'timestamptz' })
  endUtc: Date;

  @Column({ name: 'contact_id', type: 'int' })
  contactId: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
