import { MESSAGES } from './chatbot.messages';
import { restartDecision } from './chatbot.flow';
import type { Decision, Effect } from './chatbot.types';
import { OK_RE, normalizeText, validarNome } from './input-parser';

/**
 * Fluxos de atendimento criados pela tela. O motor é PURO: recebe o fluxo, o estado e a mensagem
 * do cliente e devolve o novo estado, os textos e os efeitos externos — o mesmo contrato do motor
 * fixo, o que permite testar um fluxo (rascunho) sem enviar nada a ninguém.
 */
export type NodeType =
  | 'mensagem'
  | 'opcoes'
  | 'confirmacao'
  | 'pergunta'
  | 'arquivos'
  | 'acao'
  | 'encaminhar'
  | 'fim';

export type ToolKey = 'drive_criar_pasta' | 'drive_salvar_respostas';

export interface FlowNode {
  id: string;
  tipo: NodeType;
  /** Nome interno, só para quem monta o fluxo. */
  titulo: string;
  texto?: string;
  proximo?: string | null;
  opcoes?: Array<{ rotulo: string; proximo: string | null }>;
  /** pergunta/opcoes: nome da variável onde a resposta fica guardada ({variavel} nos textos). */
  variavel?: string;
  validacao?: 'nome' | 'texto';
  /** arquivos: quantidade mínima antes de aceitar o "OK". */
  minimo?: number;
  acao?: ToolKey;
  /** arquivos (solicitação): guarda o que o cliente enviar no Drive. */
  armazenar?: 'drive';
  /** armazenar=drive: 'criar' cria a pasta se faltar (e reaproveita a que existe); 'existente' só usa a pasta que já existe. */
  pasta?: 'criar' | 'existente';
}

export interface FlowGuidance {
  tone: string;
  instructions: string;
}
export interface FlowKbEntry {
  id: string;
  keywords: string[];
  text: string;
}

export interface CustomFlow {
  id: string;
  nome: string;
  descricao?: string;
  ativo: boolean;
  /** Número no menu inicial (6 a 9). */
  menuOpcao: number | null;
  /** O fluxo começa no primeiro bloco. */
  nos: FlowNode[];
  /** Jeito de falar deste fluxo (vale para a IA quando ela escreve/responde nele). */
  guidance?: FlowGuidance;
  /** A IA reescreve os textos dos blocos no tom deste fluxo (revisados antes de enviar). */
  reescrever?: boolean;
  /** O que a IA pode responder quando o cliente faz uma pergunta dentro deste fluxo. */
  kb?: FlowKbEntry[];
}

export interface CustomState {
  flowId: string;
  nodeId: string;
  /** Blocos de espera já visitados (para o "0 - voltar"). */
  historico: string[];
  vars: Record<string, string>;
  arquivos: number;
  invalidos: number;
}

export type CustomEffect =
  | { type: 'criar_pasta'; somenteSeExistir?: boolean }
  | {
      type: 'salvar_respostas';
      titulo: string;
      itens: Array<{ rotulo: string; valor: string }>;
    }
  | { type: 'handoff'; comNome: boolean; texto?: string; flowId?: string };

export interface CustomResult {
  /** null = o cliente saiu do fluxo (veja `saiu`). */
  state: CustomState | null;
  replies: string[];
  effects: CustomEffect[];
  /** Nome informado pelo cliente (grava no cadastro da conversa). */
  nome?: string;
  saiu: 'menu' | 'encaminhado' | null;
  /** O texto não serviu como resposta (e ainda não chegou ao limite): candidato a ser tratado como dúvida. */
  invalido?: boolean;
}

export const WAITING: NodeType[] = [
  'opcoes',
  'confirmacao',
  'pergunta',
  'arquivos',
];

/** Confirmação: sempre duas opções, Sim e Não. */
export const CONFIRMACAO_ROTULOS = ['Sim', 'Não'];
export const TOOLS: Array<{ key: ToolKey; label: string; descricao: string }> =
  [
    {
      key: 'drive_criar_pasta',
      label: 'Drive: criar a pasta do cliente',
      descricao:
        'Cria a pasta do cliente no Google Drive (ano/mês/ANDAMENTO). Precisa do nome do cliente, perguntado antes com a variável "nome". Os arquivos que ele enviar depois vão para essa pasta.',
    },
    {
      key: 'drive_salvar_respostas',
      label: 'Drive: salvar as respostas',
      descricao:
        'Grava um arquivo de texto com as respostas já coletadas na pasta do cliente. Precisa da pasta criada antes.',
    },
  ];

const MAX_STEPS = 30;
const FOOTER_BACK = '0 - ↩️ Voltar uma etapa\n10 - 🔄 Recomeçar o atendimento';

export const slug = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

/** Preenche {variavel}; variável sem resposta vira texto vazio. */
export const render = (t: string, vars: Record<string, string>): string =>
  t.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

const byId = (flow: CustomFlow, id: string | null | undefined) =>
  flow.nos.find((n) => n.id === id);

function prompt(node: FlowNode, vars: Record<string, string>): string {
  const base = render(node.texto ?? '', vars);
  if (node.tipo === 'opcoes' || node.tipo === 'confirmacao') {
    const lista = (node.opcoes ?? [])
      .map((o, i) => `*${i + 1}* - ${o.rotulo}`)
      .join('\n');
    return `${base}\n\n${lista}\n\n${FOOTER_BACK}\n\n👉 *Envie o número da opção desejada.*`;
  }
  if (node.tipo === 'arquivos')
    return `${base}\n\nQuando terminar, envie a palavra *OK*.\n\n${FOOTER_BACK}`;
  return `${base}\n\n${FOOTER_BACK}`;
}

const answers = (flow: CustomFlow, vars: Record<string, string>) =>
  flow.nos
    .filter((n) => n.variavel && vars[n.variavel] !== undefined)
    .map((n) => ({ rotulo: n.titulo, valor: vars[n.variavel!] }));

/** Começa o fluxo e roda os blocos automáticos até o primeiro que espera o cliente. */
export function startFlow(
  flow: CustomFlow,
  nomeConhecido?: string | null,
): CustomResult {
  const vars: Record<string, string> = nomeConhecido
    ? { nome: nomeConhecido }
    : {};
  const state: CustomState = {
    flowId: flow.id,
    nodeId: flow.nos[0]?.id ?? '',
    historico: [],
    vars,
    arquivos: 0,
    invalidos: 0,
  };
  return enter(flow, state, state.nodeId, { replies: [], effects: [] });
}

interface Acc {
  replies: string[];
  effects: CustomEffect[];
  nome?: string;
}

function enter(
  flow: CustomFlow,
  state: CustomState,
  startId: string,
  acc: Acc,
): CustomResult {
  let id: string | null | undefined = startId;
  for (let i = 0; i < MAX_STEPS; i++) {
    const node = byId(flow, id);
    if (!node) return leave(acc, 'menu'); // referência quebrada: volta ao menu com segurança
    switch (node.tipo) {
      case 'mensagem':
        acc.replies.push(render(node.texto ?? '', state.vars));
        id = node.proximo;
        break;
      case 'acao':
        if (node.acao === 'drive_criar_pasta')
          acc.effects.push({ type: 'criar_pasta' });
        else if (node.acao === 'drive_salvar_respostas')
          acc.effects.push({
            type: 'salvar_respostas',
            titulo: flow.nome,
            itens: answers(flow, state.vars),
          });
        id = node.proximo;
        break;
      case 'encaminhar': {
        const texto = node.texto
          ? render(node.texto, state.vars).trim()
          : undefined;
        acc.effects.push({
          type: 'handoff',
          comNome: !!state.vars.nome,
          texto: texto || undefined,
        });
        return leave(acc, 'encaminhado');
      }
      case 'fim':
        if (node.texto) acc.replies.push(render(node.texto, state.vars));
        return leave(acc, 'menu');
      default: // opcoes | confirmacao | pergunta | arquivos: espera o cliente
        if (node.tipo === 'arquivos' && node.armazenar === 'drive')
          acc.effects.push({
            type: 'criar_pasta',
            somenteSeExistir: node.pasta === 'existente' || undefined,
          });
        acc.replies.push(prompt(node, state.vars));
        return {
          state: { ...state, nodeId: node.id, invalidos: 0 },
          replies: acc.replies,
          effects: acc.effects,
          nome: acc.nome,
          saiu: null,
        };
    }
  }
  return leave(acc, 'menu');
}

const leave = (acc: Acc, saiu: 'menu' | 'encaminhado'): CustomResult => ({
  state: null,
  replies: acc.replies,
  effects: acc.effects,
  nome: acc.nome,
  saiu,
});

/** Processa a mensagem do cliente num bloco de espera. */
export function stepFlow(
  flow: CustomFlow,
  state: CustomState,
  input: { text: string; hasFile: boolean },
  opts: { maxInvalid: number },
): CustomResult {
  const node = byId(flow, state.nodeId);
  const acc: Acc = { replies: [], effects: [] };
  if (!node || !WAITING.includes(node.tipo)) return leave(acc, 'menu');
  const text = normalizeText(input.text);

  if (text === '10') return leave(acc, 'menu');
  if (text === '0') {
    const prev = state.historico[state.historico.length - 1];
    if (!prev) return leave(acc, 'menu');
    return enter(
      flow,
      { ...state, historico: state.historico.slice(0, -1) },
      prev,
      acc,
    );
  }

  const advance = (
    next: string | null | undefined,
    patch: Partial<CustomState>,
  ): CustomResult =>
    enter(
      flow,
      {
        ...state,
        ...patch,
        historico: [...state.historico, node.id],
        invalidos: 0,
      },
      next ?? '',
      acc,
    );

  switch (node.tipo) {
    case 'confirmacao':
    case 'opcoes': {
      const opcoes = node.opcoes ?? [];
      const n = /^(\d{1,2})[.)]?$/.exec(text);
      let escolhida = n ? opcoes[Number(n[1]) - 1] : undefined;
      if (!escolhida && text) {
        const t = slug(text);
        escolhida = opcoes.find((o) => slug(o.rotulo) === t);
      }
      if (!escolhida) break;
      const vars = node.variavel
        ? { ...state.vars, [node.variavel]: escolhida.rotulo }
        : state.vars;
      return advance(escolhida.proximo, { vars });
    }
    case 'pergunta': {
      if (!text) break;
      const valor =
        node.validacao === 'nome' || node.variavel === 'nome'
          ? validarNome(text)
          : text.slice(0, 300);
      if (!valor || valor.length < 1) break;
      const vars = { ...state.vars, [node.variavel ?? node.id]: valor };
      if (node.variavel === 'nome') acc.nome = valor;
      return advance(node.proximo, { vars });
    }
    case 'arquivos': {
      if (input.hasFile && !text) {
        return {
          state: { ...state, arquivos: state.arquivos + 1, invalidos: 0 },
          replies: [MESSAGES.aguardar_ok_continuar],
          effects: [],
          saiu: null,
        };
      }
      if (OK_RE.test(text) && state.arquivos >= (node.minimo ?? 0))
        return advance(node.proximo, {});
      break;
    }
  }

  // Pedido explícito de falar com uma pessoa (só quando o texto não serviu como resposta).
  if (
    /\b(atendente|humano|pessoa de verdade|falar com algu[eé]m)\b/i.test(text)
  ) {
    acc.effects.push({ type: 'handoff', comNome: !!state.vars.nome });
    return leave(acc, 'encaminhado');
  }

  // Resposta inválida: a 1ª avisa, as seguintes ficam em silêncio e, no limite, passa a um humano.
  const invalidos = state.invalidos + 1;
  const next: CustomState = { ...state, invalidos };
  if (invalidos >= opts.maxInvalid) {
    acc.effects.push({ type: 'handoff', comNome: !!state.vars.nome });
    return leave(acc, 'encaminhado');
  }
  return {
    state: next,
    replies:
      invalidos === 1
        ? [
            node.tipo === 'pergunta' && node.validacao === 'nome'
              ? MESSAGES.invalida_nome
              : node.tipo === 'arquivos'
                ? MESSAGES.invalida_arquivos
                : MESSAGES.invalida_generica,
          ]
        : [],
    effects: [],
    saiu: null,
    invalido: true,
  };
}

/** Texto de apresentação do bloco em que o cliente está (para retomar depois de responder uma dúvida). */
export function promptOf(flow: CustomFlow, state: CustomState): string | null {
  const node = byId(flow, state.nodeId);
  return node && WAITING.includes(node.tipo) ? prompt(node, state.vars) : null;
}

// ───────────────────────── validação (usada ao salvar rascunho) ─────────────────────────

const NODE_TYPES: NodeType[] = [
  'mensagem',
  'opcoes',
  'confirmacao',
  'pergunta',
  'arquivos',
  'acao',
  'encaminhar',
  'fim',
];

/** Devolve a lista de problemas do fluxo (vazia = válido). Não altera o fluxo. */
export function checkFlow(flow: CustomFlow): string[] {
  const e: string[] = [];
  const at = (n: FlowNode) => `Bloco “${n.titulo || n.id}”`;
  if (!flow.nos.length) return ['O fluxo precisa ter ao menos um bloco.'];
  if (flow.nos.length > 40) e.push('O fluxo aceita no máximo 40 blocos.');
  const ids = new Set(flow.nos.map((n) => n.id));
  if (ids.size !== flow.nos.length)
    e.push('Há blocos com identificador repetido.');
  const vars = new Set<string>(['nome']);
  for (const n of flow.nos)
    if (n.tipo === 'pergunta' && n.variavel) vars.add(n.variavel);
  const dest = (n: FlowNode, to: string | null | undefined, where: string) => {
    if (!to) e.push(`${at(n)}: escolha para onde o cliente vai ${where}.`);
    else if (!ids.has(to))
      e.push(`${at(n)}: o destino ${where} não existe mais.`);
  };

  for (const n of flow.nos) {
    if (!NODE_TYPES.includes(n.tipo)) {
      e.push(`${at(n)}: tipo desconhecido.`);
      continue;
    }
    if (!n.titulo?.trim()) e.push(`Um bloco está sem nome.`);
    const needsText = [
      'mensagem',
      'opcoes',
      'confirmacao',
      'pergunta',
      'arquivos',
    ].includes(n.tipo);
    const texto = (n.texto ?? '').trim();
    if (needsText && !texto) e.push(`${at(n)}: escreva o texto da mensagem.`);
    if (texto.length > 1000)
      e.push(`${at(n)}: o texto passa de 1000 caracteres.`);
    for (const m of texto.matchAll(/\{(\w+)\}/g))
      if (!vars.has(m[1]))
        e.push(
          `${at(n)}: {${m[1]}} não é uma variável deste fluxo (crie uma pergunta com esse nome).`,
        );
    if (
      n.tipo === 'mensagem' ||
      n.tipo === 'pergunta' ||
      n.tipo === 'arquivos' ||
      n.tipo === 'acao'
    )
      dest(n, n.proximo, 'depois deste bloco');
    if (n.tipo === 'opcoes' || n.tipo === 'confirmacao') {
      const o = n.opcoes ?? [];
      if (n.tipo === 'confirmacao' && o.length !== 2)
        e.push(`${at(n)}: a confirmação tem sempre duas opções (Sim e Não).`);
      else if (n.tipo === 'opcoes' && (o.length < 2 || o.length > 8))
        e.push(`${at(n)}: use de 2 a 8 opções.`);
      o.forEach((x, i) => {
        if (!x.rotulo?.trim() || x.rotulo.length > 60)
          e.push(
            `${at(n)}: a opção ${i + 1} precisa de um texto de até 60 caracteres.`,
          );
        dest(n, x.proximo, `na opção ${i + 1}`);
      });
    }
    if (
      (n.tipo === 'pergunta' ||
        n.tipo === 'opcoes' ||
        n.tipo === 'confirmacao') &&
      n.variavel !== undefined &&
      n.variavel !== '' &&
      !/^[a-z][a-z0-9_]{0,29}$/.test(n.variavel)
    )
      e.push(
        `${at(n)}: a variável deve começar com letra minúscula e usar só letras, números e _.`,
      );
    if (n.tipo === 'pergunta' && !n.variavel)
      e.push(
        `${at(n)}: dê um nome à variável que guarda a resposta (ex.: nome, bairro).`,
      );
    if (n.tipo === 'arquivos' && (n.minimo ?? 0) > 20)
      e.push(`${at(n)}: o mínimo de arquivos é 20.`);
    if (n.armazenar && n.armazenar !== 'drive')
      e.push(`${at(n)}: destino de armazenamento desconhecido.`);
    if (n.pasta && !['criar', 'existente'].includes(n.pasta))
      e.push(`${at(n)}: modo de pasta desconhecido.`);
    if (n.tipo === 'acao' && !TOOLS.some((t) => t.key === n.acao))
      e.push(`${at(n)}: escolha uma ferramenta.`);
  }

  const tools = flow.nos.filter((n) => n.tipo === 'acao').map((n) => n.acao);
  const usaDrive = flow.nos.some(
    (n) => n.tipo === 'arquivos' && n.armazenar === 'drive',
  );
  const hasPasta = tools.includes('drive_criar_pasta') || usaDrive;
  if (flow.nos.some((n) => n.tipo === 'arquivos') && !hasPasta)
    e.push(
      'Para guardar arquivos é preciso um bloco “Drive: criar a pasta do cliente” antes — ou marque “Guardar no Drive” na própria solicitação.',
    );
  if (tools.includes('drive_salvar_respostas') && !hasPasta)
    e.push(
      '“Drive: salvar as respostas” precisa de “Drive: criar a pasta do cliente”.',
    );
  if (
    hasPasta &&
    !flow.nos.some((n) => n.tipo === 'pergunta' && n.variavel === 'nome')
  )
    e.push(
      'Guardar no Drive precisa do nome do cliente: adicione uma pergunta com a variável “nome” antes.',
    );
  if (!flow.nos.some((n) => n.tipo === 'encaminhar' || n.tipo === 'fim'))
    e.push(
      'O fluxo precisa terminar em “Encaminhar a um atendente” ou “Encerrar”.',
    );

  // Ciclo só de blocos automáticos nunca espera o cliente: travaria a conversa.
  const auto = new Map(
    flow.nos
      .filter((n) => n.tipo === 'mensagem' || n.tipo === 'acao')
      .map((n) => [n.id, n.proximo]),
  );
  for (const start of auto.keys()) {
    const seen = new Set<string>();
    let cur: string | null | undefined = start;
    while (cur && auto.has(cur)) {
      if (seen.has(cur)) {
        e.push('Há um ciclo de blocos automáticos sem pergunta no meio.');
        return [...new Set(e)];
      }
      seen.add(cur);
      cur = auto.get(cur);
    }
  }
  return [...new Set(e)];
}

/**
 * Converte o resultado do motor de fluxo próprio numa Decision do motor principal
 * (usada pelo atendimento real e pelo simulador, para os dois se comportarem igual).
 */
export function customToDecision(
  r: CustomResult,
  flowId: string,
  nomeAtual: string | null,
): Decision {
  const effects: Effect[] = r.effects.map((e) =>
    e.type === 'handoff'
      ? {
          type: 'handoff',
          mensagem: e.comNome ? 'redirecionando_com_nome' : 'redirecionando',
          texto: e.texto,
          flowId,
        }
      : e,
  );
  const nome = r.nome ? { nome: r.nome } : {};
  if (r.state)
    return {
      patch: { step: 'CUSTOM', custom: r.state, invalidCount: 0, ...nome },
      replies: r.replies,
      effects,
      flowId,
    };
  if (r.saiu === 'encaminhado')
    return {
      patch: { custom: null, ...nome },
      replies: r.replies,
      effects,
      flowId,
    };
  // Voltou ao menu. Se houve ações (ex.: criar pasta), o nome precisa sobreviver até elas rodarem.
  const d = restartDecision();
  return {
    patch: {
      ...d.patch,
      ...(effects.length ? { nome: r.nome ?? nomeAtual ?? null } : {}),
    },
    replies: [...r.replies, ...d.replies],
    effects,
    flowId,
  };
}
