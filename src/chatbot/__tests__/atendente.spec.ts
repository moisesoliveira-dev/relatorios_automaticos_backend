import {
  bolhasDoTurno,
  intencaoDoSistema,
  montarTurno,
  palavrasDaOpcao,
  validarTurno,
} from '../domain/turno';
import { SPECS } from '../domain/message-specs';
import {
  promptOf,
  pularRespondidas,
  startFlow,
  stepFlow,
  Published,
} from '../engine/flow.engine';
import { DEFAULT_SYSTEM, seedFlows } from '../engine/flow.seed';
import { Reply } from '../engine/flow.types';
import { ChatbotHumanizerService } from '../services/chatbot-humanizer.service';

const opcoes = [
  'Já tenho o projeto e quero orçar.',
  'Só tenho a planta baixa.',
  'Quero saber do boleto bancário.',
];
const menu: Reply = {
  texto:
    'Como posso ajudar?\n\n*1* - a\n\n👉 *Envie o número da opção desejada.*',
  nodeId: 'menu',
  spec: { objetivo: 'Perguntar como pode ajudar', pontos: [['ajudar']] },
  forma: { tipo: 'opcoes', corpo: 'Como posso ajudar?', opcoes },
};
const specDe = (r: Reply) => ({
  objetivo: r.spec?.objetivo ?? '',
  pontos: (r.spec?.pontos ?? []).map((anyOf) => ({ anyOf })),
  saudacao: r.spec?.saudacao,
});

describe('o turno da atendente', () => {
  it('opções entram em frase corrida, sem lista nem rodapé', () => {
    const t = montarTurno({
      itens: [{ reply: menu, spec: specDe(menu) }],
      primeira: true,
    });
    expect(t.opcoes).toEqual(opcoes);
    expect(t.literais).toEqual([]);
  });

  it('depois de um desvio não repete as opções', () => {
    const r: Reply = { ...menu, retomada: true };
    const t = montarTurno({
      itens: [{ reply: r, spec: specDe(r) }],
      primeira: false,
    });
    expect(t.opcoes).toEqual([]);
    expect(t.literais).toEqual([]);
    expect(t.spec.pontos).toEqual([]);
  });

  it('cliente não entendeu: a lista numerada aparece', () => {
    const inval: Reply = {
      texto: 'Não entendi',
      sistema: 'invalida_generica',
    };
    const t = montarTurno({
      itens: [
        {
          reply: inval,
          spec: intencaoDoSistema('invalida_generica', SPECS.invalida_generica),
        },
      ],
      pendente: { reply: { ...menu, retomada: true }, spec: specDe(menu) },
      primeira: false,
    });
    expect(t.literais[0]).toContain('*1* - Já tenho o projeto');
    expect(t.literais[0]).not.toContain('Envie o número');
    expect(t.temLista).toBe(true);
  });

  it('resposta verificada do FAQ e texto obrigatório nunca são reescritos', () => {
    const faq: Reply = { texto: 'Parcelamos em boleto.' };
    const obrig: Reply = {
      texto: 'Leve o documento.',
      nodeId: 'x',
      spec: { modo: 'obrigatorio' },
    };
    const t = montarTurno({
      itens: [
        { reply: faq },
        {
          reply: obrig,
          spec: { modo: 'obrigatorio', objetivo: '', pontos: [] },
        },
      ],
      primeira: false,
    });
    expect(t.literais).toEqual(['Parcelamos em boleto.', 'Leve o documento.']);
  });

  it('não acrescenta a etapa se o turno já fala dela', () => {
    const t = montarTurno({
      itens: [{ reply: menu, spec: specDe(menu) }],
      pendente: { reply: { ...menu, retomada: true }, spec: specDe(menu) },
      primeira: true,
    });
    expect(t.pedidos).toHaveLength(1);
  });

  it('endereço e telefone têm que chegar exatos', () => {
    const r: Reply = {
      texto: 'Av. Djalma Batista, 1334. Telefone 99455-1471',
      nodeId: 'e',
      spec: { objetivo: 'Informar o endereço' },
    };
    const t = montarTurno({
      itens: [{ reply: r, spec: { objetivo: 'x', pontos: [] } }],
      primeira: false,
    });
    expect(t.spec.manter).toEqual(['1334', '99455', '1471']);
    const v = validarTurno(
      { abertura: 'Fica na Djalma Batista, 1334.', fechamento: null },
      t,
      { recentBot: [] },
    );
    expect(v).toEqual({ ok: false, motivo: 'ponto_ausente:99455' });
  });
});

describe('revisor da atendente', () => {
  const turno = montarTurno({
    itens: [{ reply: menu, spec: specDe(menu) }],
    primeira: false,
  });
  const primeira = montarTurno({
    itens: [{ reply: menu, spec: specDe(menu) }],
    primeira: true,
  });
  const ok = (abertura: string, t = primeira, ultimaCliente?: string) =>
    validarTurno({ abertura, fechamento: null }, t, {
      recentBot: [],
      ultimaCliente,
    });
  const completa =
    'Boa tarde! Em que posso ajudar? Você já tem o projeto, só a planta ou quer saber do boleto?';

  it('aceita uma frase natural com todos os caminhos', () => {
    expect(ok(completa).ok).toBe(true);
  });
  it('reprova se esquecer um caminho', () => {
    expect(ok('Em que posso ajudar? Já tem o projeto ou só a planta?')).toEqual(
      {
        ok: false,
        motivo: expect.stringContaining('opcao_ausente') as string,
      },
    );
  });
  it('reprova rótulo de opção solto no fim', () => {
    expect(
      validarTurno(
        { abertura: completa, fechamento: 'Quero agendar 📝' },
        primeira,
        {
          recentBot: [],
        },
      ),
    ).toEqual({ ok: false, motivo: 'copiou_opcoes' });
  });
  it('reprova repetir o dado que o texto fixo já trouxe', () => {
    const faq: Reply = { texto: 'A loja fica na Av. Djalma, 1334.' };
    const t = montarTurno({ itens: [{ reply: faq }], primeira: false });
    t.pedidos.push('continuar');
    expect(
      validarTurno(
        { abertura: 'A loja fica no 1334, tá?', fechamento: null },
        t,
        {
          recentBot: [],
        },
      ),
    ).toEqual({ ok: false, motivo: 'repetiu_texto_fixo' });
  });
  it('reprova cara de menu', () => {
    expect(ok(`${completa} Envie o número da opção desejada.`)).toEqual({
      ok: false,
      motivo: 'tom_de_menu',
    });
  });
  it('reprova inventar preço, mesmo em conversa', () => {
    expect(ok(`${completa} Sai por R$ 500.`).ok).toBe(false);
  });
  it('pode citar desconto só para passar ao projetista', () => {
    expect(ok(`${completa} Desconto quem vê é o projetista.`).ok).toBe(true);
    expect(ok(`${completa} Hoje tem desconto!`).ok).toBe(false);
  });
  it('não se apresenta nem cumprimenta de novo, salvo se o cliente cumprimentou', () => {
    const t = turno;
    const r = montarTurno({
      itens: [{ reply: { ...menu, retomada: true }, spec: specDe(menu) }],
      primeira: false,
    });
    expect(ok('Sou a Vera. Em que mais posso ajudar?', r).ok).toBe(false);
    expect(ok('Oi! Em que mais posso ajudar?', r).ok).toBe(false);
    expect(ok('Oi! Em que mais posso ajudar?', r, 'oi, bom dia').ok).toBe(true);
    expect(t.primeira).toBe(false);
  });
  it('palavras da opção ignoram verbos genéricos e acentos', () => {
    expect(palavrasDaOpcao('📍 Qual endereço da loja física?')).toEqual([
      'endereco',
      'loja',
      'fisica',
    ]);
  });
});

describe('bolhas da atendente', () => {
  it('fica tudo em uma mensagem', () => {
    expect(
      bolhasDoTurno({ abertura: '', fechamento: 'E você?' }, ['Temos sim.']),
    ).toEqual(['Temos sim.\n\nE você?']);
  });
  it('a resposta verificada abre a mensagem quando é o primeiro item', () => {
    expect(
      bolhasDoTurno(
        { abertura: 'Tem projeto?', fechamento: null },
        ['Sim, somos a loja.'],
        true,
      ),
    ).toEqual(['Sim, somos a loja.\n\nTem projeto?']);
  });
  it('só divide o que ficaria comprido demais', () => {
    expect(
      bolhasDoTurno({ abertura: 'Olha só:', fechamento: null }, [
        'x'.repeat(800),
      ]),
    ).toHaveLength(2);
  });
});

describe('etapas já respondidas', () => {
  const p: Published = { fluxos: seedFlows(), sistema: DEFAULT_SYSTEM };
  const opts = { maxInvalid: 5 };

  it('depois do nome, não pede confirmação', () => {
    const inicio = startFlow(p, 'projeto');
    const r = stepFlow(
      p,
      inicio.state!,
      { kind: 'valor', valor: 'Ana Souza' },
      opts,
    );
    expect(r.state?.nodeId).toBe('confirma');
    const pulou = pularRespondidas(p, r, opts);
    expect(pulou.state?.nodeId).toBe('pasta');
    expect(pulou.replies).toEqual([]);
    expect(pulou.effects[0]).toMatchObject({ ferramenta: 'drive.criar_pasta' });
    expect(pulou.state?.historico).not.toContain('confirma');
  });

  it('nome conhecido não é perguntado de novo', () => {
    const pulou = pularRespondidas(
      p,
      startFlow(p, 'projeto', { nome: 'Ana' }),
      opts,
    );
    expect(pulou.state?.nodeId).toBe('pasta');
    expect(pulou.state?.historico).toEqual([]);
  });

  it('nome dito junto da escolha já vale', () => {
    const menu = startFlow(p, 'vera');
    const r = stepFlow(
      p,
      menu.state!,
      { kind: 'opcao', index: 1, nomeCitado: 'Carla' },
      opts,
    );
    expect(r.nome).toBe('Carla');
    expect(pularRespondidas(p, r, opts).state?.nodeId).toBe('pasta');
  });

  it('a etapa traz as partes para a atendente', () => {
    const menu = startFlow(p, 'vera');
    expect(menu.replies[0].forma?.opcoes).toHaveLength(5);
    expect(menu.replies[0].forma?.corpo).not.toContain('*1*');
    expect(promptOf(p, menu.state!)?.forma?.opcoes).toHaveLength(5);
  });
});

describe('falhas da atendente', () => {
  const montar = (run: () => Promise<unknown>, ligado = true) =>
    new ChatbotHumanizerService(
      {
        chatbot: { humanize: true, writerDailyLimit: 50, atendente: ligado },
      } as never,
      { enabled: true, breakerOpen: false } as never,
      { run: async () => null } as never,
      { run } as never,
    );
  const ctx = { contactId: 1, nome: null, history: [] };

  it('sem resposta da IA, vão os textos completos do fluxo', async () => {
    const svc = montar(async () => null);
    expect(await svc.compose(ctx, [menu])).toEqual([menu.texto]);
  });
  it('reprovada, vão os textos completos do fluxo', async () => {
    const svc = montar(async () => ({
      abertura: 'Envie o número da opção desejada.',
      fechamento: null,
    }));
    expect(await svc.compose(ctx, [menu])).toEqual([menu.texto]);
    expect(svc.counters.fallback_validacao).toBe(1);
  });
  it('desligada, volta ao jeito antigo', () => {
    expect(montar(async () => null, false).atendenteAtivo).toBe(false);
  });
});
