import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
import { AgentOrchestrator } from '../agents/agent-orchestrator.service';
import { decide, promptFor, restartDecision } from '../domain/chatbot.flow';
import { fluxoDaOpcao, fluxoPorId } from '../domain/content-runtime';
import type { Guidance } from '../domain/content-runtime';
import {
  customToDecision,
  promptOf,
  startFlow,
  stepFlow,
} from '../domain/custom-flow';
import { ChatbotHumanizerService } from './chatbot-humanizer.service';
import { CATEGORIAS_AMBIENTE, MESSAGES } from '../domain/chatbot.messages';
import {
  Decision,
  FlowInput,
  FlowState,
  INITIAL_FLOW_STATE,
  Step,
  Trilha,
} from '../domain/chatbot.types';
import { parseInput } from '../domain/input-parser';
import { KNOWLEDGE_BASE } from '../domain/knowledge-base';
import { SPECS } from '../domain/message-specs';
import { ChatbotConversation } from '../entities/chatbot-conversation.entity';
import { STEP_DESCRIPTION } from '../agents/interpreter.agent';
import { ChatbotService } from './chatbot.service';

const STEPS: Step[] = [
  'MENU',
  'NOME',
  'CONFIRMA_NOME',
  'ENVIO_ARQUIVOS',
  'CATEGORIAS',
  'CUSTOM',
  'CASA_AP',
  'PLANTA_ACHOU',
  'AGENDAR',
  'HORARIO',
  'VISITA',
  'RECONHECIMENTO',
  'HUMANO',
];
const TRILHAS: Trilha[] = ['projeto', 'planta', 'semNada', 'boleto', 'loja'];

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
  inicio?: {
    step?: string;
    trilha?: string | null;
    nome?: string | null;
    /** Entrar direto neste fluxo próprio (publicado), sem passar pelo menu. */
    fluxoId?: string;
  };
  usarIA?: boolean;
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

    const byStep: Array<{ step: string; total: string }> = await this.repo
      .createQueryBuilder('c')
      .select('c.step', 'step')
      .addSelect('COUNT(*)', 'total')
      .groupBy('c.step')
      .getRawMany();
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

    return {
      totais: { total, novosHoje, novos7d, entreguesHoje, emHumano, comErro },
      funil: Object.fromEntries(byStep.map((r) => [r.step, Number(r.total)])),
      trilhas: Object.fromEntries(
        byTrilha.map((r) => [r.trilha ?? 'sem_trilha', Number(r.total)]),
      ),
      iaHoje: Number(sums?.iaHoje ?? 0),
      foraEscopo7d: Number(sums?.foraEscopo7d ?? 0),
      serie,
      sistema: await this.chatbot.stats(),
    };
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
      if (!STEPS.includes(q.step as Step))
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

  private summary(c: ChatbotConversation) {
    return {
      id: c.id,
      contactId: c.contactId,
      ticketId: c.ticketId,
      nome: c.nome ?? c.contactName,
      numero: maskPhone(c.numero),
      etapa: c.step,
      trilha: c.trilha,
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
    return {
      ...this.summary(c),
      local: c.local,
      categorias: (c.categorias ?? [])
        .map((n) => CATEGORIAS_AMBIENTE[n])
        .filter(Boolean),
      arquivos: c.arquivos,
      pastaDrive: !!c.driveFolderId,
      agendamento: c.agendamentoStart,
      historico: c.history ?? [],
    };
  }

  /** Silencia o bot nesta conversa (um humano assume). */
  async silenciar(id: string) {
    const c = await this.repo.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Conversa não encontrada.');
    c.step = 'HUMANO';
    c.emAtendimento = true;
    await this.repo.save(c);
    return this.summary(c);
  }

  /** Devolve a conversa ao bot, recomeçando do menu. */
  async devolverAoBot(id: string) {
    const c = await this.repo.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Conversa não encontrada.');
    Object.assign(c, restartDecision().patch);
    c.emAtendimento = false;
    c.finalizouTriagem = false;
    c.handoffError = null;
    c.driveFolderId = null;
    c.slots = null;
    c.lastMessageAt = new Date();
    await this.repo.save(c);
    return this.summary(c);
  }

  // ───────────────────────── simulador (sem efeitos) ─────────────────────────

  /** Reconstrói o estado vindo do navegador só com campos conhecidos e validados. */
  private sanitizeState(raw: Record<string, unknown>): FlowState {
    const step = STEPS.includes(raw.step as Step) ? (raw.step as Step) : null;
    if (!step) throw new BadRequestException('Estado da simulação inválido.');
    const state: FlowState = {
      ...INITIAL_FLOW_STATE,
      step,
      trilha: TRILHAS.includes(raw.trilha as Trilha)
        ? (raw.trilha as Trilha)
        : null,
      nome: asStr(raw.nome, 60),
      nomePendente: asStr(raw.nomePendente, 60),
      local: raw.local === 'casa' || raw.local === 'ap' ? raw.local : null,
      categorias: Array.isArray(raw.categorias)
        ? raw.categorias.filter((n) => Number.isInteger(n)).slice(0, 10)
        : [],
      arquivos: asInt(raw.arquivos),
      invalidCount: asInt(raw.invalidCount),
      offTopicCount: asInt(raw.offTopicCount),
      slots: null,
      custom: null,
    };
    if (step === 'CUSTOM') {
      const c = raw.custom as Record<string, unknown> | null;
      const flow =
        c && typeof c.flowId === 'string' ? fluxoPorId(c.flowId) : undefined;
      if (!c || !flow)
        throw new BadRequestException(
          'Este fluxo não está mais publicado: recomece o teste.',
        );
      const vars: Record<string, string> = {};
      for (const [k, v] of Object.entries((c.vars as object) ?? {}).slice(
        0,
        40,
      ))
        if (typeof v === 'string') vars[k.slice(0, 40)] = v.slice(0, 300);
      state.custom = {
        flowId: flow.id,
        nodeId: asStr(c.nodeId, 40) ?? '',
        historico: Array.isArray(c.historico)
          ? c.historico.filter((x) => typeof x === 'string').slice(-50)
          : [],
        vars,
        arquivos: asInt(c.arquivos),
        invalidos: asInt(c.invalidos),
      };
    }
    return state;
  }

  /**
   * Um passo de uma conversa simulada, do jeito que o cliente viveria hoje (conteúdo PUBLICADO):
   * menu → fluxo padrão ou fluxo próprio, com IA, tom do fluxo e dúvidas pela base do fluxo.
   * Nada é enviado, gravado, criado no Drive nem encaminhado.
   */
  async converse(input: SimulateInput) {
    const usarIA = input.usarIA !== false;
    const texto = (input.texto ?? '').toString().slice(0, 600).trim();
    const opts = {
      maxInvalid: this.appConfig.chatbot.maxInvalid,
      scheduling: this.appConfig.chatbot.ponttaEnabled,
      maxOffTopic: this.appConfig.chatbot.maxOffTopic,
    };

    // Chegada do cliente (sem estado): mostra a primeira tela
    if (!input.estado) {
      if (input.inicio?.fluxoId) {
        const flow = fluxoPorId(input.inicio.fluxoId);
        if (!flow)
          throw new BadRequestException(
            'Este fluxo não está publicado: publique-o para testá-lo aqui.',
          );
        const d = customToDecision(startFlow(flow, null), flow.id, null);
        const next: FlowState = {
          ...INITIAL_FLOW_STATE,
          categorias: [],
          ...d.patch,
        };
        return this.resposta(
          next,
          d.replies,
          d.effects,
          'regras',
          usarIA,
          flow.id,
        );
      }
      const step = STEPS.includes(input.inicio?.step as Step)
        ? (input.inicio!.step as Step)
        : 'MENU';
      if (step === 'CUSTOM' || step === 'HUMANO')
        throw new BadRequestException('Escolha uma etapa do fluxo padrão.');
      const nome = asStr(input.inicio?.nome, 60);
      const state: FlowState = {
        ...INITIAL_FLOW_STATE,
        categorias: [],
        step,
        trilha: TRILHAS.includes(input.inicio?.trilha as Trilha)
          ? (input.inicio!.trilha as Trilha)
          : step === 'MENU'
            ? null
            : 'projeto',
        nome,
        nomePendente: step === 'CONFIRMA_NOME' ? (nome ?? 'Cliente') : null,
        arquivos: step === 'ENVIO_ARQUIVOS' ? 1 : 0,
        slots: step === 'HORARIO' ? [] : null,
      };
      const replies = promptFor(state);
      return this.resposta(
        state,
        replies.length ? replies : [MESSAGES.menu_inicial],
        [],
        'regras',
        usarIA,
      );
    }

    if (!texto)
      throw new BadRequestException('Digite uma mensagem para simular.');
    const state = this.sanitizeState(input.estado);
    if (state.step === 'HUMANO')
      throw new BadRequestException(
        'A conversa já foi encaminhada: recomece o teste.',
      );

    let origem: 'regras' | 'ia' | 'nenhuma' = 'regras';
    let decision: Decision;

    if (state.step === 'CUSTOM') {
      const flow = fluxoPorId(state.custom!.flowId)!;
      const r = stepFlow(
        flow,
        state.custom!,
        { text: texto, hasFile: false },
        { maxInvalid: opts.maxInvalid },
      );
      decision = customToDecision(r, flow.id, state.nome);
      if (r.invalido && flow.kb?.length && usarIA && this.agents.available) {
        const answer = await this.agents.answerFaq(
          texto,
          flow.kb,
          flow.guidance as Guidance | undefined,
        );
        const retomar = promptOf(flow, state.custom!);
        if (answer && retomar) {
          origem = 'ia';
          decision = {
            patch: { step: 'CUSTOM', custom: state.custom, invalidCount: 0 },
            replies: [answer, retomar],
            effects: [],
            flowId: flow.id,
          };
        }
      }
    } else {
      let entrada: FlowInput | null = parseInput(state, texto, false);
      if (entrada === null) {
        if (usarIA && this.agents.available) {
          origem = 'ia';
          entrada = await this.agents.resolve({
            state,
            message: texto,
            history: [],
          });
        } else {
          origem = 'nenhuma';
          entrada = { kind: 'invalid' };
        }
      }
      const flow =
        state.step === 'MENU' && entrada.kind === 'option'
          ? fluxoDaOpcao(entrada.value)
          : undefined;
      decision = flow
        ? customToDecision(startFlow(flow, state.nome), flow.id, state.nome)
        : decide(state, entrada, opts);
    }

    const next: FlowState = { ...state, ...decision.patch };
    return this.resposta(
      next,
      decision.replies,
      decision.effects,
      origem,
      usarIA,
      decision.flowId,
    );
  }

  private async resposta(
    state: FlowState,
    replies: string[],
    effects: Decision['effects'],
    origem: 'regras' | 'ia' | 'nenhuma',
    usarIA: boolean,
    flowId?: string,
  ) {
    // Encaminhar a um atendente encerra a conversa do bot (como no atendimento real)
    const handoff = effects.find((e) => e.type === 'handoff');
    const estado: FlowState = handoff
      ? { ...state, step: 'HUMANO', custom: null }
      : state;
    const fid =
      flowId ?? (estado.step === 'CUSTOM' ? estado.custom?.flowId : undefined);

    // Como o cliente leria: com a voz da IA (tom do fluxo), se ela estiver disponível e ligada no teste
    let mensagens = replies;
    let reescrita = false;
    if (usarIA && this.humanizer.enabled && replies.length) {
      mensagens = await this.humanizer.compose(
        { contactId: -1, nome: estado.nome, history: [] } as never,
        replies,
        fid,
      );
      reescrita = mensagens.join('\n') !== replies.join('\n');
    }
    const rotulos: Record<string, string> = {
      criar_pasta: 'Drive: criaria a pasta do cliente',
      salvar_preferencias: 'Drive: salvaria as preferências',
      salvar_respostas: 'Drive: salvaria as respostas',
      oferecer_horarios: 'Pontta: ofereceria horários',
      agendar: 'Pontta: agendaria a medição',
      handoff: 'Encaminharia a um atendente (rodízio)',
    };
    const flow =
      estado.step === 'CUSTOM' ? fluxoPorId(estado.custom!.flowId) : undefined;
    const noAtual =
      flow?.nos.findIndex((n) => n.id === estado.custom!.nodeId) ?? -1;
    return {
      estado,
      mensagens,
      reescrita,
      origem,
      efeitos: effects.map((e) => rotulos[e.type] ?? e.type),
      terminou: estado.step === 'HUMANO',
      onde: {
        etapa: estado.step,
        fluxo: flow ? { id: flow.id, nome: flow.nome } : null,
        bloco:
          flow && noAtual >= 0
            ? { numero: noAtual + 1, titulo: flow.nos[noAtual].titulo }
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
    return {
      etapas: STEPS.map((s) => ({
        etapa: s,
        descricao: STEP_DESCRIPTION[s] ?? null,
      })),
      mensagens: Object.entries(MESSAGES).map(([chave, texto]) => ({
        chave,
        texto,
        objetivo: SPECS[chave as keyof typeof SPECS]?.objetivo ?? null,
        pontosEssenciais: (
          SPECS[chave as keyof typeof SPECS]?.pontos ?? []
        ).map((p) => p.anyOf[0]),
      })),
      categorias: CATEGORIAS_AMBIENTE,
      baseConhecimento: KNOWLEDGE_BASE.map((k) => ({
        id: k.id,
        texto: k.text,
      })),
    };
  }
}
