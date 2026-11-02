import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
import { AgentOrchestrator } from '../agents/agent-orchestrator.service';
import { decide, restartDecision } from '../domain/chatbot.flow';
import { CATEGORIAS_AMBIENTE, MESSAGES } from '../domain/chatbot.messages';
import {
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
  text: string;
  step?: Step;
  trilha?: Trilha | null;
  nome?: string | null;
  usarIA?: boolean;
}

@Injectable()
export class ChatbotAdminService {
  constructor(
    @InjectRepository(ChatbotConversation)
    private readonly repo: Repository<ChatbotConversation>,
    private readonly appConfig: AppConfigService,
    private readonly agents: AgentOrchestrator,
    private readonly chatbot: ChatbotService,
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

  async simulate(input: SimulateInput) {
    const text = (input.text ?? '').toString().slice(0, 600);
    if (!text.trim())
      throw new BadRequestException('Digite uma mensagem para simular.');
    const step: Step = STEPS.includes(input.step as Step)
      ? (input.step as Step)
      : 'MENU';
    const trilha =
      input.trilha && TRILHAS.includes(input.trilha)
        ? input.trilha
        : step === 'MENU'
          ? null
          : 'projeto';
    const nome = input.nome?.toString().slice(0, 60) || null;
    const state: FlowState = {
      ...INITIAL_FLOW_STATE,
      categorias: [],
      step,
      trilha,
      nome,
      nomePendente: step === 'CONFIRMA_NOME' ? (nome ?? 'Cliente') : null,
      arquivos: step === 'ENVIO_ARQUIVOS' ? 1 : 0,
      slots: step === 'HORARIO' ? [] : null,
    };

    let origem: 'regras' | 'ia' | 'nenhuma' = 'regras';
    let entrada: FlowInput | null = parseInput(state, text, false);
    if (entrada === null) {
      if (input.usarIA !== false && this.agents.available) {
        origem = 'ia';
        entrada = await this.agents.resolve({
          state,
          message: text,
          history: [],
        });
      } else {
        origem = 'nenhuma';
        entrada = { kind: 'invalid' };
      }
    }

    const d = decide(state, entrada, {
      maxInvalid: this.appConfig.chatbot.maxInvalid,
      scheduling: this.appConfig.chatbot.ponttaEnabled,
      maxOffTopic: this.appConfig.chatbot.maxOffTopic,
    });
    const proxima = (d.patch.step as Step | undefined) ?? step;

    return {
      etapaAntes: step,
      origem,
      entrada,
      etapaDepois: d.effects.some((e) => e.type === 'handoff')
        ? 'HUMANO'
        : proxima,
      mensagens: d.replies,
      efeitos: d.effects.map((e) => e.type),
      observacao:
        origem === 'ia'
          ? 'A IA foi chamada (conta no uso do dia). A mensagem final ao cliente ainda passa pelo Redator em produção.'
          : origem === 'nenhuma' && input.usarIA !== false
            ? 'A IA não está disponível agora; o bot usaria as regras fixas.'
            : 'Resolvido só por regras fixas (sem IA).',
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
