import {
  ChatbotService,
  Inbound,
  parseWebhook,
} from '../services/chatbot.service';
import { FakeInbox, FakeLock } from './support/fakes';
import { ChatbotHumanizerService } from '../services/chatbot-humanizer.service';
import { ChatbotAdminService } from '../services/chatbot-admin.service';
import { MESSAGES } from '../domain/chatbot.messages';
import {
  ChatbotContentService,
  emptyDoc,
} from '../services/chatbot-content.service';
import {
  CustomFlow,
  checkFlow,
  startFlow,
  stepFlow,
} from '../domain/custom-flow';

type Row = Record<string, any>;

class MemoryRepo {
  rows: Row[] = [];
  create = (o: Row) => ({ ...o });
  findOne = async ({ where }: any) =>
    this.rows.find((r) => r.contactId === where.contactId) ?? null;
  save = async (o: Row) => {
    const i = this.rows.findIndex((r) => r.contactId === o.contactId);
    if (i >= 0) this.rows[i] = o;
    else this.rows.push(o);
    return o;
  };
  count = async () => 0;
  delete = async () => ({ affected: 0 });
}

function setup(over: { ai?: any; chatbot?: Record<string, unknown> } = {}) {
  const repo = new MemoryRepo();
  const sent: string[] = [];
  const messenger = {
    sendTexts: jest.fn(
      async (_t: number, texts: string[]) => void sent.push(...texts),
    ),
    sendText: jest.fn(),
    updateTicket: jest.fn(),
    downloadMedia: jest.fn(async () => ({
      data: Buffer.from('x'),
      contentType: 'application/pdf',
      filename: 'p.pdf',
    })),
  };
  const ai = { enabled: true, breakerOpen: false };
  const agents = over.ai ?? {
    available: true,
    counters: {},
    resolve: jest.fn(async (): Promise<any> => ({ kind: 'invalid' })),
  };
  const inbox = new FakeInbox();
  const lock = new FakeLock();
  const humanizer = {
    compose: jest.fn(async (_c: unknown, texts: string[]) => texts),
    counters: {},
    rejections: {},
  };
  const handoff = {
    execute: jest.fn(async () => ({ atendenteId: 7, filaId: 3, error: null })),
  };
  const drive = {
    ensureClientFolder: jest.fn(async () => 'pasta-1'),
    saveFile: jest.fn(async () => undefined),
    savePreferences: jest.fn(async () => undefined),
    saveAnswers: jest.fn(async () => undefined),
  };
  const scheduling = {
    offer: jest.fn(async () => []),
    book: jest.fn(),
    cleanup: jest.fn(),
  };
  const config = {
    chatbot: {
      enabled: true,
      humanize: false,
      debounceMs: 5,
      maxInvalid: 3,
      maxOffTopic: 3,
      aiDailyLimit: 2,
      humanIdleMinutes: 60,
      ponttaEnabled: false,
      ...over.chatbot,
    },
    gosacApi: { baseUrl: 'https://gosac.exemplo.com', apiKey: 'k' },
    openai: { model: 'm' },
  } as any;

  const service = new ChatbotService(
    config,
    repo as any,
    {} as any,
    messenger as any,
    ai as any,
    agents as any,
    humanizer as any,
    handoff as any,
    drive as any,
    scheduling as any,
    inbox as any,
    lock as any,
  );
  let n = 0;
  const msg = (text: string, o: Partial<Inbound> = {}): Inbound => ({
    messageId: `m${++n}`,
    contactId: 10,
    ticketId: 100,
    body: text,
    fromMe: false,
    isGroup: false,
    ticketCreatedAt: new Date(),
    contactName: 'Contato',
    numero: '5592999990000',
    ...o,
  });
  const say = async (
    text: string,
    o: Partial<Inbound> = {},
    files: Inbound[] = [],
  ) => {
    sent.length = 0;
    const m = msg(text, o);
    await service.process({
      texts: text ? [text] : [],
      files,
      audio: o.mediaType === 'ptt',
      last: m,
    });
    return [...sent];
  };
  return {
    service,
    repo,
    sent,
    messenger,
    ai,
    agents,
    handoff,
    drive,
    say,
    msg,
  };
}

const flow = (over: Partial<CustomFlow> = {}): CustomFlow => ({
  id: 'orcamento_rapido',
  nome: 'Orçamento rápido',
  ativo: true,
  menuOpcao: 6,
  nos: [
    {
      id: 'n1',
      tipo: 'pergunta',
      titulo: 'Nome',
      texto: 'Qual é o seu nome?',
      variavel: 'nome',
      validacao: 'nome',
      proximo: 'n2',
    },
    {
      id: 'n2',
      tipo: 'acao',
      titulo: 'Pasta',
      acao: 'drive_criar_pasta',
      proximo: 'n3',
    },
    {
      id: 'n3',
      tipo: 'opcoes',
      titulo: 'Ambiente',
      texto: 'O que você precisa, {nome}?',
      variavel: 'ambiente',
      opcoes: [
        { rotulo: 'Cozinha', proximo: 'n4' },
        { rotulo: 'Quarto', proximo: 'n4' },
      ],
    },
    {
      id: 'n4',
      tipo: 'arquivos',
      titulo: 'Fotos',
      texto: 'Envie fotos do espaço.',
      minimo: 1,
      proximo: 'n5',
    },
    {
      id: 'n5',
      tipo: 'acao',
      titulo: 'Respostas',
      acao: 'drive_salvar_respostas',
      proximo: 'n6',
    },
    {
      id: 'n6',
      tipo: 'encaminhar',
      titulo: 'Atendente',
      texto: 'Obrigada, {nome}! Já chamo alguém.',
    },
  ],
  ...over,
});

describe('motor de fluxos personalizados', () => {
  it('flow válido não tem problemas', () => {
    expect(checkFlow(flow())).toEqual([]);
  });

  it('detecta os erros que quebrariam a conversa', () => {
    const base = flow();
    const semPasta = {
      ...base,
      nos: base.nos
        .filter((n) => n.tipo !== 'acao')
        .map((n) => (n.id === 'n1' ? { ...n, proximo: 'n3' } : n)),
    };
    expect(checkFlow(semPasta).join(' ')).toMatch(/pasta do cliente/);
    const destino = {
      ...base,
      nos: base.nos.map((n) => (n.id === 'n1' ? { ...n, proximo: 'xx' } : n)),
    };
    expect(checkFlow(destino).join(' ')).toMatch(/não existe mais/);
    const variavel = {
      ...base,
      nos: base.nos.map((n) =>
        n.id === 'n3' ? { ...n, texto: 'Olá {bairro}' } : n,
      ),
    };
    expect(checkFlow(variavel).join(' ')).toMatch(/\{bairro\}/);
    const ciclo = {
      id: 'c',
      nome: 'c',
      ativo: false,
      menuOpcao: null,
      nos: [
        { id: 'a', tipo: 'mensagem', titulo: 'a', texto: 'a', proximo: 'b' },
        { id: 'b', tipo: 'mensagem', titulo: 'b', texto: 'b', proximo: 'a' },
        { id: 'f', tipo: 'fim', titulo: 'f' },
      ],
    } as CustomFlow;
    expect(checkFlow(ciclo).join(' ')).toMatch(/ciclo/);
  });

  it('percorre o fluxo: roda blocos automáticos, valida, volta e recomeça', () => {
    const f = flow();
    let r = startFlow(f);
    expect(r.replies[0]).toContain('Qual é o seu nome?');
    expect(r.state?.nodeId).toBe('n1');
    // nome inválido: avisa uma vez, depois silêncio
    let s = stepFlow(
      f,
      r.state!,
      { text: 'oi', hasFile: false },
      { maxInvalid: 3 },
    );
    expect(s.replies[0]).toBe(MESSAGES.invalida_nome);
    s = stepFlow(
      f,
      s.state!,
      { text: 'oi', hasFile: false },
      { maxInvalid: 3 },
    );
    expect(s.replies).toEqual([]);
    // nome válido → cria pasta e já mostra as opções com o nome preenchido
    s = stepFlow(
      f,
      s.state!,
      { text: 'Ana Paula', hasFile: false },
      { maxInvalid: 3 },
    );
    expect(s.nome).toBe('Ana Paula');
    expect(s.effects).toEqual([{ type: 'criar_pasta' }]);
    expect(s.replies[0]).toContain('O que você precisa, Ana Paula?');
    expect(s.replies[0]).toContain('*2* - Quarto');
    // "0" volta para a pergunta de nome; opção por número ou pelo nome da opção
    const back = stepFlow(
      f,
      s.state!,
      { text: '0', hasFile: false },
      { maxInvalid: 3 },
    );
    expect(back.state?.nodeId).toBe('n1');
    const porNome = stepFlow(
      f,
      s.state!,
      { text: 'quarto', hasFile: false },
      { maxInvalid: 3 },
    );
    expect(porNome.state?.vars.ambiente).toBe('Quarto');
    // "10" sai para o menu
    expect(
      stepFlow(f, s.state!, { text: '10', hasFile: false }, { maxInvalid: 3 })
        .saiu,
    ).toBe('menu');
  });

  it('arquivos: exige o mínimo antes do OK; pedido de atendente encaminha', () => {
    const f = flow();
    const st = {
      flowId: f.id,
      nodeId: 'n4',
      historico: [],
      vars: { nome: 'Ana', ambiente: 'Cozinha' },
      arquivos: 0,
      invalidos: 0,
    };
    expect(
      stepFlow(f, st, { text: 'ok', hasFile: false }, { maxInvalid: 3 }).state
        ?.nodeId,
    ).toBe('n4');
    const um = stepFlow(f, st, { text: '', hasFile: true }, { maxInvalid: 3 });
    expect(um.state?.arquivos).toBe(1);
    const fim = stepFlow(
      f,
      um.state!,
      { text: 'ok', hasFile: false },
      { maxInvalid: 3 },
    );
    expect(fim.saiu).toBe('encaminhado');
    expect(fim.effects.map((e) => e.type)).toEqual([
      'salvar_respostas',
      'handoff',
    ]);
    expect(fim.effects[0]).toMatchObject({
      itens: expect.arrayContaining([{ rotulo: 'Ambiente', valor: 'Cozinha' }]),
    });
    const humano = stepFlow(
      f,
      st,
      { text: 'quero falar com um atendente', hasFile: false },
      { maxInvalid: 3 },
    );
    expect(humano.saiu).toBe('encaminhado');
  });
});

describe('fluxo personalizado dentro do ChatbotService', () => {
  const publicar = async (fluxos: CustomFlow[]) => {
    const rows = new Map<string, { value: string; category: string }>();
    const settings = {
      getAllDecrypted: async () =>
        [...rows].map(([key, r]) => ({
          key,
          ...r,
          isEncrypted: false,
          description: '',
        })),
      upsert: async (k: string, v: string, c: string) =>
        void rows.set(k, { value: v, category: c }),
      delete: async (k: string) => void rows.delete(k),
    };
    const content = new ChatbotContentService(settings as any);
    await content.saveDraft({ ...emptyDoc(), fluxos }, null);
    await content.publish(null);
    return content;
  };
  afterEach(() => new ChatbotContentService({} as any).apply(emptyDoc()));

  it('opção do menu abre o fluxo, usa o Drive e entrega ao atendente com o texto próprio', async () => {
    await publicar([flow()]);
    const t = setup();
    const menu = await t.say('Oi');
    expect(menu.join('\n')).toContain('*6* - Orçamento rápido');
    expect((await t.say('6')).join('\n')).toContain('Qual é o seu nome?');
    expect(t.repo.rows[0].step).toBe('CUSTOM');
    const opcoes = await t.say('Ana Paula');
    expect(t.drive.ensureClientFolder).toHaveBeenCalledWith(100, 'Ana Paula');
    expect(opcoes.join('\n')).toContain('O que você precisa, Ana Paula?');
    expect((await t.say('1')).join('\n')).toContain('Envie fotos do espaço.');
    const file = t.msg('', {
      mediaType: 'image/png',
      mediaPath: 'https://gosac.exemplo.com/m/f.png',
    });
    expect(await t.say('', {}, [file])).toEqual([
      MESSAGES.aguardar_ok_continuar,
    ]);
    expect(t.drive.saveFile).toHaveBeenCalledTimes(1);
    await t.say('ok');
    expect(t.drive.saveAnswers).toHaveBeenCalledWith(
      'pasta-1',
      'Ana Paula',
      'Orçamento rápido',
      expect.arrayContaining([{ rotulo: 'Ambiente', valor: 'Cozinha' }]),
    );
    expect(t.handoff.execute).toHaveBeenCalledWith(
      expect.anything(),
      'redirecionando_com_nome',
      false,
      'Obrigada, Ana Paula! Já chamo alguém.',
      'orcamento_rapido',
    );
    expect(t.repo.rows[0].step).toBe('HUMANO');
    expect(t.repo.rows[0].custom).toBeNull();
  });

  it('"10" no meio do fluxo volta ao menu; fluxo desativado depois não prende o cliente', async () => {
    await publicar([flow()]);
    const t = setup();
    await t.say('Oi');
    await t.say('6');
    const volta = await t.say('10');
    expect(volta.join('\n')).toContain('*6* - Orçamento rápido');
    expect(t.repo.rows[0].step).toBe('MENU');
    await t.say('6');
    new ChatbotContentService({} as any).apply(emptyDoc()); // fluxo some (desativado/removido)
    const r = await t.say('qualquer coisa');
    expect(r.join('\n')).toContain(MESSAGES.menu_inicial.split('\n')[0]);
    expect(t.repo.rows[0].step).toBe('MENU');
  });

  it('opção 6 não existe sem fluxo ativo (cai como inválida, sem entrar em nada)', async () => {
    const t = setup();
    await t.say('Oi');
    expect((await t.say('6')).join('\n')).toContain('Ops');
    expect(t.repo.rows[0].step).toBe('MENU');
  });

  it('validação estrita recusa fluxo ruim; pré-visualização roda sem enviar nada', async () => {
    const content = new ChatbotContentService({
      getAllDecrypted: async () => [],
      upsert: async () => undefined,
      delete: async () => undefined,
    } as any);
    expect(() =>
      content.validate({ ...emptyDoc(), fluxos: [flow({ nos: [] })] }),
    ).toThrow();
    expect(() =>
      content.validate({
        ...emptyDoc(),
        fluxos: [flow(), flow({ nome: 'Outro' })],
      }),
    ).toThrow(); // opção 6 repetida
    const prev = content.previewFlow({ fluxo: flow(), estado: null });
    expect(prev.mensagens[0]).toContain('Qual é o seu nome?');
    const p2 = content.previewFlow({
      fluxo: flow(),
      estado: prev.estado,
      texto: 'Ana',
    });
    expect(p2.efeitos).toEqual(['Drive: criar a pasta do cliente']);
  });
});

describe('rascunho de fluxo incompleto', () => {
  it('salva rascunho com fluxo pela metade, lista os problemas e só publica quando válido', async () => {
    const rows = new Map<string, { value: string; category: string }>();
    const settings = {
      getAllDecrypted: async () =>
        [...rows].map(([key, r]) => ({
          key,
          ...r,
          isEncrypted: false,
          description: '',
        })),
      upsert: async (k: string, v: string, c: string) =>
        void rows.set(k, { value: v, category: c }),
      delete: async (k: string) => void rows.delete(k),
    };
    const content = new ChatbotContentService(settings as any);
    const pela_metade = {
      ...flow(),
      nos: [
        {
          id: 'n1',
          tipo: 'mensagem',
          titulo: 'Oi',
          texto: 'Olá',
          proximo: null,
        },
      ],
    } as CustomFlow;
    const r = await content.saveDraft(
      { ...emptyDoc(), fluxos: [pela_metade] },
      null,
    );
    expect(r.problemas.join(' ')).toMatch(/para onde o cliente vai/);
    await expect(content.publish(null)).rejects.toThrow();
    const ok = await content.saveDraft(
      { ...emptyDoc(), fluxos: [flow()] },
      null,
    );
    expect(ok.problemas).toEqual([]);
    await content.publish(null);
    new ChatbotContentService({} as any).apply(emptyDoc());
  });
});

describe('jeito de falar e base de conhecimento por fluxo', () => {
  const kb = [
    {
      id: 'horario',
      keywords: ['horario', 'abre'],
      text: 'A loja abre de segunda a sábado, das 9h às 18h.',
    },
  ];
  const publicar = async (f: CustomFlow) => {
    const rows = new Map<string, { value: string; category: string }>();
    const settings = {
      getAllDecrypted: async () =>
        [...rows].map(([key, r]) => ({
          key,
          ...r,
          isEncrypted: false,
          description: '',
        })),
      upsert: async (k: string, v: string, c: string) =>
        void rows.set(k, { value: v, category: c }),
      delete: async (k: string) => void rows.delete(k),
    };
    const content = new ChatbotContentService(settings as any);
    await content.saveDraft({ ...emptyDoc(), fluxos: [f] }, null);
    await content.publish(null);
  };
  afterEach(() => new ChatbotContentService({} as any).apply(emptyDoc()));

  it('valida tom e base de cada fluxo', () => {
    const content = new ChatbotContentService({} as any);
    const erros = (fn: () => unknown): string => {
      try {
        fn();
      } catch (e) {
        return ((e as any).getResponse().message as string[]).join(' ');
      }
      return '';
    };
    expect(
      erros(() =>
        content.validate({
          ...emptyDoc(),
          fluxos: [flow({ guidance: { tone: 'gritando', instructions: '' } })],
        }),
      ),
    ).toMatch(/tom desconhecido/);
    expect(
      erros(() =>
        content.validate({
          ...emptyDoc(),
          fluxos: [flow({ kb: [{ id: 'x', keywords: [], text: 'curto' }] })],
        }),
      ),
    ).toMatch(/10 a 600/);
    const ok = content.validate({
      ...emptyDoc(),
      fluxos: [
        flow({
          guidance: { tone: 'formal', instructions: 'Trate por senhor.' },
          kb,
          reescrever: true,
        }),
      ],
    });
    expect(ok.fluxos[0].guidance).toEqual({
      tone: 'formal',
      instructions: 'Trate por senhor.',
    });
    expect(ok.fluxos[0].kb?.[0].id).toBe('horario');
    expect(ok.fluxos[0].reescrever).toBe(true);
  });

  it('dúvida dentro do fluxo é respondida com a base DO FLUXO e a conversa retoma a pergunta', async () => {
    await publicar(
      flow({ kb, guidance: { tone: 'formal', instructions: '' } }),
    );
    const answerFaq = jest.fn(
      async () => 'A loja abre de segunda a sábado, das 9h às 18h.',
    );
    const t = setup({
      ai: { available: true, counters: {}, resolve: jest.fn(), answerFaq },
    });
    await t.say('Oi');
    await t.say('6');
    const r = await t.say('que horas a loja abre?');
    expect(answerFaq).toHaveBeenCalledWith(
      'que horas a loja abre?',
      expect.arrayContaining([expect.objectContaining({ id: 'horario' })]),
      { tone: 'formal', instructions: '' },
    );
    expect(r[0]).toContain('segunda a sábado');
    expect(r.join('\n')).toContain('Qual é o seu nome?');
    expect(t.repo.rows[0].step).toBe('CUSTOM');
    expect(t.repo.rows[0].custom.invalidos).toBe(0);
  });

  it('sem base no fluxo, a dúvida cai no tratamento normal de resposta inválida', async () => {
    await publicar(flow());
    const answerFaq = jest.fn();
    const t = setup({
      ai: { available: true, counters: {}, resolve: jest.fn(), answerFaq },
    });
    await t.say('Oi');
    await t.say('6');
    expect((await t.say('que horas a loja abre?')).join('\n')).toContain('Ops');
    expect(answerFaq).not.toHaveBeenCalled();
  });

  const humanizer = (writerOut: unknown) => {
    const run = jest.fn(async () => writerOut);
    const h = new ChatbotHumanizerService(
      { chatbot: { humanize: true, writerDailyLimit: 99 } } as any,
      { enabled: true, breakerOpen: false } as any,
      { run } as any,
    );
    return { h, run };
  };
  const conv = { contactId: 1, nome: 'Ana', history: [] } as any;
  const pergunta =
    'Qual é o seu nome?\n\n0 - ↩️ Voltar uma etapa\n10 - 🔄 Recomeçar o atendimento';

  it('reescrever: a IA usa o tom do fluxo, o revisor exige a pergunta e o bloco de comandos fica intacto', async () => {
    await publicar(
      flow({
        reescrever: true,
        guidance: { tone: 'formal', instructions: 'Seja breve.' },
      }),
    );
    const ok = humanizer({
      abertura: 'Poderia me informar o seu nome, por gentileza?',
      fechamento: null,
    });
    const out = await ok.h.compose(conv, [pergunta], 'orcamento_rapido');
    expect(ok.run).toHaveBeenCalledWith(
      expect.objectContaining({
        guidance: { tone: 'formal', instructions: 'Seja breve.' },
      }),
    );
    expect(out.join('\n')).toContain('Poderia me informar o seu nome');
    expect(out.join('\n')).toContain('10 - 🔄 Recomeçar');

    const semPergunta = humanizer({
      abertura: 'Preciso do seu nome.',
      fechamento: null,
    });
    expect(
      await semPergunta.h.compose(conv, [pergunta], 'orcamento_rapido'),
    ).toEqual([pergunta]); // reprovado: volta o original

    const inventou = humanizer({
      abertura: 'Qual o seu nome? Temos 50% de desconto!',
      fechamento: null,
    });
    expect(
      await inventou.h.compose(conv, [pergunta], 'orcamento_rapido'),
    ).toEqual([pergunta]);
  });

  it('sem "reescrever", o texto do fluxo vai exatamente como o dono escreveu', async () => {
    await publicar(
      flow({
        reescrever: false,
        guidance: { tone: 'formal', instructions: '' },
      }),
    );
    const x = humanizer({ abertura: 'qualquer coisa', fechamento: null });
    expect(await x.h.compose(conv, [pergunta], 'orcamento_rapido')).toEqual([
      pergunta,
    ]);
    expect(x.run).not.toHaveBeenCalled();
  });
});

describe('simulador (Testar) com fluxos próprios', () => {
  const kb = [
    {
      id: 'horario',
      keywords: ['horario', 'abre'],
      text: 'A loja abre de segunda a sábado, das 9h às 18h.',
    },
  ];
  const montar = async (
    f: CustomFlow,
    agents: any,
    humanizer: any = { enabled: false, compose: jest.fn() },
  ) => {
    const rows = new Map<string, { value: string; category: string }>();
    const settings = {
      getAllDecrypted: async () =>
        [...rows].map(([key, r]) => ({
          key,
          ...r,
          isEncrypted: false,
          description: '',
        })),
      upsert: async (k: string, v: string, c: string) =>
        void rows.set(k, { value: v, category: c }),
      delete: async (k: string) => void rows.delete(k),
    };
    const content = new ChatbotContentService(settings as any);
    await content.saveDraft({ ...emptyDoc(), fluxos: [f] }, null);
    await content.publish(null);
    const appConfig = {
      chatbot: { maxInvalid: 3, maxOffTopic: 3, ponttaEnabled: false },
    } as any;
    return new ChatbotAdminService(
      {} as any,
      appConfig,
      agents,
      {} as any,
      humanizer,
    );
  };
  afterEach(() => new ChatbotContentService({} as any).apply(emptyDoc()));

  it('percorre um fluxo publicado a partir do menu, mostra onde o cliente está e encerra no encaminhamento', async () => {
    const svc = await montar(flow(), { available: false });
    let r: any = await svc.converse({});
    expect(r.mensagens.join('\n')).toContain('*6* - Orçamento rápido');
    r = await svc.converse({ texto: '6', estado: r.estado });
    expect(r.onde).toMatchObject({
      etapa: 'CUSTOM',
      fluxo: { nome: 'Orçamento rápido' },
      bloco: { numero: 1, titulo: 'Nome' },
    });
    r = await svc.converse({ texto: 'Ana Paula', estado: r.estado });
    expect(r.efeitos).toEqual(['Drive: criaria a pasta do cliente']);
    expect(r.onde.bloco.numero).toBe(3);
    expect(r.mensagens.join('\n')).toContain('O que você precisa, Ana Paula?');
    r = await svc.converse({ texto: '1', estado: r.estado });
    expect(r.onde.bloco.numero).toBe(4);
    r = await svc.converse({
      texto: 'quero falar com um atendente',
      estado: r.estado,
    });
    expect(r.terminou).toBe(true);
  });

  it('escolher o fluxo: entra direto nele (sem menu); fluxo não publicado é recusado', async () => {
    const svc = await montar(flow({ ativo: false, menuOpcao: null }), {
      available: false,
    });
    const r: any = await svc.converse({
      inicio: { fluxoId: 'orcamento_rapido' },
    });
    expect(r.mensagens.join('\n')).toContain('Qual é o seu nome?');
    expect(r.onde).toMatchObject({
      etapa: 'CUSTOM',
      fluxo: { nome: 'Orçamento rápido' },
      bloco: { numero: 1 },
    });
    const r2: any = await svc.converse({
      texto: 'Ana Paula',
      estado: r.estado,
    });
    expect(r2.onde.bloco.numero).toBe(3);
    await expect(
      svc.converse({ inicio: { fluxoId: 'nao_existe' } }),
    ).rejects.toThrow(/não está publicado/);
  });

  it('dúvida dentro do fluxo usa a base do fluxo e o teste mostra a voz reescrita', async () => {
    const answerFaq = jest.fn(
      async () => 'A loja abre de segunda a sábado, das 9h às 18h.',
    );
    const compose = jest.fn(async (_c: unknown, t: string[]) =>
      t.map((x) => '✨ ' + x),
    );
    const svc = await montar(
      flow({
        kb,
        reescrever: true,
        guidance: { tone: 'formal', instructions: '' },
      }),
      { available: true, answerFaq, resolve: jest.fn() },
      { enabled: true, compose },
    );
    let r: any = await svc.converse({});
    r = await svc.converse({ texto: '6', estado: r.estado });
    expect(r.reescrita).toBe(true);
    expect(compose).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.any(Array),
      'orcamento_rapido',
    );
    r = await svc.converse({
      texto: 'que horas a loja abre?',
      estado: r.estado,
    });
    expect(r.origem).toBe('ia');
    expect(r.mensagens[0]).toContain('segunda a sábado');
    expect(r.onde.bloco.numero).toBe(1); // continua na mesma pergunta
  });
});

describe('tipos de mensagem (modelos)', () => {
  const nome = {
    id: 'n1',
    tipo: 'pergunta' as const,
    titulo: 'Nome',
    texto: 'Qual seu nome?',
    variavel: 'nome',
    validacao: 'nome' as const,
    proximo: 'n2',
  };
  const conf = {
    id: 'n2',
    tipo: 'confirmacao' as const,
    titulo: 'Confirmar',
    texto: 'Posso seguir, {nome}?',
    opcoes: [
      { rotulo: 'Sim', proximo: 'n3' },
      { rotulo: 'Não', proximo: 'n4' },
    ],
  };
  const pedido = (extra = {}) => ({
    id: 'n3',
    tipo: 'arquivos' as const,
    titulo: 'Pedir projeto',
    texto: 'Envie o projeto.',
    minimo: 1,
    armazenar: 'drive' as const,
    pasta: 'criar' as const,
    proximo: 'n4',
    ...extra,
  });
  const fim = { id: 'n4', tipo: 'fim' as const, titulo: 'Fim', texto: 'Ok!' };
  const mk = (nos: any[]) => flow({ nos });

  it('confirmação oferece Sim/Não e segue pelo caminho escolhido', () => {
    const f = mk([nome, conf, pedido(), fim]);
    expect(checkFlow(f)).toEqual([]);
    let r = startFlow(f, null);
    r = stepFlow(
      f,
      r.state!,
      { text: 'Ana', hasFile: false },
      { maxInvalid: 3 },
    );
    expect(r.replies.join('\n')).toContain('Posso seguir, Ana?');
    expect(r.replies.join('\n')).toContain('*1* - Sim');
    const sim = stepFlow(
      f,
      r.state!,
      { text: 'sim', hasFile: false },
      { maxInvalid: 3 },
    );
    expect(sim.state?.nodeId).toBe('n3');
    const nao = stepFlow(
      f,
      r.state!,
      { text: '2', hasFile: false },
      { maxInvalid: 3 },
    );
    expect(nao.saiu).toBe('menu');
  });

  it('confirmação exige exatamente duas opções', () => {
    const f = mk([
      nome,
      {
        ...conf,
        opcoes: [...conf.opcoes, { rotulo: 'Talvez', proximo: 'n4' }],
      },
      pedido(),
      fim,
    ]);
    expect(checkFlow(f).join(' ')).toContain('duas opções');
  });

  it('solicitação com Drive pede a pasta ao entrar (criar ou só se existir)', () => {
    const chegar = (f: CustomFlow) => {
      const o = { maxInvalid: 3 };
      let r = startFlow(f, null);
      r = stepFlow(f, r.state!, { text: 'Ana', hasFile: false }, o);
      return stepFlow(f, r.state!, { text: '1', hasFile: false }, o);
    };
    expect(chegar(mk([nome, conf, pedido(), fim])).effects).toEqual([
      { type: 'criar_pasta' },
    ]);
    expect(
      chegar(mk([nome, conf, pedido({ pasta: 'existente' }), fim])).effects,
    ).toEqual([{ type: 'criar_pasta', somenteSeExistir: true }]);
  });

  it('solicitação com Drive dispensa o bloco de ferramenta, mas exige o nome', () => {
    expect(checkFlow(mk([nome, conf, pedido(), fim]))).toEqual([]);
    const semNome = mk([
      {
        ...conf,
        id: 'n1',
        opcoes: [
          { rotulo: 'Sim', proximo: 'n3' },
          { rotulo: 'Não', proximo: 'n4' },
        ],
      },
      pedido(),
      fim,
    ]);
    expect(checkFlow(semNome).join(' ')).toContain('nome do cliente');
    expect(
      checkFlow(mk([nome, conf, pedido({ armazenar: undefined }), fim])).join(
        ' ',
      ),
    ).toContain('guardar arquivos');
  });
});

describe('regras de ordem entre os tipos', () => {
  const o = { maxInvalid: 3 };
  const perguntaNome = (proximo: string) => ({
    id: 'a',
    tipo: 'pergunta' as const,
    titulo: 'Nome',
    texto: 'Seu nome?',
    variavel: 'nome',
    proximo,
  });
  const drive = (id: string, proximo: string) => ({
    id,
    tipo: 'arquivos' as const,
    titulo: 'Arquivos',
    texto: 'Envie.',
    armazenar: 'drive' as const,
    pasta: 'criar' as const,
    proximo,
  });
  const fim = { id: 'z', tipo: 'fim' as const, titulo: 'Fim', texto: 'Ok' };
  const mk = (nos: any[]) => flow({ nos });

  it('o nome precisa vir ANTES de guardar no Drive, não só existir no fluxo', () => {
    const depois = mk([drive('b', 'a'), perguntaNome('z'), fim]);
    expect(checkFlow(depois).join(' ')).toContain('nome do cliente antes');
    const antes = mk([perguntaNome('b'), drive('b', 'z'), fim]);
    expect(checkFlow(antes)).toEqual([]);
  });

  it('se um dos caminhos pula a pergunta do nome, o fluxo é recusado', () => {
    const f = mk([
      {
        id: 'c',
        tipo: 'confirmacao',
        titulo: 'Quer informar?',
        texto: 'Quer informar o nome?',
        opcoes: [
          { rotulo: 'Sim', proximo: 'a' },
          { rotulo: 'Não', proximo: 'b' },
        ],
      },
      perguntaNome('b'),
      drive('b', 'z'),
      fim,
    ]);
    expect(checkFlow(f).join(' ')).toContain('nome do cliente antes');
  });

  it('“salvar as respostas” exige a pasta criada antes', () => {
    const salvar = {
      id: 's',
      tipo: 'acao' as const,
      titulo: 'Salvar',
      acao: 'drive_salvar_respostas' as const,
      proximo: 'z',
    };
    expect(checkFlow(mk([perguntaNome('s'), salvar, fim])).join(' ')).toContain(
      'pasta do cliente criada antes',
    );
    expect(
      checkFlow(mk([perguntaNome('b'), drive('b', 's'), salvar, fim])),
    ).toEqual([]);
  });

  it('variável só pode ser citada depois de respondida', () => {
    const f = mk([
      {
        id: 'm',
        tipo: 'mensagem',
        titulo: 'Oi',
        texto: 'Seu bairro é {bairro}.',
        proximo: 'p',
      },
      {
        id: 'p',
        tipo: 'pergunta',
        titulo: 'Bairro',
        texto: 'Qual o bairro?',
        variavel: 'bairro',
        proximo: 'z',
      },
      fim,
    ]);
    expect(checkFlow(f).join(' ')).toContain(
      '{bairro} ainda não foi respondida',
    );
  });

  it('bloco que ninguém alcança é apontado', () => {
    const f = mk([
      { id: 'm', tipo: 'mensagem', titulo: 'Oi', texto: 'Oi', proximo: 'z' },
      fim,
      { id: 'o', tipo: 'fim', titulo: 'Solto', texto: 'x' },
    ]);
    expect(checkFlow(f).join(' ')).toContain('nenhum caminho chega');
  });
});
