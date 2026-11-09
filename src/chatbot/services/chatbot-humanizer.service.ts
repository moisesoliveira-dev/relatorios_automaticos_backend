import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
import { MessageSpec, SPECS, splitBlock } from '../domain/message-specs';
import { fluxoPorId, Guidance, guidanceOf } from '../domain/content-runtime';
import {
  assembleBubbles,
  validateWriterOutput,
  WriterOutput,
} from '../domain/writer.validator';
import { WriterAgent } from '../agents/writer.agent';
import { AttendantAgent } from '../agents/attendant.agent';
import {
  bolhasDoTurno,
  intencaoDoSistema,
  ItemDoTurno,
  explicarReprovacao,
  montarTurno,
  validarTurno,
} from '../domain/turno';
import { OpenAiService } from './openai.service';
import type { Reply, SystemMessageKey } from '../engine/flow.types';
import { DEFAULT_SYSTEM, seedFlows } from '../engine/flow.seed';

type Counter =
  | 'turno_ok'
  | 'escrita_ok'
  | 'fallback_validacao'
  | 'fallback_erro'
  | 'fallback_limite'
  | 'sem_spec';

/** O que o Redator precisa saber sobre a conversa. */
export interface ComposeContext {
  contactId: number;
  nome: string | null;
  history: Array<{ role: 'cliente' | 'bot'; text: string }>;
  /** Etapa em que o cliente está depois deste turno (modo atendente). */
  pendente?: Reply | null;
  /** O que o cliente já informou. */
  dados?: Record<string, string>;
}

const SYSTEM_SPEC: Record<string, keyof typeof SPECS> = {
  invalida_generica: 'invalida_generica',
  invalida_nome: 'invalida_nome',
  invalida_arquivos: 'invalida_arquivos',
  invalida_lista: 'invalida_ambientes',
  duvida_sem_resposta: 'duvida_sem_resposta',
  dado_corrigido: 'dado_corrigido',
  retomar_conversa: 'retomar_conversa',
  esclarecer_etapa: 'esclarecer_etapa',
  fora_escopo: 'fora_escopo',
  fora_escopo_limite: 'fora_escopo_limite',
  audio_nao_suportado: 'audio_nao_suportado',
  reinicio_por_pausa: 'reinicio_por_pausa',
  redirecionando: 'redirecionando_projetistas',
  redirecionando_com_nome: 'redirecionando_projetistas_com_nome',
};

/** Textos que ninguém editou. Com a frase pronta na frente, qualquer modelo a repete. */
const TEXTOS_PADRAO = new Set(
  seedFlows().flatMap((f) =>
    f.nos.flatMap((n) => ('texto' in n && n.texto ? [n.texto] : [])),
  ),
);

/** A mensagem do sistema continua a padrão? ({nome} já vem trocado no texto.) */
const sistemaPadrao = (key: SystemMessageKey, texto: string) =>
  DEFAULT_SYSTEM[key].split('{nome}').every((parte) => texto.includes(parte));

/** Repetir a pergunta depois de um desvio: curta, sem se apresentar nem cumprimentar de novo. */
function specDeRetomada(spec: MessageSpec): MessageSpec {
  return {
    ...spec,
    saudacao: false,
    usaNome: false,
    objetivo: spec.saudacao
      ? 'Perguntar, em uma frase curta, qual das opções abaixo o cliente prefere. Sem cumprimentar, sem se apresentar e sem citar as opções.'
      : `Lembrar em uma frase curta o que falta o cliente responder, sem cumprimentar, sem se apresentar e sem comentar o que ele acabou de dizer. O que falta: ${spec.objetivo}`,
    pontos: spec.saudacao ? [] : spec.pontos,
    maxChars: Math.min(spec.maxChars ?? 200, 200),
  };
}

/**
 * Dá voz humana às mensagens do bot. Recebe o texto que o motor decidiu enviar (com a
 * especificação do que ele precisa comunicar), pede ao agente Redator uma versão natural e só a usa
 * se o revisor confirmar que todos os pontos essenciais continuam lá. Qualquer falha devolve o texto
 * original: o cliente nunca fica sem resposta e a conversa nunca depende da IA para andar.
 */
@Injectable()
export class ChatbotHumanizerService {
  private readonly logger = new Logger(ChatbotHumanizerService.name);
  readonly counters: Record<Counter, number> = {
    turno_ok: 0,
    escrita_ok: 0,
    fallback_validacao: 0,
    fallback_erro: 0,
    fallback_limite: 0,
    sem_spec: 0,
  };
  readonly rejections: Record<string, number> = {};
  private usage = new Map<string, number>();

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly openai: OpenAiService,
    private readonly writer: WriterAgent,
    private readonly attendant?: AttendantAgent,
  ) {}

  get enabled(): boolean {
    return (
      this.appConfig.chatbot.humanize &&
      this.openai.enabled &&
      !this.openai.breakerOpen
    );
  }

  /** Modo atendente: uma resposta por turno, escrita conhecendo a conversa inteira. */
  get atendenteAtivo(): boolean {
    return (
      this.enabled && !!this.attendant && !!this.appConfig.chatbot.atendente
    );
  }

  /** Devolve as bolhas a enviar (1 ou 2 por mensagem). */
  async compose(
    ctx: ComposeContext,
    replies: Reply[],
    flowId?: string,
  ): Promise<string[]> {
    if (!replies.length) return [];
    if (this.atendenteAtivo) return this.composeTurno(ctx, replies, flowId);
    const parts = await Promise.all(
      replies.map((r) => this.composeOne(ctx, r, flowId)),
    );
    return parts.flat();
  }

  /** Qualquer falha devolve os textos completos do fluxo: o cliente nunca fica sem resposta. */
  private async composeTurno(
    ctx: ComposeContext,
    replies: Reply[],
    flowId?: string,
  ): Promise<string[]> {
    const literal = replies.map((r) => r.texto);
    if (this.overLimit(ctx.contactId)) {
      this.counters.fallback_limite++;
      return literal;
    }
    const flow = flowId ? fluxoPorId(flowId) : undefined;
    const item = (reply: Reply): ItemDoTurno => {
      const padrao =
        !!reply.textoOriginal &&
        TEXTOS_PADRAO.has(reply.textoOriginal) &&
        !!reply.spec?.objetivo &&
        !reply.spec.modo &&
        !/\d{3,}/.test(reply.texto);
      const base: MessageSpec | undefined = reply.aviso
        ? {
            objetivo:
              reply.aviso === 'arquivo'
                ? 'Confirmar em poucas palavras que o arquivo chegou e dizer que, quando terminar de mandar, é só avisar.'
                : 'Confirmar em poucas palavras os itens que o cliente citou e perguntar se é só isso.',
            pontos: [],
            maxChars: 200,
            modo: 'instrucao',
          }
        : this.specFor(reply, !!flow?.reescrever);
      return {
        reply,
        spec:
          reply.sistema && sistemaPadrao(reply.sistema, reply.texto)
            ? intencaoDoSistema(reply.sistema, base)
            : padrao && base
              ? { ...base, modo: 'instrucao' }
              : base,
      };
    };
    const history = ctx.history ?? [];
    const recentBot = history
      .filter((t) => t.role === 'bot')
      .map((t) => t.text);
    const turno = montarTurno({
      itens: replies.map(item),
      pendente: ctx.pendente ? item(ctx.pendente) : null,
      primeira: recentBot.length === 0,
    });
    if (!turno.pedidos.length) {
      this.counters.sem_spec++;
      return literal;
    }

    const manaus = new Date(Date.now() - 4 * 3600_000).getUTCHours();
    const ultimaCliente = [...history]
      .reverse()
      .find((t) => t.role === 'cliente')?.text;
    let corrigir: { texto: string; problema: string } | undefined;
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      let out: Awaited<ReturnType<AttendantAgent['run']>> = null;
      try {
        out = await this.attendant!.run({
          turno,
          nome: ctx.nome,
          usarNome: !!turno.spec.usaNome,
          periodo: manaus < 12 ? 'manha' : manaus < 18 ? 'tarde' : 'noite',
          history,
          dados: ctx.dados ?? {},
          guidance: guidanceOf(flow),
          corrigir,
        });
      } catch (error) {
        this.logger.warn(`Atendente falhou: ${(error as Error).message}`);
      }
      if (!out) {
        this.counters.fallback_erro++;
        return literal;
      }
      const verdict = validarTurno(out, turno, {
        nome: ctx.nome,
        recentBot,
        ultimaCliente,
      });
      if (verdict.ok) {
        this.counters.turno_ok++;
        return bolhasDoTurno(verdict, turno.literais, turno.literalAbre);
      }
      this.rejections[verdict.motivo] =
        (this.rejections[verdict.motivo] ?? 0) + 1;
      this.logger.warn(`Resposta da atendente reprovada: ${verdict.motivo}`);
      corrigir = {
        texto: [out.abertura, out.fechamento].filter(Boolean).join(' '),
        problema: explicarReprovacao(verdict.motivo),
      };
    }
    this.counters.fallback_validacao++;
    return literal;
  }

  private overLimit(contactId: number): boolean {
    const day = new Date(Date.now() - 4 * 3600_000).toISOString().slice(0, 10);
    const key = `${contactId}:${day}`;
    if (this.usage.size > 5000) this.usage.clear();
    const n = (this.usage.get(key) ?? 0) + 1;
    this.usage.set(key, n);
    return n > this.appConfig.chatbot.writerDailyLimit;
  }

  /** Especificação que vale para esta mensagem: da etapa, do sistema, ou genérica (texto do dono do fluxo). */
  private specFor(reply: Reply, reescrever: boolean): MessageSpec | undefined {
    if (reply.spec) {
      return {
        modo: reply.spec.modo,
        objetivo:
          reply.spec.objetivo ||
          (reply.spec.modo === 'obrigatorio'
            ? 'Escrever só uma frase curta e natural que conduza ao texto que será anexado, sem repetir o conteúdo dele.'
            : 'Dizer exatamente o que a mensagem diz, no tom definido, sem acrescentar nem tirar informação.'),
        pontos: (reply.spec.pontos ?? []).map((anyOf) => ({ anyOf })),
        saudacao: reply.spec.saudacao,
        usaNome: reply.spec.usaNome,
        maxChars: reply.spec.maxChars,
        nomeObrigatorio: reply.texto.includes('{nome}') || undefined,
      };
    }
    if (reply.sistema && SYSTEM_SPEC[reply.sistema])
      return SPECS[SYSTEM_SPEC[reply.sistema]];
    if (!reescrever) return undefined;
    // Texto escrito pelo dono do fluxo: a IA só pode mudar o jeito de dizer, nada do conteúdo.
    const { head } = splitBlock({ objetivo: '', pontos: [] }, reply.texto);
    return {
      objetivo:
        'Dizer exatamente o que a mensagem do fluxo diz, no tom definido, sem acrescentar nem tirar informação.',
      pontos: [],
      maxChars: Math.max(240, head.length),
      usaNome: true,
      perguntar: head.includes('?'),
      manter: [...head.matchAll(/\*([^*\n]{2,40})\*/g)].map((m) =>
        m[1].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(),
      ),
    };
  }

  private async composeOne(
    ctx: ComposeContext,
    reply: Reply,
    flowId?: string,
  ): Promise<string[]> {
    const text = reply.texto;
    if (!this.enabled) return [text];
    const flow = flowId ? fluxoPorId(flowId) : undefined;
    const guidance: Guidance = guidanceOf(flow);
    const base = this.specFor(reply, !!flow?.reescrever);
    const spec = base && reply.retomada ? specDeRetomada(base) : base;
    const key = reply.nodeId ?? reply.sistema ?? 'texto';
    if (!spec) {
      this.counters.sem_spec++;
      return [text];
    }
    if (this.overLimit(ctx.contactId)) {
      this.counters.fallback_limite++;
      return [text];
    }

    const partes = splitBlock(spec, text);
    // Texto obrigatório vai literal, como bloco fixo: a IA escreve em volta, nunca em cima dele.
    const block = spec.modo === 'obrigatorio' ? text.trim() : partes.block;
    // Só instrução: a IA não vê o texto de reserva, para não copiá-lo.
    const head =
      spec.modo === 'obrigatorio' || spec.modo === 'instrucao'
        ? spec.objetivo
        : partes.head;
    const history = ctx.history ?? [];
    const lastCustomer = [...history]
      .reverse()
      .find((t) => t.role === 'cliente')?.text;
    const recentBot = history
      .filter((t) => t.role === 'bot')
      .map((t) => t.text);
    const manaus = new Date(Date.now() - 4 * 3600_000).getUTCHours();
    const nome = ctx.nome ?? null;

    let out: WriterOutput | null = null;
    try {
      out = await this.writer.run({
        spec,
        reference: head || text,
        block,
        nome,
        usarNome: !!spec.usaNome,
        periodo: manaus < 12 ? 'manha' : manaus < 18 ? 'tarde' : 'noite',
        primeiraInteracao: !!spec.saudacao && recentBot.length === 0,
        ultimaMensagemCliente: lastCustomer,
        recentBot,
        estiloCliente:
          lastCustomer && lastCustomer.length <= 25 ? 'curto' : 'normal',
        guidance,
      });
    } catch (error) {
      this.logger.warn(`Redator falhou (${key}): ${(error as Error).message}`);
    }

    if (!out) {
      this.counters.fallback_erro++;
      return [text];
    }

    const verdict = validateWriterOutput(out, {
      spec,
      reference: head || text,
      block,
      nome,
      recentBot,
    });
    if (!verdict.ok) {
      this.counters.fallback_validacao++;
      this.rejections[verdict.motivo] =
        (this.rejections[verdict.motivo] ?? 0) + 1;
      this.logger.warn(
        `Texto do Redator reprovado (${key}): ${verdict.motivo} — usando a mensagem original`,
      );
      return [text];
    }

    this.counters.escrita_ok++;
    return assembleBubbles(verdict, block);
  }
}
