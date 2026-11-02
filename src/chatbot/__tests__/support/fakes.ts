import type { Inbound } from '../../services/chatbot.service';

/** Caixa de entrada em memória, com a mesma semântica da tabela (id crescente, message_id único). */
export class FakeInbox {
  rows: Array<{
    id: string;
    messageId: string;
    contactId: number;
    msg: Inbound;
    receivedAt: Date;
    processedAt: Date | null;
  }> = [];
  private seq = 0;

  add = async (msg: Inbound): Promise<boolean> => {
    const messageId = msg.messageId ?? `auto-${this.seq}`;
    if (this.rows.some((r) => r.messageId === messageId)) return false;
    this.rows.push({
      id: String(++this.seq),
      messageId,
      contactId: msg.contactId,
      msg,
      receivedAt: new Date(),
      processedAt: null,
    });
    return true;
  };
  pending = async (contactId: number) =>
    this.rows
      .filter((r) => r.contactId === contactId && !r.processedAt)
      .map((r) => ({ id: r.id, receivedAt: r.receivedAt, msg: r.msg }));
  markProcessed = async (ids: string[]) => {
    this.rows
      .filter((r) => ids.includes(r.id))
      .forEach((r) => (r.processedAt = new Date()));
  };
  staleContacts = async (olderThanMs: number) => [
    ...new Set(
      this.rows
        .filter(
          (r) =>
            !r.processedAt &&
            Date.now() - r.receivedAt.getTime() >= olderThanMs,
        )
        .map((r) => r.contactId),
    ),
  ];
  purge = async () => 0;
}

/** Trava por cliente: simula o advisory lock (um dono por vez, "entre instâncias"). */
export class FakeLock {
  held = new Set<number>();
  tryLock = async (contactId: number) => {
    if (this.held.has(contactId)) return null;
    this.held.add(contactId);
    return async () => void this.held.delete(contactId);
  };
  withLock = async (contactId: number, fn: () => Promise<void>) => {
    const release = await this.tryLock(contactId);
    if (!release) return false;
    try {
      await fn();
    } finally {
      await release();
    }
    return true;
  };
}
