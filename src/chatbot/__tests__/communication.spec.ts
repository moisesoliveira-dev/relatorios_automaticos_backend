import { MESSAGES, MessageKey } from '../domain/chatbot.messages';
import {
  EXEMPT,
  SPECS,
  identifyMessage,
  splitBlock,
} from '../domain/message-specs';
import {
  assembleBubbles,
  validateWriterOutput,
} from '../domain/writer.validator';
import { renderSlotList } from '../domain/scheduling';
import { ChatbotHumanizerService } from '../services/chatbot-humanizer.service';

const keys = Object.keys(MESSAGES) as MessageKey[];
/** Texto como o cliente receberia hoje (placeholders preenchidos). */
const filled = (k: MessageKey) =>
  k === 'escolher_horario'
    ? renderSlotList(MESSAGES.escolher_horario, [
        { startUtc: 'a', endUtc: 'b', label: '08/07/2025 07:00 - 09:00' },
      ])
    : MESSAGES[k].replace('{nome}', 'Ana Paula');

describe('catálogo de mensagens × especificação de comunicação', () => {
  it('toda mensagem tem especificação (ou está explicitamente isenta)', () => {
    const semSpec = keys.filter((k) => !SPECS[k] && !EXEMPT.includes(k));
    expect(semSpec).toEqual([]);
  });

  it('cada texto original é identificado pela chave certa (sem colisões)', () => {
    for (const k of keys.filter((k) => !EXEMPT.includes(k))) {
      expect({ k, achou: identifyMessage(filled(k))?.key }).toEqual({
        k,
        achou: k,
      });
    }
  });

  it('extrai o nome de mensagens com placeholder', () => {
    expect(identifyMessage(filled('confirmar_nome'))?.nome).toBe('Ana Paula');
  });

  it('texto livre (ex.: resposta de FAQ) não é do catálogo', () => {
    expect(
      identifyMessage('A loja fica na Av. Djalma Batista, 1334.'),
    ).toBeNull();
  });

  it('a própria mensagem original cumpre todos os pontos essenciais (valida as palavras-chave)', () => {
    for (const k of keys.filter((k) => SPECS[k])) {
      const spec = SPECS[k]!;
      const text = filled(k);
      const { head, block } = splitBlock(spec, text);
      const verdict = validateWriterOutput(
        { abertura: head || 'Claro, segue aqui:', fechamento: null },
        {
          spec,
          reference: head || text,
          block,
          nome: 'Ana Paula',
          recentBot: [],
        },
      );
      // Os originais podem ter mais emojis que o limite imposto à IA; só isso é tolerado aqui.
      const motivo = verdict.ok ? 'ok' : (verdict as any).motivo;
      expect({
        k,
        verdict: motivo === 'emojis_demais' ? 'ok' : motivo,
      }).toEqual({ k, verdict: 'ok' });
    }
  });
});

describe('splitBlock — o que é fixo', () => {
  it('menu: opções numeradas ficam no bloco fixo', () => {
    const { head, block } = splitBlock(
      SPECS.menu_inicial!,
      MESSAGES.menu_inicial,
    );
    expect(head).toContain('Vera');
    expect(block.startsWith('*1* - 📐')).toBe(true);
    expect(block).toContain('*5* - 📍');
  });
  it('endereço: o bloco é o endereço literal', () => {
    const { block } = splitBlock(SPECS.endereco_loja!, MESSAGES.endereco_loja);
    expect(block).toContain('Av. Djalma Batista, 1334');
    expect(block).toContain('(92) 99455-1471');
  });
  it('instruções da planta não têm bloco: a IA escreve tudo', () => {
    expect(
      splitBlock(SPECS.planta_instrucoes!, MESSAGES.planta_instrucoes).block,
    ).toBe('');
  });
  it('lista de horários inteira é bloco fixo', () => {
    const text = filled('escolher_horario');
    const { block } = splitBlock(SPECS.escolher_horario!, text);
    expect(block).toContain('*1 - 08/07/2025 07:00 - 09:00*');
    expect(block).toContain('*9 - Nenhum desses horários.*');
  });
});

describe('revisor da comunicação — o que nunca passa', () => {
  const spec = SPECS.menu_inicial!;
  const { head, block } = splitBlock(spec, MESSAGES.menu_inicial);
  const check = (
    abertura: string,
    over: Partial<Parameters<typeof validateWriterOutput>[1]> = {},
    fechamento: string | null = null,
  ) =>
    validateWriterOutput(
      { abertura, fechamento },
      { spec, reference: head, block, nome: null, recentBot: [], ...over },
    );

  it('aceita uma abertura natural que cumpre os pontos', () => {
    expect(
      check(
        'Oi, boa tarde! 😊 Eu sou a Vera D’Or, atendente virtual da Cinthia Moreira Modulados. Como posso te ajudar hoje?',
      ),
    ).toMatchObject({ ok: true });
  });

  it.each([
    [
      'ponto essencial ausente (não se apresenta)',
      'Oi! Em que posso ajudar na Cinthia Moreira Modulados?',
      'ponto_ausente',
    ],
    [
      'número inventado',
      'Oi, eu sou a Vera da Cinthia Moreira Modulados, temos 15 anos de mercado. Como posso ajudar?',
      'numero_inventado',
    ],
    [
      'copia as opções',
      'Sou a Vera da Cinthia Moreira Modulados, posso ajudar:\n*1* - orçar',
      'copiou_opcoes',
    ],
    [
      'preço',
      'Sou a Vera da Cinthia Moreira Modulados, cozinhas a partir de R$ 5 mil. Posso ajudar?',
      'conteudo_proibido',
    ],
    [
      'link',
      'Sou a Vera da Cinthia Moreira Modulados, veja https://site.com. Posso ajudar?',
      'conteudo_proibido',
    ],
    [
      'promessa comercial',
      'Sou a Vera da Cinthia Moreira Modulados, temos desconto especial. Posso ajudar?',
      'promessa_comercial',
    ],
    [
      'emojis demais',
      'Oi 😀😀😀😀 sou a Vera da Cinthia Moreira Modulados, posso ajudar?',
      'emojis_demais',
    ],
    [
      'texto longo demais',
      `Sou a Vera da Cinthia Moreira Modulados e posso ajudar. ${'Fale comigo. '.repeat(60)}`,
      'muito_longo',
    ],
    [
      'html',
      '<b>Sou a Vera da Cinthia Moreira Modulados</b>, posso ajudar?',
      'formatacao_invalida',
    ],
  ])('%s', (_nome, texto, motivo) => {
    const r = check(texto);
    expect(r.ok).toBe(false);
    expect((r as any).motivo).toContain(motivo);
  });

  it('rejeita repetir exatamente a mensagem anterior', () => {
    const t =
      'Oi! Eu sou a Vera da Cinthia Moreira Modulados. Como posso ajudar?';
    expect(check(t, { recentBot: [t] })).toMatchObject({
      ok: false,
      motivo: 'repetida',
    });
  });

  it('confirmação de nome exige o nome exato', () => {
    const s = SPECS.confirmar_nome!;
    const sp = splitBlock(s, filled('confirmar_nome'));
    const run = (texto: string) =>
      validateWriterOutput(
        { abertura: texto, fechamento: null },
        {
          spec: s,
          reference: sp.head,
          block: sp.block,
          nome: 'Ana Paula',
          recentBot: [],
        },
      );
    expect(run('Anotei aqui: Ana Paula, tá certo?')).toMatchObject({
      ok: true,
    });
    expect(run('Anotei seu nome, tá certo?')).toMatchObject({
      ok: false,
      motivo: 'nome_ausente',
    });
  });

  it('fechamento só é aceito quando existe bloco fixo', () => {
    const s = SPECS.pedir_nome!;
    const r = validateWriterOutput(
      { abertura: 'Pode me dizer seu nome?', fechamento: 'Obrigada!' },
      { spec: s, reference: 'x', block: '', nome: null, recentBot: [] },
    );
    expect(r).toMatchObject({ ok: false, motivo: 'fechamento_sem_bloco' });
  });

  it('saída inválida do modelo', () => {
    expect(
      validateWriterOutput(null, {
        spec,
        reference: head,
        block,
        recentBot: [],
      }),
    ).toMatchObject({ ok: false });
    expect(
      validateWriterOutput({ abertura: 42 } as any, {
        spec,
        reference: head,
        block,
        recentBot: [],
      }),
    ).toMatchObject({ ok: false });
  });
});

describe('assembleBubbles', () => {
  it('com bloco: texto da IA numa bolha, opções (+fechamento) na outra; sem bloco: uma só', () => {
    expect(
      assembleBubbles(
        { abertura: 'Oi!', fechamento: 'Pode escolher.' },
        '*1* - A\n*2* - B',
      ),
    ).toEqual(['Oi!', '*1* - A\n*2* - B\n\nPode escolher.']);
    expect(
      assembleBubbles({ abertura: 'Qual seu nome?', fechamento: null }, ''),
    ).toEqual(['Qual seu nome?']);
  });
});

describe('ChatbotHumanizerService', () => {
  const conv = (over: Record<string, unknown> = {}) =>
    ({ contactId: 1, nome: 'Ana Paula', history: [], ...over }) as any;
  const build = (
    writerImpl: (ctx: any) => any,
    cfg: Record<string, unknown> = {},
    openai = { enabled: true, breakerOpen: false },
  ) => {
    const writer = { run: jest.fn(async (ctx: any) => writerImpl(ctx)) };
    const config = {
      chatbot: { humanize: true, writerDailyLimit: 60, ...cfg },
    } as any;
    return {
      svc: new ChatbotHumanizerService(config, openai as any, writer as any),
      writer,
    };
  };
  const natural = {
    abertura:
      'Oi, boa tarde! 😊 Eu sou a Vera D’Or, atendente virtual da Cinthia Moreira Modulados. Como posso te ajudar hoje?',
    fechamento: null,
  };

  it('mensagem do catálogo vira 2 bolhas: texto natural + opções literais', async () => {
    const { svc } = build(() => natural);
    const out = await svc.compose(conv(), [MESSAGES.menu_inicial]);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(natural.abertura);
    expect(out[1]).toContain('*1* - 📐 Já tenho o projeto e quero orçar.');
    expect(svc.counters.escrita_ok).toBe(1);
  });

  it('manda ao Redator o contexto certo (período, 1ª interação, última fala do cliente, nome)', async () => {
    const { svc, writer } = build(() => natural);
    await svc.compose(conv({ history: [{ role: 'cliente', text: 'Oi' }] }), [
      MESSAGES.menu_inicial,
    ]);
    const ctx = writer.run.mock.calls[0][0] as any;
    expect(ctx).toMatchObject({
      primeiraInteracao: true,
      ultimaMensagemCliente: 'Oi',
      estiloCliente: 'curto',
    });
    expect(['manha', 'tarde', 'noite']).toContain(ctx.periodo);
    expect(ctx.reference).not.toContain('*1* -'); // as opções não vão para reescrever
    expect(ctx.block).toContain('*1* -');
  });

  it('texto reprovado pelo revisor → vai a mensagem original, e o motivo é contabilizado', async () => {
    const { svc } = build(() => ({
      abertura: 'Oi! Temos desconto de 20% hoje.',
      fechamento: null,
    }));
    expect(await svc.compose(conv(), [MESSAGES.menu_inicial])).toEqual([
      MESSAGES.menu_inicial,
    ]);
    expect(svc.counters.fallback_validacao).toBe(1);
    expect(Object.keys(svc.rejections).length).toBe(1);
  });

  it('erro, timeout (null) ou exceção do Redator → mensagem original', async () => {
    expect(
      await build(() => null).svc.compose(conv(), [MESSAGES.pedir_nome]),
    ).toEqual([MESSAGES.pedir_nome]);
    const boom = build(() => {
      throw new Error('x');
    });
    expect(await boom.svc.compose(conv(), [MESSAGES.pedir_nome])).toEqual([
      MESSAGES.pedir_nome,
    ]);
    expect(boom.svc.counters.fallback_erro).toBe(1);
  });

  it('desligado, IA indisponível ou disjuntor aberto: não chama o Redator', async () => {
    for (const t of [
      build(() => natural, { humanize: false }),
      build(() => natural, {}, { enabled: false, breakerOpen: false }),
      build(() => natural, {}, { enabled: true, breakerOpen: true }),
    ]) {
      expect(await t.svc.compose(conv(), [MESSAGES.pedir_nome])).toEqual([
        MESSAGES.pedir_nome,
      ]);
      expect(t.writer.run).not.toHaveBeenCalled();
    }
  });

  it('respeita o limite diário e deixa passar texto livre (FAQ) sem mexer', async () => {
    const t = build(() => natural, { writerDailyLimit: 1 });
    await t.svc.compose(conv(), [MESSAGES.menu_inicial]);
    expect(await t.svc.compose(conv(), [MESSAGES.menu_inicial])).toEqual([
      MESSAGES.menu_inicial,
    ]);
    expect(t.svc.counters.fallback_limite).toBe(1);
    expect(
      await t.svc.compose(conv(), ['A loja fica na Av. Djalma Batista, 1334.']),
    ).toEqual(['A loja fica na Av. Djalma Batista, 1334.']);
  });

  it('várias mensagens de uma vez mantêm a ordem', async () => {
    const { svc } = build((ctx) => ({
      abertura: ctx.reference.includes('nome')
        ? 'Pode me dizer seu nome, por favor?'
        : natural.abertura,
      fechamento: null,
    }));
    const out = await svc.compose(conv(), [
      MESSAGES.pedir_nome,
      MESSAGES.audio_nao_suportado,
    ]);
    expect(out[0]).toContain('nome');
    expect(out.length).toBeGreaterThanOrEqual(2);
  });
});
