import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
import { PonttaService } from '../../pontta/pontta.service';
import { ChatbotBookedSlot } from '../entities/chatbot-booked-slot.entity';
import {
  computeSlots,
  MANAUS_OFFSET_MS,
  SlotOption,
} from '../domain/scheduling';

const HORIZON_DAYS = 21;

/** Formato sem fuso que a API de agenda do Pontta usa na consulta: 2025-07-04T07:00:00 */
const toNaive = (d: Date) => d.toISOString().slice(0, 19);

@Injectable()
export class ChatbotSchedulingService {
  private readonly logger = new Logger(ChatbotSchedulingService.name);

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly pontta: PonttaService,
    @InjectRepository(ChatbotBookedSlot)
    private readonly booked: Repository<ChatbotBookedSlot>,
  ) {}

  private get ownerId(): string {
    return this.appConfig.chatbot.measureOwnerId ?? '';
  }

  private async token(): Promise<string> {
    const { email, password } = this.appConfig.ponttaCredentials;
    return this.pontta.authenticate(email, password);
  }

  /** Horários livres a partir de agora (agenda do Pontta + reservas feitas pelo próprio bot). */
  async offer(now = new Date()): Promise<SlotOption[]> {
    const token = await this.token();
    const end = new Date(now.getTime() + HORIZON_DAYS * 24 * 3600_000);
    const events = await this.pontta.getSchedules(
      token,
      toNaive(now),
      toNaive(end),
      this.ownerId,
    );

    const busy = events
      .filter((e) => e?.start && e?.end)
      .map((e) => ({ start: new Date(e.start), end: new Date(e.end) }))
      .filter((b) => !isNaN(b.start.getTime()) && !isNaN(b.end.getTime()));

    const reserved = await this.booked
      .createQueryBuilder('b')
      .where('b.end_utc > :now', { now })
      .getMany();
    reserved.forEach((r) => busy.push({ start: r.startUtc, end: r.endUtc }));

    return computeSlots(now, busy);
  }

  /**
   * Reserva o horário de forma atômica e cria o compromisso no Pontta.
   * Devolve false se o horário já não está livre (outro cliente ou agenda alterada).
   */
  async book(
    slot: SlotOption,
    contactId: number,
    note: string,
  ): Promise<boolean> {
    // 1) Ainda está livre? (relê a agenda — outra pessoa pode ter ocupado depois da oferta)
    const fresh = await this.offer();
    if (!fresh.some((s) => s.startUtc === slot.startUtc)) return false;

    // 2) Reserva atômica: a chave primária garante um único vencedor.
    try {
      await this.booked.insert({
        startUtc: new Date(slot.startUtc),
        endUtc: new Date(slot.endUtc),
        contactId,
      });
    } catch {
      return false;
    }

    // 3) Cria o compromisso; se falhar, libera a reserva.
    try {
      const token = await this.token();
      await this.pontta.createSchedule(token, {
        title: 'Tirar medidas: ',
        note,
        ownerId: this.ownerId,
        start: slot.startUtc,
        end: slot.endUtc,
      });
      return true;
    } catch (error) {
      await this.booked.delete({ startUtc: new Date(slot.startUtc) });
      this.logger.error(
        `Falha ao criar compromisso de medição: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /** Remove reservas antigas (já passaram; o Pontta passa a ser a fonte de verdade). */
  async cleanup(now = new Date()): Promise<void> {
    await this.booked
      .createQueryBuilder()
      .delete()
      .where('end_utc < :cut', {
        cut: new Date(now.getTime() - MANAUS_OFFSET_MS - 24 * 3600_000),
      })
      .execute();
  }
}
