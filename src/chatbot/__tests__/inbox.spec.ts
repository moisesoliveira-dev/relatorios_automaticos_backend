import { ChatbotService, Inbound } from '../services/chatbot.service';
import { FakeInbox, FakeLock } from './support/fakes';
import { MESSAGES } from '../domain/chatbot.messages';

/**
 * Coordenação entre instâncias usando só o Postgres: caixa de entrada durável + trava por cliente.
 * Aqui os dois são simulados em memória; o comportamento real foi validado com duas instâncias e Postgres.
 */
function build(
  over: { debounceMs?: number; inbox?: FakeInbox; lock?: FakeLock } = {},
) {
  const inbox = over.inbox ?? new FakeInbox();
  const lock = over.lock ?? new FakeLock();
  const rows: any[] = [];
  const repo = {
    create: (o: any) => ({ ...o }),
    findOne: async ({ where }: any) =>
      rows.find((r) => r.contactId === where.contactId) ?? null,
    save: async (o: any) => {
      const i = rows.findIndex((r) => r.contactId === o.contactId);
      i >= 0 ? (rows[i] = o) : rows.push(o);
      return o;
    },
    delete: async () => ({ affected: 0 }),
    count: async () => 0,
  };
  const sent: string[] = [];
  const messenger = {
    sendTexts: jest.fn(async (_t: number, x: string[]) => void sent.push(...x)),
    sendText: jest.fn(),
    updateTicket: jest.fn(),
  };
  const config = {
    chatbot: {
      enabled: true,
      debounceMs: over.debounceMs ?? 30,
      maxInvalid: 3,
      maxOffTopic: 3,
      aiDailyLimit: 50,
      humanIdleMinutes: 60,
      ponttaEnabled: false,
    },
    gosacApi: { baseUrl: 'https://gosac.exemplo.com', apiKey: 'k' },
    openai: { model: 'm' },
  } as any;
  const agents = {
    available: false,
    counters: {},
    resolve: jest.fn(async () => ({ kind: 'invalid' })),
  };
  const humanizer = {
    compose: async (_c: unknown, t: string[]) => t,
    counters: {},
    rejections: {},
  };
  const service = new ChatbotService(
    config,
    repo as any,
    {} as any,
    messenger as any,
    { enabled: false, breakerOpen: false } as any,
    agents as any,
    humanizer as any,
    { execute: jest.fn() } as any,
    {} as any,
    {} as any,
    inbox as any,
    lock as any,
  );
  const msg = (
    id: string,
    text: string,
    o: Partial<Inbound> = {},
  ): Inbound => ({
    messageId: id,
    contactId: 7,
    ticketId: 70,
    body: text,
    fromMe: false,
    isGroup: false,
    ticketCreatedAt: new Date(),
    numero: '55',
    ...o,
  });
  const payload = (m: Inbound) => ({
    data: {
      id: m.messageId,
      contactId: m.contactId,
      ticketId: m.ticketId,
      body: m.body,
      fromMe: m.fromMe,
      ticket: {
        createdAt: new Date().toISOString(),
        contact: { isGroup: false },
      },
    },
  });
  const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));
  return { service, inbox, lock, sent, rows, msg, payload, settle, messenger };
}

describe('caixa de entrada + trava (Postgres)', () => {
  it('toda mensagem é gravada antes de ser processada e depois marcada como feita', async () => {
    const t = build();
    t.service.receive(t.payload(t.msg('a', 'Oi')));
    await t.settle(10);
    expect(t.inbox.rows).toHaveLength(1);
    expect(t.inbox.rows[0].processedAt).toBeNull(); // ainda no debounce
    await t.settle();
    expect(t.inbox.rows[0].processedAt).not.toBeNull();
    expect(t.sent[0]).toBe(MESSAGES.menu_inicial);
  });

  it('mensagens picadas viram UMA só resposta (debounce na caixa de entrada)', async () => {
    const t = build({ debounceMs: 80 });
    const spy = jest.spyOn(t.service, 'process');
    t.service.receive(t.payload(t.msg('a', 'oi')));
    await t.settle(30);
    t.service.receive(t.payload(t.msg('b', 'quero um projeto')));
    await t.settle(30);
    t.service.receive(t.payload(t.msg('c', 'de cozinha')));
    await t.settle(400);
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0][0] as any).texts).toEqual([
      'oi',
      'quero um projeto',
      'de cozinha',
    ]);
    expect(t.inbox.rows.every((r) => r.processedAt)).toBe(true);
  });

  it('o mesmo webhook chegando duas vezes (ou em duas instâncias) é processado uma vez', async () => {
    const t = build();
    const spy = jest.spyOn(t.service, 'process');
    const p = t.payload(t.msg('dup', 'Oi'));
    t.service.receive(p);
    t.service.receive(p);
    t.service.receive(p);
    await t.settle();
    expect(t.inbox.rows).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('se outra instância está atendendo o cliente, esta não processa em paralelo', async () => {
    const t = build();
    const spy = jest.spyOn(t.service, 'process');
    t.lock.held.add(7); // "outra instância" com a trava
    t.service.receive(t.payload(t.msg('a', 'Oi')));
    await t.settle(150);
    expect(spy).not.toHaveBeenCalled();
    expect(t.inbox.rows[0].processedAt).toBeNull(); // continua na fila, nada se perde

    t.lock.held.delete(7); // a outra instância terminou
    await t.settle(1800); // nova tentativa agendada
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('reinício: mensagens que ficaram na caixa são retomadas pela varredura', async () => {
    const inbox = new FakeInbox();
    const old = new Date(Date.now() - 60_000);
    await inbox.add({
      messageId: 'x',
      contactId: 9,
      ticketId: 90,
      body: 'Oi',
      fromMe: false,
      isGroup: false,
      ticketCreatedAt: new Date(),
    } as Inbound);
    inbox.rows[0].receivedAt = old; // ficou parada antes do "reinício"
    const t = build({ inbox });
    const spy = jest.spyOn(t.service, 'process');
    await t.service.sweep();
    await t.settle(600);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(inbox.rows[0].processedAt).not.toBeNull();
  });

  it('erro ao processar não trava a fila: a mensagem é marcada como feita e a trava é liberada', async () => {
    const t = build();
    jest.spyOn(t.service, 'process').mockRejectedValueOnce(new Error('falhou'));
    t.service.receive(t.payload(t.msg('a', 'Oi')));
    await t.settle();
    expect(t.inbox.rows[0].processedAt).not.toBeNull();
    expect(t.lock.held.size).toBe(0);
  });

  it('chegou mensagem nova durante o processamento: é atendida no mesmo ciclo, sem ficar para trás', async () => {
    const t = build({ debounceMs: 30 });
    const spy = jest
      .spyOn(t.service, 'process')
      .mockImplementationOnce(async () => {
        t.service.receive(t.payload(t.msg('late', 'mais uma coisa')));
        await new Promise((r) => setTimeout(r, 10));
      });
    t.service.receive(t.payload(t.msg('a', 'Oi')));
    await t.settle(500);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(t.inbox.rows.every((r) => r.processedAt)).toBe(true);
  });

  it('assinatura de atendente humano usa a trava do cliente', async () => {
    const t = build();
    t.service.receive({
      data: {
        id: 'h1',
        contactId: 7,
        ticketId: 70,
        body: '*Carlos:*\nBom dia',
        fromMe: true,
        ticket: {
          createdAt: new Date().toISOString(),
          contact: { isGroup: false },
        },
      },
    });
    await t.settle(100);
    expect(t.rows[0]).toMatchObject({ step: 'HUMANO', emAtendimento: true });
    expect(t.lock.held.size).toBe(0);
  });

  it('desligado: nada é gravado', async () => {
    const t = build();
    (t.service as any).appConfig.chatbot.enabled = false;
    t.service.receive(t.payload(t.msg('a', 'Oi')));
    await t.settle(100);
    expect(t.inbox.rows).toHaveLength(0);
  });
});
