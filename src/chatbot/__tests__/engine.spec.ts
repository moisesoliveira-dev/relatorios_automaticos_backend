import {
  currentNode,
  parseText,
  promptOf,
  resumeTool,
  startFlow,
  stepFlow,
  Published,
} from '../engine/flow.engine';
import { checkDoc, checkFlow } from '../engine/flow.validate';
import { DEFAULT_SYSTEM, head, seedFlows } from '../engine/flow.seed';
import { convertLegacyDoc } from '../engine/legacy';
import {
  ContentDoc,
  FlowDoc,
  FlowResult,
  FlowState,
} from '../engine/flow.types';
import { ToolCatalog, ToolDefinition } from '../engine/tool.types';
import { MESSAGES } from '../domain/chatbot.messages';

/** Catálogo de ferramentas falso, com os mesmos contratos das reais. */
const tool = (
  key: string,
  extra: Partial<ToolDefinition> = {},
): ToolDefinition => ({
  key,
  label: key,
  descricao: '',
  grupo: 'Outros',
  modo: 'acao',
  params: [],
  disponivel: () => true,
  executar: async () => ({ ok: true }),
  simular: () => ({ ok: true }),
  ...extra,
});
const catalog: ToolCatalog = {
  list: () => [],
  get: (key) =>
    ({
      'drive.criar_pasta': tool(key, {
        requer: { vars: ['nome'] },
        produz: { pasta: true },
      }),
      'drive.salvar_respostas': tool(key, { requer: { pasta: true } }),
      'teste.escolher': tool(key, {
        modo: 'escolha',
        params: [
          { key: 'texto', label: 'Texto', type: 'texto', obrigatorio: true },
        ],
      }),
      'teste.confirmar': tool(key, {
        params: [
          { key: 'escolha', label: 'e', type: 'variavel', obrigatorio: true },
        ],
        produz: { vars: ['confirmado'] },
      }),
      'conversa.definir': tool(key, {
        params: [
          {
            key: 'variavel',
            label: 'v',
            type: 'variavel',
            obrigatorio: true,
            define: true,
          },
          {
            key: 'valor',
            label: 'x',
            type: 'texto',
            obrigatorio: true,
            template: true,
          },
        ],
      }),
    })[key],
};

const published = (): Published => ({
  fluxos: seedFlows(),
  sistema: { ...DEFAULT_SYSTEM },
});
const opts = { maxInvalid: 3 };

/** Roda ferramentas em modo "ok" até a próxima etapa de espera (como o serviço faz). */
function settle(
  p: Published,
  r: FlowResult,
  results: Record<string, unknown> = {},
): FlowResult {
  let cur = r;
  for (let i = 0; i < 10 && cur.state; i++) {
    const eff = cur.effects.find((e) => e.type === 'ferramenta');
    if (!eff || eff.type !== 'ferramenta') break;
    const res = (results[eff.ferramenta] as never) ?? { ok: true };
    const next = resumeTool(p, cur.state, res);
    cur = {
      ...next,
      replies: [...cur.replies, ...next.replies],
      nome: next.nome ?? cur.nome,
    };
  }
  return cur;
}
const say = (p: Published, s: FlowState, text: string, hasFile = false) =>
  stepFlow(
    p,
    s,
    parseText(p, s, text, hasFile) ?? { kind: 'valor', valor: text },
    opts,
  );
const texts = (r: FlowResult) => r.replies.map((x) => x.texto);

describe('seed da Vera', () => {
  it('é válido para publicar', () => {
    const fluxos = seedFlows();
    for (const f of fluxos) expect(checkFlow(f, catalog, fluxos)).toEqual([]);
    expect(checkDoc(fluxos)).toEqual([]);
  });

  it('tira opções e rodapé dos textos antigos', () => {
    expect(head(MESSAGES.pedir_nome)).toBe(
      'Antes de prosseguirmos, você pode me informar seu nome, por gentileza? 😊',
    );
    expect(head(MESSAGES.menu_inicial)).not.toContain('*1*');
    expect(head(MESSAGES.casa_ou_ap)).not.toContain('Por favor, responda');
  });

  it('menu inicial: sem rodapé, com as 5 opções numeradas', () => {
    const p = published();
    const r = startFlow(p, 'vera');
    expect(r.state?.nodeId).toBe('menu');
    const t = texts(r)[0];
    expect(t).toContain('*1* - 📐 Já tenho o projeto');
    expect(t).toContain('*5* - 📍');
    expect(t).not.toContain('0 - ↩️');
    expect(t).toContain(DEFAULT_SYSTEM.rodape_escolha);
  });

  it('caminho "já tenho o projeto": nome → confirmação → pasta → arquivos → OK → encaminha', () => {
    const p = published();
    let r = startFlow(p, 'vera');
    r = say(p, r.state!, '1');
    expect(r.state?.flowId).toBe('projeto');
    expect(r.state?.vars['trilha']).toBe('projeto');
    expect(texts(r)[0]).toContain('seu nome');
    expect(texts(r)[0]).toContain(DEFAULT_SYSTEM.rodape_navegacao);

    r = say(p, r.state!, 'me chamo ana paula');
    expect(r.nome).toBe('Ana Paula');
    expect(texts(r)[0]).toContain('*Ana Paula*');
    expect(texts(r)[0]).toContain('*1* - Sim');

    r = say(p, r.state!, 'sim'); // palavra-chave, sem IA
    expect(r.effects[0]).toMatchObject({
      type: 'ferramenta',
      ferramenta: 'drive.criar_pasta',
    });
    r = settle(p, r);
    expect(r.state?.nodeId).toBe('arquivos');
    expect(texts(r)[0]).toContain('Pode enviar o projeto');

    r = say(p, r.state!, 'ok'); // sem arquivo: inválido (1ª vez avisa)
    expect(r.invalido).toBe(true);
    expect(texts(r)[0]).toBe(DEFAULT_SYSTEM.invalida_arquivos);

    r = say(p, r.state!, '', true);
    expect(r.state?.arquivos).toBe(1);
    expect(texts(r)[0]).toContain('*OK*');
    r = say(p, r.state!, 'ok');
    expect(r.saiu).toBe('encaminhado');
    expect(r.effects[0]).toMatchObject({ type: 'handoff', comNome: true });
  });

  it('"não tenho nada": ambientes em lista e, ao querer agendar, segue para o responsável combinar a medição', () => {
    const p = published();
    let r = startFlow(p, 'vera');
    r = say(p, r.state!, '3');
    r = say(p, r.state!, 'Bruno');
    r = settle(p, say(p, r.state!, '1'));
    expect(r.state?.nodeId).toBe('imovel');
    r = say(p, r.state!, '2'); // apartamento → instruções (mensagem) + achou?
    expect(r.state?.nodeId).toBe('planta_achou');
    expect(texts(r)).toHaveLength(2);
    r = say(p, r.state!, '1'); // achei → ambientes
    expect(r.state?.nodeId).toBe('ambientes');
    expect(texts(r)[0]).toContain('*9* - ❌ Nenhum destes ambientes');
    r = say(p, r.state!, '2 1 3');
    expect(r.state?.escolhidos).toEqual([2, 1, 3]);
    r = settle(p, say(p, r.state!, 'ok'));
    expect(r.state?.nodeId).toBe('agendar');
    expect(r.state?.vars['ambientes']).toBe(
      'Sala de Estar, Cozinha, Dormitório',
    );

    r = say(p, r.state!, '1'); // quero agendar → um atendente combina o horário
    expect(r.saiu).toBe('encaminhado');
    expect(texts(r).join(' ')).toContain('responsável');
    expect(r.effects[0]).toMatchObject({ type: 'handoff' });
  });

  describe('etapa de ferramenta com opções dinâmicas', () => {
    const flowEscolha = (): Published => ({
      fluxos: [
        {
          id: 'f',
          nome: 'Fluxo de teste',
          descricao: '',
          ativo: true,
          nos: [
            {
              id: 'opcoes',
              tipo: 'ferramenta',
              titulo: 'Oferecer opções',
              ferramenta: 'teste.escolher',
              params: { texto: 'Escolha uma opção', nenhum: 'Nenhuma.' },
              variavel: 'escolha',
              proximo: 'decidir',
              falha: 'enc',
              semOpcoes: 'enc',
            },
            {
              id: 'decidir',
              tipo: 'condicao',
              titulo: 'Escolheu uma?',
              regras: [
                {
                  variavel: 'escolha',
                  op: 'igual',
                  valor: 'nenhum',
                  proximo: 'enc',
                },
              ],
              senao: 'confirmar',
            },
            {
              id: 'confirmar',
              tipo: 'ferramenta',
              titulo: 'Confirmar',
              ferramenta: 'teste.confirmar',
              params: { escolha: 'escolha' },
              proximo: 'enc',
              falha: 'opcoes',
            },
            { id: 'enc', tipo: 'encaminhar', titulo: 'Encaminhar' },
          ],
        } as FlowDoc,
      ],
      sistema: { ...DEFAULT_SYSTEM },
    });

    it('lista as opções que a ferramenta devolveu e guarda a escolhida', () => {
      const p = flowEscolha();
      let r = startFlow(p, 'f');
      expect(r.effects[0]).toMatchObject({
        type: 'ferramenta',
        ferramenta: 'teste.escolher',
      });
      r = settle(p, r, {
        'teste.escolher': {
          ok: true,
          opcoes: [
            { rotulo: 'Opção A', valor: 'a|b' },
            { rotulo: 'Nenhuma', valor: 'nenhum' },
          ],
        },
      });
      expect(r.state?.nodeId).toBe('opcoes');
      expect(r.state?.dinamicas).toHaveLength(2);
      expect(texts(r)[0]).toContain('*1* - Opção A');

      r = say(p, r.state!, '1');
      expect(r.state?.vars['escolha']).toBe('a|b');
      expect(r.effects[0]).toMatchObject({
        type: 'ferramenta',
        ferramenta: 'teste.confirmar',
      });
      r = settle(p, r);
      expect(r.saiu).toBe('encaminhado');
    });

    it('se a confirmação falha, avisa e oferece de novo; "nenhuma" encaminha', () => {
      const p = flowEscolha();
      const s: FlowState = {
        flowId: 'f',
        nodeId: 'opcoes',
        historico: [],
        vars: {},
        arquivos: 0,
        invalidos: 0,
        dinamicas: [
          { rotulo: 'A', valor: 'a|b' },
          { rotulo: 'n', valor: 'nenhum' },
        ],
      };
      const escolhido = say(p, s, '1');
      const after = resumeTool(p, escolhido.state!, {
        ok: false,
        motivo: 'ocupado',
        replies: ['ocupado!'],
      });
      expect(texts(after)[0]).toBe('ocupado!');
      expect(after.effects[0]).toMatchObject({
        ferramenta: 'teste.escolher',
      });
      expect(say(p, s, '2').saiu).toBe('encaminhado');
    });

    it('sem opções segue pelo caminho "semOpcoes"', () => {
      const p = flowEscolha();
      const s: FlowState = {
        flowId: 'f',
        nodeId: 'opcoes',
        historico: [],
        vars: {},
        arquivos: 0,
        invalidos: 0,
      };
      expect(resumeTool(p, s, { ok: true, opcoes: [] }).saiu).toBe(
        'encaminhado',
      );
    });
  });

  it('0 volta uma etapa, 10 recomeça, atendente encaminha', () => {
    const p = published();
    let r = say(p, startFlow(p, 'vera').state!, '2');
    r = say(p, r.state!, 'Joana');
    expect(r.state?.nodeId).toBe('confirma');
    r = say(p, r.state!, '0');
    expect(r.state?.nodeId).toBe('nome');
    expect(say(p, r.state!, '10').saiu).toBe('menu');
    expect(say(p, r.state!, 'quero falar com atendente').saiu).toBe(
      'encaminhado',
    );
  });

  it('boleto: "não" volta ao menu com a mensagem de reapresentação', () => {
    const p = published();
    let r = say(p, startFlow(p, 'vera').state!, '4');
    expect(r.state?.flowId).toBe('boleto');
    expect(texts(r)).toHaveLength(2);
    r = say(p, r.state!, '2');
    expect(r.saiu).toBe('menu');
    expect(texts(r)[0]).toContain('outra forma de atendimento');
  });

  it('respostas inválidas: avisa uma vez, silencia e no limite encaminha', () => {
    const p = published();
    let r = say(p, startFlow(p, 'vera').state!, 'xpto');
    expect(r.invalido).toBe(true);
    expect(texts(r)).toEqual([DEFAULT_SYSTEM.invalida_generica]);
    r = say(p, r.state!, 'xpto');
    expect(texts(r)).toEqual([]);
    r = say(p, r.state!, 'xpto');
    expect(r.saiu).toBe('encaminhado');
  });

  it('dúvida respondida reapresenta a etapa', () => {
    const p = published();
    const s = startFlow(p, 'vera').state!;
    const r = stepFlow(
      p,
      s,
      { kind: 'duvida', resposta: 'A loja fica na Djalma.' },
      opts,
    );
    expect(texts(r)[0]).toBe('A loja fica na Djalma.');
    expect(texts(r)[1]).toBe(promptOf(p, s)!.texto);
  });

  it('reconhecimento: recomeçar volta ao menu; atendente reutiliza quem atendeu', () => {
    const p = published();
    let r = startFlow(p, 'reconhecimento', { nome: 'Lia' });
    expect(currentNode(p, r.state)?.tipo).toBe('opcoes');
    expect(say(p, r.state!, '1').saiu).toBe('menu');
    r = say(p, r.state!, '2');
    expect(r.effects[0]).toMatchObject({ type: 'handoff', reutilizar: true });
  });
});

describe('motor: condição, ir para, ferramenta que define variável', () => {
  const flows: FlowDoc[] = [
    {
      id: 'a',
      nome: 'A',
      ativo: true,
      papel: 'entrada',
      nos: [
        {
          id: 'p',
          tipo: 'pergunta',
          titulo: 'Cidade',
          texto: 'Cidade?',
          variavel: 'cidade',
          proximo: 'd',
        },
        {
          id: 'd',
          tipo: 'ferramenta',
          titulo: 'Marca',
          ferramenta: 'conversa.definir',
          params: { variavel: 'origem', valor: 'de {cidade}' },
          proximo: 'c',
        },
        {
          id: 'c',
          tipo: 'condicao',
          titulo: 'Decide',
          regras: [
            { variavel: 'cidade', op: 'igual', valor: 'Manaus', proximo: 'g' },
          ],
          senao: 'f',
        },
        { id: 'g', tipo: 'ir_para', titulo: 'Vai', fluxo: 'b' },
        { id: 'f', tipo: 'fim', titulo: 'Fim', texto: 'Tchau {origem}' },
      ],
    },
    {
      id: 'b',
      nome: 'B',
      ativo: true,
      nos: [
        {
          id: 'm',
          tipo: 'mensagem',
          titulo: 'Oi',
          texto: 'Bem-vindo {origem}',
          proximo: 'e',
        },
        { id: 'e', tipo: 'encaminhar', titulo: 'E' },
      ],
    },
  ];
  const p: Published = { fluxos: flows, sistema: { ...DEFAULT_SYSTEM } };

  it('valida', () => {
    for (const f of flows) expect(checkFlow(f, catalog, flows)).toEqual([]);
  });

  it('ramifica e troca de fluxo mantendo as variáveis', () => {
    let r = startFlow(p, 'a');
    r = settle(p, say(p, r.state!, 'Manaus'), {
      'conversa.definir': { ok: true, vars: { origem: 'de Manaus' } },
    });
    expect(r.saiu).toBe('encaminhado');
    expect(r.flowId).toBe('b');
    expect(texts(r)[0]).toBe('Bem-vindo de Manaus');
    r = startFlow(p, 'a');
    r = settle(p, say(p, r.state!, 'Belém'), {
      'conversa.definir': { ok: true, vars: { origem: 'de Belém' } },
    });
    expect(r.saiu).toBe('menu');
    expect(texts(r)[0]).toBe('Tchau de Belém');
  });

  it('aponta problemas de ordem e de destino', () => {
    const f: FlowDoc = {
      id: 'x',
      nome: 'X',
      ativo: true,
      nos: [
        {
          id: 'a1',
          tipo: 'ferramenta',
          titulo: 'Pasta',
          ferramenta: 'drive.criar_pasta',
          params: {},
          proximo: 'a2',
        },
        {
          id: 'a2',
          tipo: 'mensagem',
          titulo: 'Oi',
          texto: 'Oi {bairro}',
          proximo: 'zz',
        },
      ],
    };
    const e = checkFlow(f, catalog, [f]);
    expect(e.join('\n')).toContain('precisa de {nome} respondida antes');
    expect(e.join('\n')).toContain('não é uma variável deste fluxo');
    expect(e.join('\n')).toContain('não existe mais');
    expect(e.join('\n')).toContain('precisa terminar');
  });

  it('exige um fluxo de início', () => {
    expect(checkDoc([{ ...flows[1] }])).toContain(
      'Marque um fluxo ativo como “Início”: é por ele que todo cliente novo começa.',
    );
  });
});

describe('conversão do conteúdo antigo', () => {
  it('leva textos editados, ambientes renomeados, menu desativado e fluxos próprios para o modelo novo', () => {
    const doc: ContentDoc = convertLegacyDoc({
      messages: {
        pedir_nome:
          'Qual é o seu nome? 🙂\n\n0 - ↩️ Voltar uma etapa\n10 - 🔄 Recomeçar o atendimento',
        invalida_generica: 'Não entendi.',
      },
      categorias: { '1': 'Cozinha gourmet' },
      menuDesativado: [5],
      guidance: { tone: 'formal', instructions: 'Seja breve.' },
      kb: null,
      fluxos: [
        {
          id: 'docs',
          nome: 'Documentos',
          ativo: true,
          menuOpcao: 6,
          nos: [
            {
              id: 'n1',
              tipo: 'pergunta',
              titulo: 'Nome',
              texto: 'Nome?',
              variavel: 'nome',
              validacao: 'nome',
              proximo: 'n2',
            },
            {
              id: 'n2',
              tipo: 'arquivos',
              titulo: 'Docs',
              texto: 'Manda',
              armazenar: 'drive',
              pasta: 'criar',
              minimo: 1,
              proximo: 'n3',
            },
            {
              id: 'n3',
              tipo: 'acao',
              titulo: 'Salva',
              acao: 'drive_salvar_respostas',
              proximo: 'n4',
            },
            { id: 'n4', tipo: 'encaminhar', titulo: 'Fim' },
          ],
        },
      ],
    });
    expect(doc.versao).toBe(2);
    const nome = doc.fluxos
      .find((f) => f.id === 'projeto')!
      .nos.find((n) => n.id === 'nome');
    expect((nome as { texto: string }).texto).toBe('Qual é o seu nome? 🙂');
    expect(doc.sistema.invalida_generica).toBe('Não entendi.');
    const amb = doc.fluxos
      .find((f) => f.id === 'planta')!
      .nos.find((n) => n.id === 'ambientes');
    expect((amb as { itens: Array<{ rotulo: string }> }).itens[0].rotulo).toBe(
      'Cozinha gourmet',
    );
    const menu = doc.fluxos
      .find((f) => f.id === 'vera')!
      .nos.find((n) => n.id === 'menu');
    const opcoes = (
      menu as { opcoes: Array<{ valor?: string; rotulo: string }> }
    ).opcoes;
    expect(opcoes.some((o) => o.valor === 'loja')).toBe(false);
    expect(opcoes[opcoes.length - 1].rotulo).toBe('Documentos');
    expect(doc.fluxos.find((f) => f.id === 'loja')!.ativo).toBe(false);
    const docs = doc.fluxos.find((f) => f.id === 'docs')!;
    expect(docs.nos.map((n) => n.tipo)).toEqual([
      'pergunta',
      'ferramenta',
      'arquivos',
      'ferramenta',
      'encaminhar',
    ]);
    expect(doc.guidance).toEqual({
      tone: 'formal',
      instructions: 'Seja breve.',
    });
    for (const f of doc.fluxos)
      expect(checkFlow(f, catalog, doc.fluxos)).toEqual([]);
    expect(checkDoc(doc.fluxos)).toEqual([]);
  });
});
