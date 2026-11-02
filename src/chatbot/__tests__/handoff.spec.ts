import { ChatbotHandoffService } from '../services/chatbot-handoff.service';
import { MESSAGES } from '../domain/chatbot.messages';

describe('ChatbotHandoffService', () => {
  const build = (compose: (c: any, t: string[]) => Promise<string[]>) => {
    const messenger = {
      sendTexts: jest.fn(),
      sendText: jest.fn(),
      updateTicket: jest.fn(),
    };
    const humanizer = { compose: jest.fn(compose) };
    const rotation = {
      next: jest.fn(async () => ({
        ponttaId: 'p1',
        name: 'Carla',
        gosacUserId: 7,
        gosacQueueId: 3,
      })),
    };
    const config = {
      chatbot: { ponttaEnabled: false },
      ponttaCredentials: {},
    } as any;
    const svc = new ChatbotHandoffService(
      config,
      messenger as any,
      rotation as any,
      {} as any,
      humanizer as any,
    );
    return { svc, messenger, humanizer, rotation };
  };
  const conv = { ticketId: 10, nome: 'Ana Paula', contactId: 1 } as any;

  it('a mensagem de encaminhamento passa pelo Redator antes de ir ao cliente', async () => {
    const t = build(async () => ['Tudo certo, Ana! Já te passo para o time.']);
    await t.svc.execute(conv, 'redirecionando_com_nome');
    expect(t.humanizer.compose).toHaveBeenCalledTimes(1);
    expect((t.humanizer.compose.mock.calls[0] as any)[1][0]).toContain(
      '*Ana Paula*',
    );
    expect(t.messenger.sendTexts).toHaveBeenCalledWith(10, [
      'Tudo certo, Ana! Já te passo para o time.',
    ]);
  });

  it('entrega o ticket mesmo se a escrita da mensagem falhar', async () => {
    const t = build(async () => {
      throw new Error('ia fora');
    });
    const r = await t.svc.execute(conv, 'redirecionando');
    expect(t.messenger.updateTicket).toHaveBeenCalledWith(10, {
      userId: 7,
      queueId: 3,
      status: 'pending',
    });
    expect(r.error).toContain('mensagem');
  });

  it('usa o texto padrão do catálogo como referência', async () => {
    const t = build(async (_c, texts) => texts);
    await t.svc.execute(conv, 'redirecionando');
    expect(t.messenger.sendTexts).toHaveBeenCalledWith(10, [
      MESSAGES.redirecionando_projetistas,
    ]);
  });
});
