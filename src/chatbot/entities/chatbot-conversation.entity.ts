import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { SlotOption, Step, Trilha } from '../domain/chatbot.types';

export interface HistoryTurn {
  role: 'cliente' | 'bot';
  text: string;
}

/** Estado de cada cliente no chatbot (substitui a tabela tb_mensagem_cliente do n8n). */
@Entity('chatbot_conversations')
export class ChatbotConversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'contact_id', type: 'int' })
  contactId: number;

  @Column({ name: 'ticket_id', type: 'int' })
  ticketId: number;

  @Column({ type: 'varchar', length: 32, nullable: true })
  numero: string | null;

  /** Nome que veio do GOSAC (pode diferir do nome confirmado pelo cliente). */
  @Column({
    name: 'contact_name',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  contactName: string | null;

  @Column({ type: 'varchar', length: 24, default: 'MENU' })
  step: Step;

  @Column({ type: 'varchar', length: 16, nullable: true })
  trilha: Trilha | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  nome: string | null;

  @Column({
    name: 'nome_pendente',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  nomePendente: string | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  local: 'casa' | 'ap' | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  categorias: number[];

  @Column({ type: 'int', default: 0 })
  arquivos: number;

  @Column({ name: 'invalid_count', type: 'int', default: 0 })
  invalidCount: number;

  @Column({ name: 'off_topic_count', type: 'int', default: 0 })
  offTopicCount: number;

  @Column({ type: 'jsonb', nullable: true })
  slots: SlotOption[] | null;

  @Column({ name: 'em_atendimento', type: 'boolean', default: false })
  emAtendimento: boolean;

  @Column({ name: 'finalizou_triagem', type: 'boolean', default: false })
  finalizouTriagem: boolean;

  @Column({
    name: 'drive_folder_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  driveFolderId: string | null;

  /** Atendente GOSAC escolhido pelo rodízio (usado no "reconhecimento"). */
  @Column({ name: 'atendente_id', type: 'int', nullable: true })
  atendenteId: number | null;

  @Column({ name: 'fila_id', type: 'int', nullable: true })
  filaId: number | null;

  @Column({ name: 'agendamento_start', type: 'timestamptz', nullable: true })
  agendamentoStart: Date | null;

  @Column({ name: 'handoff_error', type: 'text', nullable: true })
  handoffError: string | null;

  /** Últimas mensagens (curtas) usadas como contexto para a IA. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  history: HistoryTurn[];

  /** IDs das últimas mensagens processadas (idempotência contra reenvio do webhook). */
  @Column({ name: 'processed_ids', type: 'jsonb', default: () => "'[]'" })
  processedIds: string[];

  @Column({ name: 'ai_calls_day', type: 'int', default: 0 })
  aiCallsDay: number;

  @Column({
    name: 'ai_calls_date',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  aiCallsDate: string | null;

  @Column({
    name: 'last_message_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  lastMessageAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
