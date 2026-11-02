import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
import {
  identifyMessage,
  MessageSpec,
  SPECS,
  splitBlock,
} from '../domain/message-specs';
import { Guidance, TONES, ToneKey } from '../domain/content-runtime';
import { fluxoPorId } from '../domain/content-runtime';
import {
  assembleBubbles,
  validateWriterOutput,
  WriterOutput,
} from '../domain/writer.validator';
import { WriterAgent } from '../agents/writer.agent';
import { OpenAiService } from './openai.service';
import { ChatbotConversation } from '../entities/chatbot-conversation.entity';

type Counter =
  | 'escrita_ok'
  | 'fallback_validacao'
  | 'fallback_erro'
  | 'fallback_limite'
  | 'sem_spec';

/**
 * Dá voz humana às mensagens do bot. Recebe o texto padrão que o motor de regras decidiu enviar,
 * pede ao agente Redator uma versão natural e contextual, e só a usa se o revisor confirmar que
 * todos os pontos essenciais continuam lá. Qualquer falha devolve o texto original — o cliente
 * nunca fica sem resposta e a conversa nunca depende da IA para andar.
 */
@Injectable()
export class ChatbotHumanizerService {
  private readonly logger = new Logger(ChatbotHumanizerService.name);
  readonly counters: Record<Counter, number> = {
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
  ) {}

  get enabled(): boolean {
    return (
      this.appConfig.chatbot.humanize &&
      this.openai.enabled &&
      !this.openai.breakerOpen
    );
  }

  /** Devolve as bolhas a enviar (1 ou 2 por mensagem do catálogo). */
  async compose(
    conv: ChatbotConversation,
    texts: string[],
    flowId?: string,
  ): Promise<string[]> {
    if (!texts.length) return [];
    const parts = await Promise.all(
      texts.map((t) => this.composeOne(conv, t, flowId)),
    );
    return parts.flat();
  }

  private overLimit(contactId: number): boolean {
    const day = new Date(Date.now() - 4 * 3600_000).toISOString().slice(0, 10);
    const key = `${contactId}:${day}`;
    if (this.usage.size > 5000) this.usage.clear(); // evita crescer sem limite
    const n = (this.usage.get(key) ?? 0) + 1;
    this.usage.set(key, n);
    return n > this.appConfig.chatbot.writerDailyLimit;
  }

  private async composeOne(
    conv: ChatbotConversation,
    text: string,
    flowId?: string,
  ): Promise<string[]> {
    if (!this.enabled) return [text];
    const flow = flowId ? fluxoPorId(flowId) : undefined;
    // Num fluxo próprio, vale o jeito de falar DELE (nunca o do fluxo padrão).
    const guidance: Guidance | undefined = flow
      ? {
          tone: ((flow.guidance?.tone as ToneKey) in TONES
            ? flow.guidance?.tone
            : 'padrao') as ToneKey,
          instructions: flow.guidance?.instructions ?? '',
        }
      : undefined;

    const id = identifyMessage(text);
    let spec: MessageSpec | undefined = id ? SPECS[id.key] : undefined;
    const key: string = id?.key ?? 'fluxo_proprio';
    if (!id && flow?.reescrever) {
      // Texto escrito pelo dono do fluxo: a IA só pode mudar o jeito de dizer, nada do conteúdo.
      const { head } = splitBlock({ objetivo: '', pontos: [] }, text);
      spec = {
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
    if (!spec) {
      this.counters.sem_spec++;
      return [text];
    }
    if (this.overLimit(conv.contactId)) {
      this.counters.fallback_limite++;
      return [text];
    }

    const { head, block } = splitBlock(spec, text);
    const history = conv.history ?? [];
    const lastCustomer = [...history]
      .reverse()
      .find((t) => t.role === 'cliente')?.text;
    const recentBot = history
      .filter((t) => t.role === 'bot')
      .map((t) => t.text);
    const manaus = new Date(Date.now() - 4 * 3600_000).getUTCHours();
    const nome = id?.nome ?? conv.nome ?? null;

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
