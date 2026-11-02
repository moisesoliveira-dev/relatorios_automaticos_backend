import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

const NAMESPACE = 7021; // primeira chave do par do advisory lock: separa do resto da aplicação
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type Release = () => Promise<void>;

/**
 * Trava por cliente usando advisory lock do Postgres. Vale entre instâncias do backend e é liberada
 * sozinha se a conexão cair (o processo morrer), então nunca fica presa.
 */
@Injectable()
export class ChatbotLockService {
  private readonly logger = new Logger(ChatbotLockService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Tenta pegar a trava agora. Devolve a função de liberar, ou null se outro processo está com ela. */
  async tryLock(contactId: number): Promise<Release | null> {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    try {
      const [{ ok }] = await qr.query(
        'SELECT pg_try_advisory_lock($1, $2) AS ok',
        [NAMESPACE, contactId],
      );
      if (!ok) {
        await qr.release();
        return null;
      }
    } catch (error) {
      await qr.release().catch(() => undefined);
      throw error;
    }
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      try {
        await qr.query('SELECT pg_advisory_unlock($1, $2)', [
          NAMESPACE,
          contactId,
        ]);
      } catch (error) {
        this.logger.warn(
          `Falha ao liberar trava do contato ${contactId}: ${(error as Error).message}`,
        );
      } finally {
        await qr.release().catch(() => undefined);
      }
    };
  }

  /** Espera até `waitMs` pela trava; executa `fn` com ela e libera no fim. Devolve false se não conseguiu. */
  async withLock(
    contactId: number,
    fn: () => Promise<void>,
    waitMs = 5000,
  ): Promise<boolean> {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const release = await this.tryLock(contactId);
      if (release) {
        try {
          await fn();
        } finally {
          await release();
        }
        return true;
      }
      if (Date.now() >= deadline) return false;
      await sleep(150);
    }
  }
}
