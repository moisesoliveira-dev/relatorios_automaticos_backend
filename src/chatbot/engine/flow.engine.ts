import {
  Effect,
  FlowDoc,
  FlowInput,
  FlowNode,
  FlowResult,
  FlowState,
  Reply,
  SystemMessages,
  isWaiting,
} from './flow.types';
import type { ToolResult } from './tool.types';
import {
  OK_RE,
  normalizeText,
  parseNumberList,
  render,
  slug,
  validarResposta,
} from './text';
import { prefilter } from '../domain/scope.prefilter';

/**
 * Motor de fluxos. Função PURA: recebe os fluxos publicados, o estado da conversa e uma entrada já
 * interpretada e devolve o novo estado, os textos a enviar e os efeitos externos a executar.
 * A IA nunca decide transições: ela só traduz o que o cliente escreveu para um FlowInput.
 *
 * Ferramentas são assíncronas e ficam fora daqui: o motor PARA na etapa de ferramenta devolvendo
 * um efeito; quem chama executa a ferramenta e continua com `resumeTool`.
 */

export interface Published {
  fluxos: FlowDoc[];
  sistema: SystemMessages;
}

export interface EngineOptions {
  maxInvalid: number;
  /** Desvios seguidos numa etapa antes de passar a um atendente (padrão: MAX_DESVIOS). */
  maxDesvios?: number;
}

const MAX_STEPS = 40;

export const flowById = (
  p: Published,
  id: string | null | undefined,
): FlowDoc | undefined => p.fluxos.find((f) => f.id === id);
export const entryFlow = (p: Published): FlowDoc | undefined =>
  p.fluxos.find((f) => f.ativo && f.papel === 'entrada');
export const recognitionFlow = (p: Published): FlowDoc | undefined =>
  p.fluxos.find((f) => f.ativo && f.papel === 'reconhecimento');
export const nodeById = (
  flow: FlowDoc,
  id: string | null | undefined,
): FlowNode | undefined => flow.nos.find((n) => n.id === id);

export function currentNode(
  p: Published,
  state: FlowState | null | undefined,
): FlowNode | undefined {
  if (!state) return undefined;
  const flow = flowById(p, state.flowId);
  return flow ? nodeById(flow, state.nodeId) : undefined;
}

// ───────────────────────── apresentação das etapas ─────────────────────────

const numbered = (rotulos: string[]) =>
  rotulos.map((r, i) => `*${i + 1}* - ${r}`).join('\n');

function footer(p: Published, flow: FlowDoc, state: FlowState): string {
  const first = !state.historico.length;
  if (first && flow.papel === 'entrada') return '';
  return p.sistema.rodape_navegacao;
}

const join = (...parts: Array<string | undefined>) =>
  parts.filter((x) => x && x.trim()).join('\n\n');

/** Texto completo que apresenta uma etapa de espera (pergunta + opções + rodapé). */
export function prompt(
  p: Published,
  flow: FlowDoc,
  node: FlowNode,
  state: FlowState,
): string {
  const vars = state.vars;
  const foot = footer(p, flow, state);
  switch (node.tipo) {
    case 'opcoes':
    case 'confirmacao':
      return join(
        render(node.texto, vars),
        numbered(node.opcoes.map((o) => o.rotulo)),
        foot,
        p.sistema.rodape_escolha,
      );
    case 'multipla': {
      const rotulos = node.itens.map((i) => i.rotulo);
      if (node.nenhum) rotulos.push(node.nenhum);
      return join(
        render(node.texto, vars),
        numbered(rotulos),
        foot,
        p.sistema.rodape_escolha,
      );
    }
    case 'arquivos':
      return join(render(node.texto, vars), p.sistema.rodape_ok, foot);
    case 'pergunta':
      return join(render(node.texto, vars), foot);
    case 'ferramenta': {
      const texto =
        typeof node.params?.['texto'] === 'string' ? node.params['texto'] : '';
      const lista = (state.dinamicas ?? []).map((o) => o.rotulo);
      return join(
        render(texto, vars),
        numbered(lista),
        foot,
        p.sistema.rodape_escolha,
      );
    }
    default:
      return render((node as { texto?: string }).texto ?? '', vars);
  }
}

/** A etapa em partes: o que perguntar e quais caminhos existem (sem numeração nem rodapé). */
function formaDe(node: FlowNode, state: FlowState): Reply['forma'] {
  const vars = state.vars;
  switch (node.tipo) {
    case 'opcoes':
    case 'confirmacao':
      return {
        tipo: node.tipo,
        corpo: render(node.texto, vars),
        opcoes: node.opcoes.map((o) => o.rotulo),
      };
    case 'multipla':
      return {
        tipo: node.tipo,
        corpo: render(node.texto, vars),
        opcoes: [
          ...node.itens.map((i) => i.rotulo),
          ...(node.nenhum ? [node.nenhum] : []),
        ],
      };
    case 'arquivos':
    case 'pergunta':
      return { tipo: node.tipo, corpo: render(node.texto, vars), opcoes: [] };
    case 'ferramenta':
      return {
        tipo: node.tipo,
        corpo:
          typeof node.params?.['texto'] === 'string'
            ? render(node.params['texto'], vars)
            : '',
        opcoes: (state.dinamicas ?? []).map((o) => o.rotulo),
      };
    default:
      return undefined;
  }
}

/** Reapresenta a etapa atual (depois de responder uma dúvida, por exemplo). */
export function promptOf(p: Published, state: FlowState): Reply | null {
  const flow = flowById(p, state.flowId);
  const node = flow ? nodeById(flow, state.nodeId) : undefined;
  if (!flow || !node) return null;
  if (!isWaiting(node) && !(node.tipo === 'ferramenta' && state.dinamicas))
    return null;
  return {
    texto: prompt(p, flow, node, state),
    nodeId: node.id,
    spec: renderSpec(node.spec, state.vars),
    retomada: true,
    forma: formaDe(node, state),
    textoOriginal: (node as { texto?: string }).texto,
  };
}

// ───────────────────────── execução ─────────────────────────

interface Acc {
  replies: Reply[];
  effects: Effect[];
  nome?: string;
}

/** Instrução da IA também aceita {variaveis}. */
const renderSpec = (
  spec: FlowNode['spec'],
  vars: Record<string, string>,
): FlowNode['spec'] =>
  spec?.objetivo ? { ...spec, objetivo: render(spec.objetivo, vars) } : spec;

/** Desvios seguidos numa etapa antes de passar a um atendente. */
export const MAX_DESVIOS = 4;

const leave = (
  acc: Acc,
  saiu: 'menu' | 'encaminhado',
  flowId: string,
): FlowResult => ({
  state: null,
  replies: acc.replies,
  effects: acc.effects,
  nome: acc.nome,
  saiu,
  flowId,
});

const stay = (
  state: FlowState,
  acc: Acc,
  extra: Partial<FlowResult> = {},
): FlowResult => ({
  state,
  replies: acc.replies,
  effects: acc.effects,
  nome: acc.nome,
  saiu: null,
  flowId: state.flowId,
  ...extra,
});

function renderParams(
  params: Record<string, string | number | boolean | null> | undefined,
  vars: Record<string, string>,
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(params ?? {}))
    out[k] = typeof v === 'string' ? render(v, vars) : v;
  return out;
}

function evalCond(
  op: string,
  atual: string | undefined,
  valor: string | undefined,
): boolean {
  const a = slug(atual ?? '');
  const b = slug(valor ?? '');
  switch (op) {
    case 'igual':
      return a === b;
    case 'diferente':
      return a !== b;
    case 'contem':
      return !!b && a.includes(b);
    case 'vazio':
      return !a;
    case 'nao_vazio':
      return !!a;
    default:
      return false;
  }
}

/** Começa um fluxo e roda as etapas automáticas até a primeira que espera o cliente (ou uma ferramenta). */
export function startFlow(
  p: Published,
  flowId: string,
  vars: Record<string, string> = {},
): FlowResult {
  const flow = flowById(p, flowId);
  const acc: Acc = { replies: [], effects: [] };
  if (!flow?.nos.length) return leave(acc, 'menu', flowId);
  const state: FlowState = {
    flowId: flow.id,
    nodeId: flow.nos[0].id,
    historico: [],
    vars: { ...vars },
    arquivos: 0,
    invalidos: 0,
  };
  return enter(p, flow, state, state.nodeId, acc);
}

function enter(
  p: Published,
  flowIn: FlowDoc,
  stateIn: FlowState,
  startId: string | null | undefined,
  acc: Acc,
): FlowResult {
  let flow = flowIn;
  let state = stateIn;
  let id: string | null | undefined = startId;
  for (let i = 0; i < MAX_STEPS; i++) {
    const node = nodeById(flow, id);
    if (!node) return leave(acc, 'menu', flow.id); // referência quebrada: volta ao início com segurança
    switch (node.tipo) {
      case 'mensagem':
        acc.replies.push({
          texto: render(node.texto, state.vars),
          nodeId: node.id,
          textoOriginal: node.texto,
          spec: renderSpec(node.spec, state.vars),
        });
        id = node.proximo;
        break;
      case 'condicao': {
        const hit = node.regras.find((r) =>
          evalCond(r.op, state.vars[r.variavel], r.valor),
        );
        id = hit ? hit.proximo : node.senao;
        break;
      }
      case 'ir_para': {
        const alvo = flowById(p, node.fluxo);
        if (!alvo?.ativo || !alvo.nos.length)
          return leave(acc, 'menu', flow.id);
        flow = alvo;
        state = {
          ...state,
          flowId: alvo.id,
          historico: [],
          dinamicas: null,
          escolhidos: null,
        };
        id = alvo.nos[0].id;
        break;
      }
      case 'ferramenta':
        acc.effects.push({
          type: 'ferramenta',
          nodeId: node.id,
          ferramenta: node.ferramenta,
          params: renderParams(node.params, state.vars),
        });
        return stay(
          {
            ...state,
            nodeId: node.id,
            invalidos: 0,
            dinamicas: null,
            escolhidos: null,
          },
          acc,
        );
      case 'encaminhar': {
        const texto = node.texto ? render(node.texto, state.vars).trim() : '';
        if (texto)
          acc.replies.push({
            texto,
            nodeId: node.id,
            textoOriginal: node.texto,
            spec: renderSpec(node.spec, state.vars),
          });
        acc.effects.push({
          type: 'handoff',
          comNome: !!state.vars['nome'],
          reutilizar: node.reutilizarAtendente,
          jaAvisou: !!texto,
          vars: state.vars,
        });
        return leave(acc, 'encaminhado', flow.id);
      }
      case 'fim':
        if (node.texto)
          acc.replies.push({
            texto: render(node.texto, state.vars),
            nodeId: node.id,
            textoOriginal: node.texto,
            spec: renderSpec(node.spec, state.vars),
          });
        return leave(acc, 'menu', flow.id);
      default: {
        // opcoes | confirmacao | pergunta | multipla | arquivos: espera o cliente
        const next: FlowState = {
          ...state,
          nodeId: node.id,
          invalidos: 0,
          dinamicas: null,
          escolhidos: null,
        };
        acc.replies.push({
          texto: prompt(p, flow, node, next),
          nodeId: node.id,
          spec: renderSpec(node.spec, state.vars),
          forma: formaDe(node, next),
          textoOriginal: (node as { texto?: string }).texto,
        });
        return stay(next, acc);
      }
    }
  }
  return leave(acc, 'menu', flow.id);
}

/** Continua depois que a ferramenta da etapa atual rodou. */
export function resumeTool(
  p: Published,
  state: FlowState,
  result: ToolResult,
): FlowResult {
  const flow = flowById(p, state.flowId);
  const node = flow ? nodeById(flow, state.nodeId) : undefined;
  const acc: Acc = { replies: [], effects: [] };
  if (!flow || !node || node.tipo !== 'ferramenta')
    return leave(acc, 'menu', state.flowId);

  for (const t of result.replies ?? [])
    acc.replies.push({ texto: t, nodeId: node.id });

  if (!result.ok) return enter(p, flow, state, node.falha ?? node.proximo, acc);

  const vars = { ...state.vars, ...(result.vars ?? {}) };
  if (node.variavel && result.valor !== undefined)
    vars[node.variavel] = result.valor;
  const next: FlowState = { ...state, vars };

  if (result.opcoes) {
    if (!result.opcoes.length)
      return enter(
        p,
        flow,
        next,
        node.semOpcoes ?? node.falha ?? node.proximo,
        acc,
      );
    const waiting: FlowState = {
      ...next,
      dinamicas: result.opcoes.slice(0, 9),
      invalidos: 0,
    };
    acc.replies.push({
      texto: prompt(p, flow, node, waiting),
      nodeId: node.id,
      spec: renderSpec(node.spec, state.vars),
      forma: formaDe(node, waiting),
    });
    return stay(waiting, acc);
  }
  return enter(p, flow, next, node.proximo, acc);
}

const invalidKey = (node: FlowNode) =>
  node.tipo === 'pergunta' &&
  (node.validacao === 'nome' || node.variavel === 'nome')
    ? 'invalida_nome'
    : node.tipo === 'arquivos'
      ? 'invalida_arquivos'
      : node.tipo === 'multipla'
        ? 'invalida_lista'
        : 'invalida_generica';

/** Processa uma entrada do cliente na etapa de espera atual. */
export function stepFlow(
  p: Published,
  state: FlowState,
  input: FlowInput,
  opts: EngineOptions,
): FlowResult {
  const flow = flowById(p, state.flowId);
  const node = flow ? nodeById(flow, state.nodeId) : undefined;
  const acc: Acc = { replies: [], effects: [] };
  if (!flow || !node) return leave(acc, 'menu', state.flowId);
  const waitingTool = node.tipo === 'ferramenta' && !!state.dinamicas?.length;
  if (!isWaiting(node) && !waitingTool) return leave(acc, 'menu', flow.id);

  if (input.kind === 'recomecar') return leave(acc, 'menu', flow.id);
  if (input.kind === 'voltar') {
    const prev = state.historico[state.historico.length - 1];
    if (!prev) return leave(acc, 'menu', flow.id);
    return enter(
      p,
      flow,
      { ...state, historico: state.historico.slice(0, -1) },
      prev,
      acc,
    );
  }
  if (input.kind === 'humano') {
    acc.effects.push({
      type: 'handoff',
      comNome: !!state.vars['nome'],
      vars: state.vars,
    });
    return leave(acc, 'encaminhado', flow.id);
  }
  if (input.kind === 'duvida') {
    acc.replies.push({ texto: input.resposta });
    const back = promptOf(p, state);
    if (back) acc.replies.push(back);
    return stay({ ...state, invalidos: 0 }, acc);
  }
  if (input.kind === 'fora_escopo') return stay(state, acc); // quem avisa é o serviço (conta as advertências)

  // Correção de um dado já informado: atualiza, confirma e segue na mesma etapa.
  if (input.kind === 'corrigir') {
    const valor = validarResposta('nome', input.valor);
    if (valor && state.vars[input.variavel]) {
      acc.nome = valor;
      acc.replies.push({
        texto: render(p.sistema.dado_corrigido, { nome: valor }),
        sistema: 'dado_corrigido',
      });
      const novo = {
        ...state,
        vars: { ...state.vars, [input.variavel]: valor },
        invalidos: 0,
      };
      const back = promptOf(p, novo);
      if (back) acc.replies.push(back);
      return stay(novo, acc);
    }
  }

  // Desvio: acolhe, responde o que der e traz o cliente de volta à etapa. Só depois de insistir muito
  // (sem avançar) é que passa a um atendente, para ninguém ficar preso numa conversa circular.
  if (input.kind === 'duvida_sem_resposta' || input.kind === 'reapresentar') {
    const desvios = (state.desvios ?? 0) + 1;
    if (desvios >= (opts.maxDesvios ?? MAX_DESVIOS)) {
      acc.effects.push({
        type: 'handoff',
        comNome: !!state.vars['nome'],
        vars: state.vars,
      });
      return leave(acc, 'encaminhado', flow.id);
    }
    const key =
      input.kind === 'duvida_sem_resposta'
        ? 'duvida_sem_resposta'
        : input.motivo === 'esclarecer'
          ? 'esclarecer_etapa'
          : 'retomar_conversa';
    acc.replies.push({ texto: p.sistema[key], sistema: key });
    const back = promptOf(p, state);
    if (back) acc.replies.push(back);
    return stay({ ...state, desvios, invalidos: 0 }, acc);
  }

  const advance = (
    next: string | null | undefined,
    patch: Partial<FlowState>,
  ): FlowResult =>
    enter(
      p,
      flow,
      {
        ...state,
        ...patch,
        historico: [...state.historico, node.id],
        invalidos: 0,
        desvios: 0,
        dinamicas: null,
        escolhidos: null,
      },
      next ?? '',
      acc,
    );

  switch (node.tipo) {
    case 'opcoes':
    case 'confirmacao': {
      const escolhida =
        input.kind === 'opcao'
          ? node.opcoes[input.index - 1]
          : input.kind === 'valor'
            ? matchOption(node.opcoes, input.valor)
            : undefined;
      if (!escolhida) break;
      const vars = node.variavel
        ? {
            ...state.vars,
            [node.variavel]: escolhida.valor ?? escolhida.rotulo,
          }
        : { ...state.vars };
      if (input.kind === 'opcao' && input.nomeCitado && !vars['nome']) {
        vars['nome'] = input.nomeCitado;
        acc.nome = input.nomeCitado;
      }
      return advance(escolhida.proximo, { vars });
    }
    case 'ferramenta': {
      // ferramenta de escolha: o cliente escolheu uma das opções dinâmicas
      const lista = state.dinamicas ?? [];
      const escolhida =
        input.kind === 'opcao'
          ? lista[input.index - 1]
          : input.kind === 'valor'
            ? lista.find((o) => slug(o.rotulo) === slug(input.valor))
            : undefined;
      if (!escolhida) break;
      const vars = node.variavel
        ? {
            ...state.vars,
            [node.variavel]: escolhida.valor,
            [`${node.variavel}_rotulo`]: escolhida.rotulo,
          }
        : state.vars;
      return advance(node.proximo, { vars });
    }
    case 'pergunta': {
      if (input.kind !== 'valor') break;
      const validacao =
        node.validacao ?? (node.variavel === 'nome' ? 'nome' : 'texto');
      const valor = validarResposta(validacao, input.valor);
      if (!valor) break;
      if (node.variavel === 'nome') acc.nome = valor;
      return advance(node.proximo, {
        vars: { ...state.vars, [node.variavel]: valor },
      });
    }
    case 'multipla': {
      const total = node.itens.length;
      const nenhumIdx = node.nenhum ? total + 1 : -1;
      const finalizar = (indices: number[]) => {
        const rotulos = indices.map((i) => node.itens[i - 1].rotulo);
        return advance(node.proximo, {
          vars: {
            ...state.vars,
            [node.variavel]: rotulos.join(', '),
            [`${node.variavel}_ids`]: indices.join(' '),
          },
        });
      };
      if (input.kind === 'opcao' && input.index === nenhumIdx)
        return finalizar([]);
      if (input.kind === 'ok') {
        const atuais = state.escolhidos ?? [];
        if (!atuais.length) break;
        return finalizar(atuais);
      }
      const indices =
        input.kind === 'itens'
          ? input.indices
          : input.kind === 'opcao'
            ? [input.index]
            : null;
      if (!indices) break;
      const validos = [...new Set(indices)].filter((i) => i >= 1 && i <= total);
      if (!validos.length) break;
      const escolhidos = [
        ...new Set([...(state.escolhidos ?? []), ...validos]),
      ];
      acc.replies.push({
        texto: node.textoApos?.trim()
          ? render(node.textoApos, state.vars)
          : p.sistema.rodape_ok,
        nodeId: node.id,
        aviso: 'itens',
      });
      return stay({ ...state, escolhidos, invalidos: 0 }, acc);
    }
    case 'arquivos': {
      if (input.kind === 'arquivo') {
        acc.replies.push({
          texto: node.textoApos?.trim()
            ? render(node.textoApos, state.vars)
            : p.sistema.rodape_ok,
          nodeId: node.id,
          aviso: 'arquivo',
        });
        return stay(
          { ...state, arquivos: state.arquivos + 1, invalidos: 0 },
          acc,
        );
      }
      if (input.kind === 'ok' && state.arquivos >= (node.minimo ?? 0))
        return advance(node.proximo, {});
      break;
    }
  }

  // Resposta inválida: avisa sempre e, no limite, passa a um humano.
  const invalidos = state.invalidos + 1;
  if (invalidos >= opts.maxInvalid) {
    acc.effects.push({
      type: 'handoff',
      comNome: !!state.vars['nome'],
      vars: state.vars,
    });
    return leave(acc, 'encaminhado', flow.id);
  }
  const key = invalidKey(node);
  acc.replies.push({ texto: p.sistema[key], sistema: key });
  if (invalidos > 1) {
    // Da 2ª vez em diante repete a pergunta: o cliente nunca fica sem saber o que fazer.
    const back = promptOf(p, { ...state, invalidos });
    if (back) acc.replies.push(back);
  }
  return stay({ ...state, invalidos }, acc, { invalido: true });
}

/** A etapa já tem resposta? Uma pessoa não pergunta de novo o nome que acabou de ouvir. */
function respostaConhecida(node: FlowNode, state: FlowState): FlowInput | null {
  const nome = state.vars['nome'];
  if (!nome) return null;
  if (
    node.tipo === 'pergunta' &&
    (node.variavel === 'nome' || node.validacao === 'nome')
  )
    return { kind: 'valor', valor: nome };
  if (
    node.tipo === 'confirmacao' &&
    node.texto.includes('{nome}') &&
    slug(node.opcoes[0].rotulo).startsWith('sim')
  )
    return { kind: 'opcao', index: 1 };
  return null;
}

/**
 * Modo atendente: pula as etapas cuja resposta já é conhecida (pedir e confirmar o nome). Essas
 * etapas saem do histórico, para que "voltar" não caia nelas e pule de volta para onde estava.
 */
export function pularRespondidas(
  p: Published,
  result: FlowResult,
  opts: EngineOptions,
): FlowResult {
  let r = result;
  for (let i = 0; i < 6; i++) {
    if (!r.state || r.effects.length) return r;
    const node = currentNode(p, r.state);
    const input = node && respostaConhecida(node, r.state);
    if (!node || !input) return r;
    const prox = stepFlow(p, r.state, input, opts);
    r = {
      ...prox,
      replies: [
        ...r.replies.filter((x) => x.nodeId !== node.id),
        ...prox.replies,
      ],
      nome: prox.nome ?? r.nome,
      state: prox.state && {
        ...prox.state,
        historico: prox.state.historico.filter((h) => h !== node.id),
      },
    };
  }
  return r;
}

/** Casa um texto com uma opção pelo rótulo ou pelas palavras-chave (sem IA). */
export function matchOption<T extends { rotulo: string; palavras?: string[] }>(
  opcoes: T[],
  text: string,
): T | undefined {
  const t = slug(text);
  if (!t) return undefined;
  return opcoes.find(
    (o) =>
      slug(o.rotulo) === t || (o.palavras ?? []).some((pal) => slug(pal) === t),
  );
}

/**
 * Interpretação SEM IA do que o cliente escreveu, na etapa atual.
 * Devolve null quando é texto livre e precisa da IA (ou vira "inválido" se ela não estiver disponível).
 */
export function parseText(
  p: Published,
  state: FlowState,
  rawText: string,
  hasFile: boolean,
): FlowInput | null {
  const node = currentNode(p, state);
  const text = normalizeText(rawText);
  if (hasFile && !text) return { kind: 'arquivo' };
  if (!text) return { kind: 'invalido' };
  if (text === '10') return { kind: 'recomecar' };
  if (text === '0') return { kind: 'voltar' };
  if (!node) return { kind: 'invalido' };
  const pedeHumano =
    /\b(atendente|humano|pessoa de verdade|falar com algu[eé]m)\b/i.test(text);
  // Manipulação citando "atendente" não é pedido de atendimento: segue para o pré-filtro.
  if (pedeHumano && node.tipo !== 'pergunta' && !prefilter(text).blocked)
    return { kind: 'humano' };

  const single = /^(\d{1,2})[.)]?$/.exec(text);
  switch (node.tipo) {
    case 'opcoes':
    case 'confirmacao':
      if (single) return { kind: 'opcao', index: Number(single[1]) };
      return matchOption(node.opcoes, text)
        ? { kind: 'valor', valor: text }
        : null;
    case 'ferramenta':
      if (single) return { kind: 'opcao', index: Number(single[1]) };
      return null;
    case 'multipla': {
      if (OK_RE.test(text)) return { kind: 'ok' };
      const list = parseNumberList(text);
      if (!list) return null;
      if (list.length === 1 && node.nenhum && list[0] === node.itens.length + 1)
        return { kind: 'opcao', index: list[0] };
      return { kind: 'itens', indices: list };
    }
    case 'arquivos':
      if (OK_RE.test(text)) return { kind: 'ok' };
      return hasFile ? { kind: 'arquivo' } : null;
    case 'pergunta': {
      const validacao =
        node.validacao ?? (node.variavel === 'nome' ? 'nome' : 'texto');
      if (validacao !== 'texto' && !validarResposta(validacao, text))
        return pedeHumano ? { kind: 'humano' } : null;
      if (validacao === 'texto' && pedeHumano) return { kind: 'humano' };
      return { kind: 'valor', valor: text };
    }
    default:
      return { kind: 'invalido' };
  }
}

/** Opções numéricas válidas na etapa atual (para o intérprete e para validar a saída da IA). */
export function validOptions(p: Published, state: FlowState): number[] {
  const node = currentNode(p, state);
  if (!node) return [];
  switch (node.tipo) {
    case 'opcoes':
    case 'confirmacao':
      return node.opcoes.map((_, i) => i + 1);
    case 'ferramenta':
      return (state.dinamicas ?? []).map((_, i) => i + 1);
    case 'multipla':
      return [
        ...node.itens.map((_, i) => i + 1),
        ...(node.nenhum ? [node.itens.length + 1] : []),
      ];
    default:
      return [];
  }
}
