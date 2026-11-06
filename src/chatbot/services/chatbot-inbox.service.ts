import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { In, Repository } from 'typeorm';
import { ChatbotInboxMessage } from '../entities/chatbot-inbox-message.entity';
import type { Inbound } from './chatbot.service';

export interface PendingMessage {
  id: string;
  receivedAt: Date;
  msg: Inbound;
}

@Injectable()
export class ChatbotInboxService {
  constructor(
    @InjectRepository(ChatbotInboxMessage)
    private readonly repo: Repository<ChatbotInboxMessage>,
  ) {}

  /** Grava a mensagem. Devolve false se já existia (webhook repetido, em qualquer instância). */
  async add(msg: Inbound): Promise<boolean> {
    const result = await this.repo
      .createQueryBuilder()
      .insert()
      .into(ChatbotInboxMessage)
      .values({
        messageId: msg.messageId ?? randomUUID(),
        contactId: msg.contactId,
        payload: JSON.parse(JSON.stringify(msg)),
      })
      .orIgnore()
      .execute();
    return (result.raw?.length ?? 0) > 0;
  }

  async pending(contactId: number): Promise<PendingMessage[]> {
    const rows = await this.repo
      .createQueryBuilder('m')
      .where('m.contact_id = :contactId AND m.processed_at IS NULL', {
        contactId,
      })
      .orderBy('m.id', 'ASC')
      .getMany();
    return rows.map((r) => {
      const msg = r.payload as unknown as Inbound;
      if (msg.ticketCreatedAt)
        msg.ticketCreatedAt = new Date(msg.ticketCreatedAt);
      return { id: r.id, receivedAt: new Date(r.receivedAt), msg };
    });
  }

  async markProcessed(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await this.repo.update({ id: In(ids) }, { processedAt: new Date() });
  }

  /** Contatos com mensagens paradas há mais de `olderThanMs` (instância caiu, reinício, retry esgotado). */
  async staleContacts(olderThanMs: number): Promise<number[]> {
    const rows: Array<{ contact_id: number }> = await this.repo
      .createQueryBuilder('m')
      .select('DISTINCT m.contact_id', 'contact_id')
      .where('m.processed_at IS NULL AND m.received_at < :cut', {
        cut: new Date(Date.now() - olderThanMs),
      })
      .getRawMany();
    return rows.map((r) => Number(r.contact_id));
  }

  /** Privacidade: o texto do cliente não fica guardado aqui além de 1 dia. */
  async purge(): Promise<number> {
    const res = await this.repo
      .createQueryBuilder()
      .delete()
      .where('received_at < :cut', {
        cut: new Date(Date.now() - 24 * 3600_000),
      })
      .execute();
    return res.affected ?? 0;
  }
}
