import { decide, previousStep, validOptions } from '../domain/chatbot.flow';
import { parseInput, validarNome } from '../domain/input-parser';
import { sanitizeFreeReply } from '../domain/free-reply.guard';
import { computeSlots, renderSlotList } from '../domain/scheduling';
import { MESSAGES } from '../domain/chatbot.messages';
import {
  FlowInput,
  FlowState,
  INITIAL_FLOW_STATE,
} from '../domain/chatbot.types';

const OPTS = { maxInvalid: 3, scheduling: false };
const st = (over: Partial<FlowState> = {}): FlowState => ({
  ...INITIAL_FLOW_STATE,
  categorias: [],
  ...over,
});
const step = (state: FlowState, input: FlowInput, opts = OPTS) => {
  const d = decide(state, input, opts);
  return { state: { ...state, ...d.patch }, d };
};

describe('validarNome', () => {
  it.each([
    ['João da Silva', 'João da Silva'],
    ['meu nome é maria', 'Maria'],
    ['Me chamo Ana Paula!', 'Ana Paula'],
    ["d'Ávila", "D'Ávila"],
  ])('aceita %s', (input, expected) =>
    expect(validarNome(input)).toBe(expected),
  );

  it.each([
    '',
    'a',
    'sim',
    '123',
    'quero um orçamento de cozinha por favor agora mesmo hoje',
    'joao@email.com',
    'http://x.com',
    'oi',
  ])('rejeita %j', (input) => expect(validarNome(input)).toBeNull());
});

describe('parseInput', () => {
  it('reconhece 0, 10 e opções do passo', () => {
    expect(parseInput(st(), '10', false)).toEqual({ kind: 'restart' });
    expect(parseInput(st({ step: 'CASA_AP' }), '0', false)).toEqual({
      kind: 'back',
    });
    expect(parseInput(st(), '*3*', false)).toEqual({
      kind: 'option',
      value: 3,
    });
    expect(parseInput(st(), '2.', false)).toEqual({ kind: 'option', value: 2 });
  });

  it('opção numérica fora do menu é inválida (não vai para a IA)', () => {
    expect(parseInput(st(), '7', false)).toEqual({ kind: 'invalid' });
  });

  it('texto livre devolve null (precisa de outro intérprete)', () => {
    expect(parseInput(st(), 'quero um projeto de cozinha', false)).toBeNull();
  });

  it('OK só vale em envio de arquivos/ambientes', () => {
    expect(parseInput(st({ step: 'ENVIO_ARQUIVOS' }), 'Ok', false)).toEqual({
      kind: 'ok',
    });
    expect(parseInput(st({ step: 'MENU' }), 'ok', false)).toBeNull();
  });

  it('categorias: "2 1 3", "2, 1 e 3", "9"', () => {
    const s = st({ step: 'CATEGORIAS' });
    expect(parseInput(s, '2 1 3', false)).toEqual({
      kind: 'categorias',
      ids: [2, 1, 3],
    });
    expect(parseInput(s, '2, 1 e 3', false)).toEqual({
      kind: 'categorias',
      ids: [2, 1, 3],
    });
    expect(parseInput(s, '9', false)).toEqual({ kind: 'option', value: 9 });
    expect(parseInput(s, '99 77', false)).toEqual({ kind: 'invalid' });
  });

  it('arquivo sem texto', () => {
    expect(parseInput(st({ step: 'ENVIO_ARQUIVOS' }), '', true)).toEqual({
      kind: 'file',
    });
    expect(parseInput(st(), '', false)).toEqual({ kind: 'invalid' });
  });
});

describe('fluxo — trilha "tenho projeto"', () => {
  it('menu → nome → confirma → arquivos → OK → entrega ao projetista', () => {
    let s = st();
    let r = step(s, { kind: 'option', value: 1 });
    expect(r.state).toMatchObject({ step: 'NOME', trilha: 'projeto' });
    expect(r.d.replies).toEqual([MESSAGES.pedir_nome]);

    r = step(r.state, { kind: 'nome', nome: 'João Silva' });
    expect(r.state).toMatchObject({
      step: 'CONFIRMA_NOME',
      nomePendente: 'João Silva',
    });
    expect(r.d.replies[0]).toContain('*João Silva*');

    r = step(r.state, { kind: 'option', value: 1 });
    expect(r.state).toMatchObject({
      step: 'ENVIO_ARQUIVOS',
      nome: 'João Silva',
    });
    expect(r.d.effects).toEqual([{ type: 'criar_pasta' }]);

    // OK sem enviar nada não passa
    expect(step(r.state, { kind: 'ok' }).d.replies).toEqual([
      MESSAGES.invalida_arquivos,
    ]);

    r = step(r.state, { kind: 'file' });
    expect(r.state.arquivos).toBe(1);
    expect(r.d.replies).toEqual([MESSAGES.aguardar_ok_atendente]);

    r = step(r.state, { kind: 'ok' });
    expect(r.d.effects).toEqual([
      { type: 'handoff', mensagem: 'redirecionando_com_nome' },
    ]);
  });

  it('nome errado volta a pedir o nome', () => {
    const r = step(
      st({ step: 'CONFIRMA_NOME', trilha: 'projeto', nomePendente: 'Xis' }),
      { kind: 'option', value: 2 },
    );
    expect(r.state).toMatchObject({ step: 'NOME', nomePendente: null });
  });
});

describe('fluxo — trilha "só planta baixa"', () => {
  it('arquivos → OK → categorias → OK → salva preferências e entrega', () => {
    let r = step(
      st({
        step: 'ENVIO_ARQUIVOS',
        trilha: 'planta',
        nome: 'Ana',
        arquivos: 1,
      }),
      { kind: 'ok' },
    );
    expect(r.state.step).toBe('CATEGORIAS');
    r = step(r.state, { kind: 'categorias', ids: [1, 3] });
    expect(r.state.categorias).toEqual([1, 3]);
    r = step(r.state, { kind: 'categorias', ids: [3, 7] });
    expect(r.state.categorias).toEqual([1, 3, 7]);
    r = step(r.state, { kind: 'ok' });
    expect(r.d.effects).toEqual([
      { type: 'salvar_preferencias' },
      { type: 'handoff', mensagem: 'redirecionando_com_nome' },
    ]);
  });
});

describe('fluxo — trilha "sem nada"', () => {
  it('casa pula a planta e pergunta da medição', () => {
    const r = step(st({ step: 'CASA_AP', trilha: 'semNada', nome: 'Ana' }), {
      kind: 'option',
      value: 1,
    });
    expect(r.state).toMatchObject({ step: 'AGENDAR', local: 'casa' });
  });

  it('apartamento orienta achar a planta; "não achei" vai para a pergunta da medição', () => {
    let r = step(st({ step: 'CASA_AP', trilha: 'semNada' }), {
      kind: 'option',
      value: 2,
    });
    expect(r.state).toMatchObject({ step: 'PLANTA_ACHOU', local: 'ap' });
    expect(r.d.replies).toEqual([
      MESSAGES.planta_instrucoes,
      MESSAGES.planta_achou_ou_nao,
    ]);
    expect(step(r.state, { kind: 'option', value: 2 }).state.step).toBe(
      'AGENDAR',
    );
    expect(step(r.state, { kind: 'option', value: 1 }).state.step).toBe(
      'CATEGORIAS',
    );
  });

  it('com Pontta desligado, quem quer agendar vai para um humano (sem listar horários)', () => {
    const r = step(
      st({ step: 'AGENDAR', nome: 'Ana' }),
      { kind: 'option', value: 1 },
      { maxInvalid: 3, scheduling: false },
    );
    expect(r.d.effects).toEqual([
      { type: 'handoff', mensagem: 'redirecionando_com_nome' },
    ]);
  });

  it('com Pontta ligado, lista horários; 9 = nenhum → humano', () => {
    const on = { maxInvalid: 3, scheduling: true };
    const r = step(st({ step: 'AGENDAR' }), { kind: 'option', value: 1 }, on);
    expect(r.d.effects).toEqual([{ type: 'oferecer_horarios' }]);
    const slots = [{ startUtc: 'a', endUtc: 'b', label: 'x' }];
    expect(
      step(st({ step: 'HORARIO', slots }), { kind: 'option', value: 1 }, on).d
        .effects,
    ).toEqual([{ type: 'agendar', slotIndex: 0 }]);
    expect(
      step(st({ step: 'HORARIO', slots }), { kind: 'option', value: 2 }, on).d
        .effects,
    ).toEqual([]); // fora da lista
    expect(
      step(st({ step: 'HORARIO', slots }), { kind: 'option', value: 9 }, on).d
        .effects[0],
    ).toMatchObject({ type: 'handoff' });
  });
});

describe('fluxo — boleto, loja e reconhecimento', () => {
  it('opção 4 e 5 informam e perguntam sobre visita; "não" volta ao menu', () => {
    let r = step(st(), { kind: 'option', value: 4 });
    expect(r.d.replies).toEqual([
      MESSAGES.info_boleto,
      MESSAGES.pergunta_visita_boleto,
    ]);
    r = step(r.state, { kind: 'option', value: 2 });
    expect(r.state.step).toBe('MENU');
    expect(r.d.replies).toEqual([MESSAGES.menu_reapresentado]);
    expect(step(st(), { kind: 'option', value: 5 }).d.replies[0]).toBe(
      MESSAGES.endereco_loja,
    );
    expect(
      step(st({ step: 'VISITA' }), { kind: 'option', value: 1 }).d.effects[0],
    ).toMatchObject({ type: 'handoff' });
  });

  it('reconhecimento: 1 recomeça, 2 reutiliza o atendente anterior', () => {
    expect(
      step(st({ step: 'RECONHECIMENTO' }), { kind: 'option', value: 1 }).state
        .step,
    ).toBe('MENU');
    expect(
      step(st({ step: 'RECONHECIMENTO' }), { kind: 'option', value: 2 }).d
        .effects,
    ).toEqual([
      {
        type: 'handoff',
        mensagem: 'redirecionando',
        reutilizarAtendente: true,
      },
    ]);
  });
});

describe('comandos globais', () => {
  it('0 volta uma etapa conforme o mapa original', () => {
    const casos: Array<[Partial<FlowState>, string]> = [
      [{ step: 'ENVIO_ARQUIVOS' }, 'NOME'],
      [{ step: 'CATEGORIAS', trilha: 'planta' }, 'ENVIO_ARQUIVOS'],
      [{ step: 'CATEGORIAS', trilha: 'semNada' }, 'PLANTA_ACHOU'],
      [{ step: 'PLANTA_ACHOU' }, 'CASA_AP'],
      [{ step: 'AGENDAR', local: 'casa' }, 'CASA_AP'],
      [{ step: 'AGENDAR', local: 'ap' }, 'PLANTA_ACHOU'],
      [{ step: 'HORARIO' }, 'AGENDAR'],
    ];
    for (const [over, esperado] of casos)
      expect(previousStep(st(over))).toBe(esperado);
  });

  it('0 no menu conta como inválido; 10 recomeça de qualquer lugar', () => {
    expect(step(st(), { kind: 'back' }).d.replies).toEqual([
      MESSAGES.invalida_generica,
    ]);
    const r = step(
      st({
        step: 'CATEGORIAS',
        trilha: 'planta',
        nome: 'Ana',
        categorias: [1],
      }),
      { kind: 'restart' },
    );
    expect(r.state).toMatchObject({
      step: 'MENU',
      trilha: null,
      nome: null,
      categorias: [],
    });
  });

  it('inválida: avisa 1x, silencia, e entrega a um humano ao atingir o limite', () => {
    let r = step(st(), { kind: 'invalid' });
    expect(r.d.replies).toEqual([MESSAGES.invalida_generica]);
    r = step(r.state, { kind: 'invalid' });
    expect(r.d.replies).toEqual([]);
    r = step(r.state, { kind: 'invalid' });
    expect(r.d.effects[0]).toMatchObject({ type: 'handoff' });
  });

  it('entrada válida zera o contador de inválidas', () => {
    const r = step(st({ invalidCount: 2 }), { kind: 'option', value: 1 });
    expect(r.state.invalidCount).toBe(0);
  });

  it('dúvida é respondida e o passo é reapresentado, sem contar erro', () => {
    const r = step(st({ step: 'CASA_AP' }), {
      kind: 'duvida',
      resposta: 'A loja fica na Djalma Batista.',
    });
    expect(r.d.replies).toEqual([
      'A loja fica na Djalma Batista.',
      MESSAGES.casa_ou_ap,
    ]);
    expect(r.state.invalidCount).toBe(0);
  });

  it('em atendimento humano o bot não faz nada', () => {
    const d = decide(
      st({ step: 'HUMANO' }),
      { kind: 'option', value: 1 },
      OPTS,
    );
    expect(d).toEqual({ patch: {}, replies: [], effects: [] });
  });

  it('opções válidas por passo', () => {
    expect(validOptions(st())).toEqual([1, 2, 3, 4, 5]);
    expect(
      validOptions(
        st({
          step: 'HORARIO',
          slots: new Array(3).fill({ startUtc: '', endUtc: '', label: '' }),
        }),
      ),
    ).toEqual([1, 2, 3, 9]);
  });
});

describe('sanitizeFreeReply', () => {
  it('aceita fatos da base', () => {
    expect(
      sanitizeFreeReply('Nossa loja fica na Av. Djalma Batista, 1334.'),
    ).not.toBeNull();
  });
  it.each([
    'O ambiente sai por R$ 15.000.',
    'Damos 10% de desconto!',
    'Veja em https://exemplo.com',
    'Ligue para 99999-0000 agora',
    'Entregamos em 30 dias úteis, 100% garantido',
    '',
  ])('rejeita %j', (t) => expect(sanitizeFreeReply(t)).toBeNull());
});

describe('computeSlots', () => {
  // Segunda-feira 2025-07-07 08:00 em Manaus = 12:00 UTC
  const mondayMorning = new Date('2025-07-07T12:00:00Z');

  it('oferece até 8 horários de 2h em dias úteis, em ordem', () => {
    const slots = computeSlots(mondayMorning, []);
    expect(slots).toHaveLength(8);
    expect(slots[0].label).toBe('07/07/2025 09:00 - 11:00'); // 07–09 já passou/está a <1h
    expect(slots.every((s) => !/(sábado|domingo)/.test(s.label))).toBe(true);
    const days = new Set(slots.map((s) => s.label.slice(0, 5)));
    expect([...days].every((d) => !['12/07', '13/07'].includes(d))).toBe(true);
  });

  it('convertendo para UTC corretamente (Manaus = UTC-4)', () => {
    const slots = computeSlots(new Date('2025-07-07T04:00:00Z'), []); // 00:00 em Manaus
    expect(slots[0].startUtc).toBe('2025-07-07T11:00:00.000Z'); // 07:00 Manaus
  });

  it('compromisso de manhã bloqueia a manhã inteira; sobra só a tarde', () => {
    const busy = [
      {
        start: new Date('2025-07-08T12:00:00Z'),
        end: new Date('2025-07-08T13:00:00Z'),
      },
    ]; // terça 08–09 Manaus
    const slots = computeSlots(new Date('2025-07-07T04:00:00Z'), busy);
    const terca = slots.filter((s) => s.label.startsWith('08/07'));
    expect(terca.map((s) => s.label.slice(11))).toEqual([
      '13:00 - 15:00',
      '15:00 - 17:00',
    ]);
  });

  it('depois das 17h hoje não é oferecido; sábado pula para segunda', () => {
    const sexta18h = new Date('2025-07-11T22:00:00Z'); // 18:00 Manaus
    const slots = computeSlots(sexta18h, []);
    expect(slots[0].label.startsWith('14/07/2025')).toBe(true);
  });

  it('atravessa a virada de mês', () => {
    const slots = computeSlots(new Date('2025-07-31T04:00:00Z'), [], {
      weekdays: 5,
      maxOptions: 20,
      lastHourToday: 17,
      minLeadMinutes: 0,
    });
    expect(slots.some((s) => s.label.includes('/08/2025'))).toBe(true);
  });

  it('renderSlotList monta a lista dinâmica com a opção 9', () => {
    const text = renderSlotList(MESSAGES.escolher_horario, [
      { startUtc: 'a', endUtc: 'b', label: '04/07/2025 07:00 - 09:00' },
      { startUtc: 'c', endUtc: 'd', label: '04/07/2025 09:00 - 11:00' },
    ]);
    expect(text).toContain('*1 - 04/07/2025 07:00 - 09:00*');
    expect(text).toContain('2 - 04/07/2025 09:00 - 11:00');
    expect(text).toContain('*9 - Nenhum desses horários.*');
    expect(text).not.toContain('{horario');
  });
});

describe('MESSAGES', () => {
  it('só usa placeholders conhecidos ({nome}, {horario1..8})', () => {
    const known = new Set([
      'nome',
      ...Array.from({ length: 8 }, (_, i) => `horario${i + 1}`),
    ]);
    for (const [key, text] of Object.entries(MESSAGES)) {
      for (const [, name] of text.matchAll(/\{(\w+)\}/g)) {
        expect({ key, placeholder: name, ok: known.has(name) }).toEqual({
          key,
          placeholder: name,
          ok: true,
        });
      }
    }
  });

  it('a mensagem de encaminhamento com nome é preenchida', () => {
    const text = MESSAGES.redirecionando_projetistas_com_nome.replace(
      '{nome}',
      'Ana',
    );
    expect(text).toContain('*Ana*');
  });
});
