import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
import { AgentOrchestrator } from '../agents/agent-orchestrator.service';
import {
  fluxoPorId,
  guidanceOf,
  runtimeContent,
  sistema,
} from '../domain/content-runtime';
import { KNOWLEDGE_BASE } from '../domain/knowledge-base';
import {
  currentNode,
  entryFlow,
  parseText,
  promptOf,
  resumeTool,
  startFlow,
  stepFlow,
  validOptions,
} from '../engine/flow.engine';
import {
  Effect,
  FlowInput,
  FlowNode,
  FlowResult,
  FlowState,
  Reply,
} from '../engine/flow.types';
import { ChatbotConversation } from '../entities/chatbot-conversation.entity';
import { ChatbotHumanizerService } from './chatbot-humanizer.service';
import { ChatbotService } from './chatbot.service';
import { ToolRegistry } from '../tools/tool.registry';
import { NODE_TYPES_INFO } from './chatbot-content.service';

const MANAUS_MS = 4 * 3600_000;
/** Início do dia em Manaus, como instante UTC. */
const startOfDayManaus = (daysAgo = 0) => {
  const local = new Date(Date.now() - MANAUS_MS);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() + MANAUS_MS - daysAgo * 86_400_000);
};

/** Mostra só o começo e o fim do número: o painel é de operação, não precisa expor o contato inteiro. */
const maskPhone = (n: string | null) =>
  n && n.length > 6 ? `${n.slice(0, 4)}•••••${n.slice(-3)}` : n;

export interface SimulateInput {
  texto?: string;
  estado?: Record<string, unknown> | null;
  /** Só no começo: entrar direto num fluxo publicado (padrão: o fluxo de início). */
  inicio?: { fluxoId?: string; nome?: string | null };
  usarIA?: boolean;
}

/** Estado da conversa simulada (vai e volta do navegador). */
export interface SimState {
  flow: FlowState | null;
  nome: string | null;
  humano: boolean;
  offTopic: number;
}

const asInt = (v: unknown, max = 1000) =>
  Number.isInteger(v) ? Math.min(Math.max(v as number, 0), max) : 0;
const asStr = (v: unknown, max: number) =>
  typeof v === 'string' ? v.slice(0, max) : null;

@Injectable()
export class ChatbotAdminService {
  constructor(
    @InjectRepository(ChatbotConversation)
    private readonly repo: Repository<ChatbotConversation>,
    private readonly appConfig: AppConfigService,
    private readonly agents: AgentOrchestrator,
    private readonly chatbot: ChatbotService,
    private readonly humanizer: ChatbotHumanizerService,
    private readonly tools: ToolRegistry,
  ) {}

  // ───────────────────────── visão geral ─────────────────────────

  async overview() {
    const today = startOfDayManaus();
    const week = startOfDayManaus(6);
    const [total, novosHoje, novos7d, entreguesHoje, emHumano, comErro] =
      await Promise.all([
        this.repo.count(),
        this.repo
          .createQueryBuilder('c')
          .where('c.created_at >= :d', { d: today })
          .getCount(),
        this.repo
          .createQueryBuilder('c')
          .where('c.created_at >= :d', { d: week })
          .getCount(),
        this.repo
          .createQueryBuilder('c')
          .where('c.finalizou_triagem = true AND c.updated_at >= :d', {
            d: today,
          })
          .getCount(),
        this.repo.count({ where: { step: 'HUMANO' } }),
        this.repo.count({ where: { handoffError: Not(IsNull()) } }),
      ]);

    // Funil: em que fluxo/etapa cada conversa ativa está
    const ativas = await this.repo
      .createQueryBuilder('c')
      .select(['c.flow', 'c.step'])
      .where("c.step = 'BOT'")
      .getMany();
    const funil: Record<string, number> = {};
    for (const c of ativas) {
      const f = c.flow ? fluxoPorId(c.flow.flowId) : undefined;
      const n =
        c.flow && f ? f.nos.find((x) => x.id === c.flow!.nodeId) : undefined;
      const key = f ? `${f.nome} › ${n?.titulo ?? '?'}` : 'Início';
      funil[key] = (funil[key] ?? 0) + 1;
    }
    funil['Com atendente'] = emHumano;

    const byTrilha: Array<{ trilha: string | null; total: string }> =
      await this.repo
        .createQueryBuilder('c')
        .select('c.trilha', 'trilha')
        .addSelect('COUNT(*)', 'total')
        .groupBy('c.trilha')
        .getRawMany();
    const sums = await this.repo
      .createQueryBuilder('c')
      .select(
        'COALESCE(SUM(c.off_topic_count) FILTER (WHERE c.updated_at >= :w), 0)',
        'foraEscopo7d',
      )
      .addSelect(
        'COALESCE(SUM(c.ai_calls_day) FILTER (WHERE c.ai_calls_date = :t), 0)',
        'iaHoje',
      )
      .setParameters({
        w: week,
        t: new Date(Date.now() - MANAUS_MS).toISOString().slice(0, 10),
      })
      .getRawOne();

    const serieRaw: Array<{ d: string; n: string }> = await this.repo.query(
      `SELECT to_char((created_at AT TIME ZONE 'UTC') - interval '4 hours', 'YYYY-MM-DD') AS d, COUNT(*)::int AS n
         FROM chatbot_conversations WHERE created_at >= $1 GROUP BY 1`,
      [startOfDayManaus(13)],
    );
    const map = new Map(serieRaw.map((r) => [r.d, Number(r.n)]));
    const serie = Array.from({ length: 14 }, (_, i) => {
      const day = new Date(startOfDayManaus(13 - i).getTime() - MANAUS_MS);
      const key = day.toISOString().slice(0, 10);
      return { dia: key, total: map.get(key) ?? 0 };
    });

    const trilhas: Record<string, number> = {};
    for (const r of byTrilha) {
      const label = this.trilhaLabel(r.trilha);
      trilhas[label] = (trilhas[label] ?? 0) + Number(r.total);
    }

    return {
      totais: { total, novosHoje, novos7d, entreguesHoje, emHumano, comErro },
      funil,
      trilhas,
      iaHoje: Number(sums?.iaHoje ?? 0),
      foraEscopo7d: Number(sums?.foraEscopo7d ?? 0),
      serie,
      sistema: await this.chatbot.stats(),
    };
  }

  /** Nome legível do caminho escolhido no menu (valor da opção → rótulo). */
  private trilhaLabel(trilha: string | null): string {
    if (!trilha) return 'Ainda no início';
    const entry = entryFlow(runtimeContent.published);
    for (const n of entry?.nos ?? [])
      if (n.tipo === 'opcoes' && n.variavel === 'trilha') {
        const o = n.opcoes.find((x) => (x.valor ?? x.rotulo) === trilha);
        if (o)
          return o.rotulo
            .replace(/^\p{Extended_Pictographic}\s*/u, '')
            .replace(/\.$/, '');
      }
    return trilha;
  }

  // ───────────────────────── conversas ─────────────────────────

  async list(q: {
    step?: string;
    busca?: string;
    erros?: boolean;
    pagina?: number;
    tamanho?: number;
  }) {
    const size = Math.min(Math.max(q.tamanho ?? 20, 1), 50);
    const page = Math.max(q.pagina ?? 1, 1);
    const qb = this.repo.createQueryBuilder('c');
    if (q.step) {
      if (q.step !== 'BOT' && q.step !== 'HUMANO')
        throw new BadRequestException('Etapa inválida.');
      qb.andWhere('c.step = :step', { step: q.step });
    }
    if (q.erros) qb.andWhere('c.handoff_error IS NOT NULL');
    if (q.busca?.trim()) {
      const term = q.busca.trim().slice(0, 60);
      qb.andWhere(
        '(c.nome ILIKE :like OR c.contact_name ILIKE :like OR c.numero LIKE :like OR CAST(c.contact_id AS text) = :exact OR CAST(c.ticket_id AS text) = :exact)',
        { like: `%${term.replace(/[%_]/g, '')}%`, exact: term },
      );
    }
    const [rows, total] = await qb
      .orderBy('c.last_message_at', 'DESC')
      .skip((page - 1) * size)
      .take(size)
      .getManyAndCount();
    return {
      total,
      pagina: page,
      tamanho: size,
      itens: rows.map((c) => this.summary(c)),
    };
  }

  private onde(c: ChatbotConversation): {
    fluxo: string | null;
    etapa: string | null;
  } {
    if (c.step === 'HUMANO') return { fluxo: null, etapa: 'Com atendente' };
    const f = c.flow ? fluxoPorId(c.flow.flowId) : undefined;
    const n =
      c.flow && f ? f.nos.find((x) => x.id === c.flow!.nodeId) : undefined;
    return {
      fluxo: f?.nome ?? null,
      etapa: n?.titulo ?? (c.flow ? '?' : 'Início'),
    };
  }

  private summary(c: ChatbotConversation) {
    return {
      id: c.id,
      contactId: c.contactId,
      ticketId: c.ticketId,
      nome: c.nome ?? c.contactName,
      numero: maskPhone(c.numero),
      etapa: c.step,
      onde: this.onde(c),
      trilha: this.trilhaLabel(c.trilha),
      emAtendimento: c.emAtendimento,
      finalizouTriagem: c.finalizouTriagem,
      invalidas: c.invalidCount,
      foraEscopo: c.offTopicCount,
      iaHoje: c.aiCallsDay,
      atendenteId: c.atendenteId,
      erroEntrega: c.handoffError,
      ultimaMensagem: c.lastMessageAt,
      criadaEm: c.createdAt,
    };
  }

  async detail(id: string) {
    const c = await this.repo.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Conversa não encontrada.');
    const respostas = Object.entries(c.flow?.vars ?? {})
      .filter(([k]) => !k.endsWith('_ids') && !k.endsWith('_rotulo'))
      .map(([k, v]) => ({ variavel: k, valor: v }));
    return {
      ...this.summary(c),
      respostas,
      arquivos: c.arquivos,
      pastaDrive: !!c.driveFolderId,
      historico: c.history ?? [],
    };
  }

  /** Silencia o bot nesta conversa (um humano assume). */
  async silenciar(id: string) {
    const c = await this.repo.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Conversa não encontrada.');
    c.step = 'HUMANO';
    c.emAtendimento = true;
    c.flow = null;
    await this.repo.save(c);
    return this.summary(c);
  }

  /** Devolve a conversa ao bot: na próxima mensagem do cliente, recomeça pelo fluxo de início. */
  async devolverAoBot(id: string) {
    const c = await this.repo.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Conversa não encontrada.');
    c.step = 'BOT';
    c.flow = null;
    c.trilha = null;
    c.emAtendimento = false;
    c.finalizouTriagem = false;
    c.handoffError = null;
    c.driveFolderId = null;
    c.invalidCount = 0;
    c.lastMessageAt = new Date();
    await this.repo.save(c);
    return this.summary(c);
  }

  // ───────────────────────── simulador (sem efeitos) ─────────────────────────

  private sanitizeState(raw: Record<string, unknown>): SimState {
    const f = raw['flow'] as Record<string, unknown> | null;
    let flow: FlowState | null = null;
    if (f && typeof f['flowId'] === 'string') {
      if (!fluxoPorId(f['flowId']))
        throw new BadRequestException(
          'Este fluxo não está mais publicado: recomece o teste.',
        );
      const vars: Record<string, string> = {};
      for (const [k, v] of Object.entries((f['vars'] as object) ?? {}).slice(
        0,
        40,
      ))
        if (typeof v === 'string') vars[k.slice(0, 40)] = v.slice(0, 300);
      const din = Array.isArray(f['dinamicas'])
        ? (f['dinamicas'] as Array<Record<string, unknown>>).slice(0, 9)
        : null;
      flow = {
        flowId: f['flowId'],
        nodeId: asStr(f['nodeId'], 40) ?? '',
        historico: Array.isArray(f['historico'])
          ? f['historico'].filter((x) => typeof x === 'string').slice(-50)
          : [],
        vars,
        arquivos: asInt(f['arquivos']),
        invalidos: asInt(f['invalidos']),
        dinamicas: din
          ? din.map((o) => ({
              rotulo: (asStr(o['rotulo'], 80) ?? ''),
              valor: (asStr(o['valor'], 120) ?? ''),
            }))
          : null,
        escolhidos: Array.isArray(f['escolhidos'])
          ? f['escolhidos'].filter((x) => Number.isInteger(x)).slice(0, 20)
          : null,
      };
    }
    return {
      flow,
      nome: asStr(raw['nome'], 60),
      humano: raw['humano'] === true,
      offTopic: asInt(raw['offTopic']),
    };
  }

  /**
   * Um passo de uma conversa simulada, do jeito que o cliente viveria hoje (conteúdo PUBLICADO):
   * com IA, tom do fluxo e dúvidas pela base do fluxo. Ferramentas rodam em modo simulado.
   * Nada é enviado, gravado, criado no Drive nem encaminhado.
   */
  async converse(input: SimulateInput) {
    const usarIA = input.usarIA !== false;
    const texto = (input.texto ?? '').toString().slice(0, 600).trim();
    const p = runtimeContent.published;
    const efeitos: string[] = [];

    // Chegada do cliente (sem estado): mostra a primeira tela
    if (!input.estado) {
      const alvo = input.inicio?.fluxoId
        ? fluxoPorId(input.inicio.fluxoId)
        : entryFlow(p);
      if (!alvo)
        throw new BadRequestException(
          'Este fluxo não está publicado: publique-o para testá-lo aqui.',
        );
      const nome = asStr(input.inicio?.nome, 60);
      const r = this.runTools(
        startFlow(p, alvo.id, nome ? { nome } : {}),
        efeitos,
      );
      return this.resposta(
        { flow: r.state, nome: r.nome ?? nome, humano: false, offTopic: 0 },
        r,
        efeitos,
        'regras',
        usarIA,
      );
    }

    if (!texto)
      throw new BadRequestException('Digite uma mensagem para simular.');
    const sim = this.sanitizeState(input.estado);
    if (sim.humano)
      throw new BadRequestException(
        'A conversa já foi encaminhada: recomece o teste.',
      );
    if (!sim.flow || !currentNode(p, sim.flow)) {
      const entry = entryFlow(p);
      if (!entry)
        throw new BadRequestException('Nenhum fluxo de início publicado.');
      const r = this.runTools(
        startFlow(p, entry.id, sim.nome ? { nome: sim.nome } : {}),
        efeitos,
      );
      return this.resposta(
        { ...sim, flow: r.state },
        r,
        efeitos,
        'regras',
        usarIA,
      );
    }

    let origem: 'regras' | 'ia' | 'nenhuma' = 'regras';
    let entrada: FlowInput | null = parseText(p, sim.flow, texto, false);
    if (entrada === null) {
      if (usarIA && this.agents.available) {
        origem = 'ia';
        const node: FlowNode | null = currentNode(p, sim.flow) ?? null;
        const flow = fluxoPorId(sim.flow.flowId);
        entrada = await this.agents.resolve(
          {
            node,
            state: sim.flow,
            validOptions: validOptions(p, sim.flow),
            rotulos: this.rotulosDe(node, sim.flow),
            message: texto,
            history: [],
          },
          flow?.kb?.length ? flow.kb : KNOWLEDGE_BASE,
          guidanceOf(flow),
        );
      } else {
        origem = 'nenhuma';
        entrada = { kind: 'invalido' };
      }
    }

    if (entrada.kind === 'fora_escopo') {
      const max = this.appConfig.chatbot.maxOffTopic;
      const offTopic = sim.offTopic + (entrada.severidade === 'grave' ? 2 : 1);
      const replies: Reply[] =
        offTopic >= max
          ? [
              {
                texto: sistema().fora_escopo_limite,
                sistema: 'fora_escopo_limite',
              },
            ]
          : [
              { texto: sistema().fora_escopo, sistema: 'fora_escopo' },
              ...[promptOf(p, sim.flow)].filter((x): x is Reply => !!x),
            ];
      return this.resposta(
        { ...sim, offTopic },
        {
          state: sim.flow,
          replies,
          effects: [],
          saiu: null,
          flowId: sim.flow.flowId,
        },
        efeitos,
        origem,
        usarIA,
      );
    }

    const r = this.runTools(
      stepFlow(p, sim.flow, entrada, {
        maxInvalid: this.appConfig.chatbot.maxInvalid,
      }),
      efeitos,
    );
    return this.resposta(
      { ...sim, flow: r.state, nome: r.nome ?? sim.nome },
      r,
      efeitos,
      origem,
      usarIA,
    );
  }

  /** Executa as ferramentas em modo simulado até a próxima etapa de espera (ou saída). */
  private runTools(first: FlowResult, efeitos: string[]): FlowResult {
    let r = first;
    const p = runtimeContent.published;
    for (let guard = 0; guard < 12 && r.state; guard++) {
      const eff = r.effects.find(
        (e): e is Extract<Effect, { type: 'ferramenta' }> =>
          e.type === 'ferramenta',
      );
      if (!eff) break;
      const tool = this.tools.get(eff.ferramenta);
      efeitos.push(
        tool
          ? `Ferramenta: ${tool.label}`
          : `Ferramenta desconhecida: ${eff.ferramenta}`,
      );
      const flow = fluxoPorId(r.state.flowId);
      const result = tool
        ? tool.simular({
            conv: {
              contactId: -1,
              ticketId: -1,
              nome: r.state.vars['nome'] ?? null,
              numero: null,
              driveFolderId: null,
              crmLeadId: null,
            },
            state: r.state,
            params: eff.params,
            flowNome: flow?.nome ?? '',
            rotulos: {},
          })
        : { ok: false as const, motivo: 'desconhecida' };
      const next = resumeTool(p, r.state, result);
      r = {
        ...next,
        replies: [...r.replies, ...next.replies],
        nome: next.nome ?? r.nome,
      };
    }
    return r;
  }

  private rotulosDe(node: FlowNode | null, state: FlowState): string[] {
    if (!node) return [];
    if (node.tipo === 'opcoes' || node.tipo === 'confirmacao')
      return node.opcoes.map((o) => o.rotulo);
    if (node.tipo === 'multipla')
      return [
        ...node.itens.map((i) => i.rotulo),
        ...(node.nenhum ? [node.nenhum] : []),
      ];
    if (node.tipo === 'ferramenta')
      return (state.dinamicas ?? []).map((o) => o.rotulo);
    return [];
  }

  private async resposta(
    sim: SimState,
    r: FlowResult,
    efeitos: string[],
    origem: 'regras' | 'ia' | 'nenhuma',
    usarIA: boolean,
  ) {
    const p = runtimeContent.published;
    const hand = r.effects.find(
      (e): e is Extract<Effect, { type: 'handoff' }> => e.type === 'handoff',
    );
    let replies = r.replies;
    if (hand) {
      efeitos.push('Encaminhar a um atendente (rodízio)');
      if (!hand.jaAvisou) {
        const nome = r.nome ?? sim.nome;
        replies = [
          ...replies,
          nome
            ? {
                texto: sistema().redirecionando_com_nome.replace(
                  /\{nome\}/g,
                  nome,
                ),
                sistema: 'redirecionando_com_nome',
              }
            : { texto: sistema().redirecionando, sistema: 'redirecionando' },
        ];
      }
    }
    let state: SimState = { ...sim, humano: !!hand };
    // voltou ao início sem encaminhar: mostra o menu de novo (como no atendimento real)
    if (!r.state && !hand) {
      const entry = entryFlow(p);
      if (entry) {
        const again = this.runTools(
          startFlow(p, entry.id, state.nome ? { nome: state.nome } : {}),
          efeitos,
        );
        replies = [...replies, ...again.replies];
        state = { ...state, flow: again.state };
      }
    }

    let mensagens = replies.map((x) => x.texto);
    let reescrita = false;
    if (usarIA && this.humanizer.enabled && replies.length) {
      mensagens = await this.humanizer.compose(
        { contactId: -1, nome: state.nome, history: [] },
        replies,
        r.flowId,
      );
      reescrita =
        mensagens.join('\n') !== replies.map((x) => x.texto).join('\n');
    }

    const flow = state.flow ? fluxoPorId(state.flow.flowId) : undefined;
    const idx =
      flow && state.flow
        ? flow.nos.findIndex((n) => n.id === state.flow!.nodeId)
        : -1;
    return {
      estado: state,
      mensagens,
      reescrita,
      origem,
      efeitos,
      terminou: state.humano,
      onde: {
        etapa: state.humano ? 'HUMANO' : 'BOT',
        fluxo: flow ? { id: flow.id, nome: flow.nome } : null,
        bloco:
          flow && idx >= 0
            ? { numero: idx + 1, titulo: flow.nos[idx].titulo }
            : null,
      },
      aviso:
        !this.agents.available && usarIA
          ? 'A IA não está disponível agora: o teste usa só as regras fixas.'
          : null,
    };
  }

  // ───────────────────────── catálogo ─────────────────────────

  catalog() {
    const p = runtimeContent.published;
    return {
      fluxos: p.fluxos.map((f) => ({
        id: f.id,
        nome: f.nome,
        ativo: f.ativo,
        papel: f.papel ?? null,
        etapas: f.nos.length,
      })),
      tipos: NODE_TYPES_INFO,
      ferramentas: this.tools.describe(),
      sistema: p.sistema,
      baseConhecimento: KNOWLEDGE_BASE.map((k) => ({
        id: k.id,
        texto: k.text,
      })),
    };
  }
}
