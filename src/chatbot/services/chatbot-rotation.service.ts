import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface RotationPick {
  /** ID do projetista no Pontta (tb_rotation.id). */
  ponttaId: string;
  name: string | null;
  gosacUserId: number;
  gosacQueueId: number | null;
}

/**
 * Rodízio de projetistas (tabela tb_rotation, banco "rotation").
 * Diferença para o n8n: seleção e avanço do turno acontecem na MESMA transação com
 * `FOR UPDATE`, então dois clientes simultâneos nunca caem no mesmo projetista.
 */
@Injectable()
export class ChatbotRotationService {
  private readonly logger = new Logger(ChatbotRotationService.name);

  constructor(
    @Optional()
    @Inject(getDataSourceToken('rotation'))
    private readonly dataSource?: DataSource,
  ) {}

  get available(): boolean {
    return !!this.dataSource?.isInitialized;
  }

  /** Devolve quem está "na vez" e passa o turno para o próximo (circular). Null se o rodízio não estiver disponível/vazio. */
  async next(): Promise<RotationPick | null> {
    if (!this.available) return null;

    const qr = this.dataSource!.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const rows: Array<{
        id: string;
        name: string | null;
        turn: boolean | null;
        identificacao: number | null;
        queueid: number | null;
      }> = await qr.query(
        'SELECT id, name, turn, identificacao, queueid FROM tb_rotation ORDER BY id FOR UPDATE',
      );

      const eligible = rows.filter((r) => r.identificacao != null);
      if (!eligible.length) {
        await qr.rollbackTransaction();
        return null;
      }

      let currentIdx = eligible.findIndex((r) => r.turn === true);
      if (currentIdx === -1) currentIdx = 0;
      const current = eligible[currentIdx];
      const next = eligible[(currentIdx + 1) % eligible.length];

      await qr.query(
        'UPDATE tb_rotation SET turn = false WHERE turn IS DISTINCT FROM false',
      );
      await qr.query('UPDATE tb_rotation SET turn = true WHERE id = $1', [
        next.id,
      ]);
      await qr.commitTransaction();

      return {
        ponttaId: current.id,
        name: current.name,
        gosacUserId: Number(current.identificacao),
        gosacQueueId: current.queueid != null ? Number(current.queueid) : null,
      };
    } catch (error) {
      await qr.rollbackTransaction().catch(() => undefined);
      this.logger.error(
        `Falha ao avançar rodízio: ${(error as Error).message}`,
      );
      return null;
    } finally {
      await qr.release();
    }
  }
}
