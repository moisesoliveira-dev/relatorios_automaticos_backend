import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Not, Repository } from 'typeorm';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
import {
  isAllowedMediaUrl,
  parseAllowedHosts,
} from '../../gosac/media-url.util';
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
  pularRespondidas,
  recognitionFlow,
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
import type { ToolContext, ToolResult } from '../engine/tool.types';
import {
  ChatbotConversation,
  HistoryTurn,
} from '../entities/chatbot-conversation.entity';
import { GosacMessengerService } from './gosac-messenger.service';
import { OpenAiService } from './openai.service';
import { AgentOrchestrator } from '../agents/agent-orchestrator.service';
import { isAllowedNumber, parseNumberList } from '../domain/test-mode';
import { ChatbotHandoffService } from './chatbot-handoff.service';
import { ChatbotHumanizerService } from './chatbot-humanizer.service';
import { ChatbotDriveService } from './chatbot-drive.service';
import { ChatbotInboxService, PendingMessage } from './chatbot-inbox.service';
import { ChatbotLockService } from './chatbot-lock.service';
import { ToolRegistry } from '../tools/tool.registry';

export interface Inbound {
  messageId?: string;
  contactId: number;
  ticketId: number;
  body: string;
  fromMe: boolean;
  mediaType?: string;
  mediaPath?: string | null;
  isGroup: boolean;
  ticketCreatedAt?: Date;
  contactName?: string;
  numero?: string;
}

interface Batch {
  texts: string[];
  files: Inbound[];
  audio: boolean;
  last: Inbound;
}

const IGNORED_MEDIA = new Set(['hsm', 'transfer', 'impostor']);
const NON_FILE_MEDIA = new Set([
  'ptt',
  'audio',
  'vcard',
  'location',
  'sticker',
]);
/** Assinatura de atendente humano no texto: "*Nome:*\n..." */
const AGENT_SIGNATURE = /\*\s*[^*]+:\s*\*\s*\n/;
const MAX_PROCESSED_IDS = 20;
/** Mensagens da conversa que a atendente enxerga. */
const MAX_HISTORY = 16;
const SO_CUMPRIMENTO =
  /^\W*(oi+|ol[aá]|opa|e a[ií]|bom dia|boa tarde|boa noite|tudo bem|tudo bom|\s|[!,.?])*$/i;
const MAX_TOOL_CHAIN = 12;

export function parseWebhook(payload: any): Inbound | null {
  const data = payload?.data ?? payload;
  const contactId = Number(data?.contactId ?? data?.ticket?.contactId);
  const ticketId = Number(data?.ticketId ?? data?.ticket?.id);
  if (
    !Number.isInteger(contactId) ||
    !Number.isInteger(ticketId) ||
    contactId <= 0 ||
    ticketId <= 0
  )
    return null;
  const created = data?.ticket?.createdAt
    ? new Date(data.ticket.createdAt)
    : undefined;
  return {
    messageId: data?.id ? String(data.id) : undefined,
    contactId,
    ticketId,
    body: typeof data?.body === 'string' ? data.body : '',
    fromMe: data?.fromMe === true,
    mediaType: data?.mediaType ? String(data.mediaType) : undefined,
    mediaPath: data?.mediaPath || data?.mediaUrl || null,
    isGroup:
      data?.ticket?.contact?.isGroup === true || data?.groupContactId != null,
    ticketCreatedAt: created && !isNaN(created.getTime()) ? created : undefined,
    contactName: data?.contact?.name ?? data?.ticket?.contact?.name,
    numero: data?.contact?.number ?? data?.ticket?.contact?.number,
  };
}

const sameManausDay = (a: Date, b: Date) => {
  const f = (d: Date) =>
    new Date(d.getTime() - 4 * 3600_000).toISOString().slice(0, 10);
  return f(a) === f(b);
};

const clip = (s: string, n = 200) => (s.length > n ? `${s.slice(0, n)}…` : s);
const manausDay = () =>
  new Date(Date.now() - 4 * 3600_000).toISOString().slice(0, 10);

/**
 * Orquestra cada conversa: recebe do webhook, junta as mensagens, pede ao motor de fluxos a decisão,
 * envia os textos (com a voz da IA quando ligada), executa ferramentas e entrega a um humano.
 * Regras globais (cliente novo, ticket novo, atendente ativo, áudio, arquivos, limites) moram aqui.
 */
@Injectable()
export class ChatbotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatbotService.name);
  /** Timers de debounce desta instância (a fila em si está no Postgres). */
  private readonly timers = new Map<number, NodeJS.Timeout>();
  private readonly retries = new Map<number, number>();
  private activeDrains = 0;
  private readonly maxDrains = 4;
  private shuttingDown = false;
  private readonly errorCount = new Map<number, number>();
  private readonly allowedHosts: string[];

  constructor(
    private readonly appConfig: AppConfigService,
    @InjectRepository(ChatbotConversation)
    private readonly repo: Repository<ChatbotConversation>,
    private readonly messenger: GosacMessengerService,
    private readonly ai: OpenAiService,
    private readonly agents: AgentOrchestrator,
    private readonly humanizer: ChatbotHumanizerService,
    private readonly handoff: ChatbotHandoffService,
    private readonly drive: ChatbotDriveService,
    private readonly inbox: ChatbotInboxService,
    private readonly lock: ChatbotLockService,
    private readonly tools: ToolRegistry,
  ) {
    this.allowedHosts = parseAllowedHosts(
      this.appConfig.gosacApi.baseUrl,
      process.env.GOSAC_MEDIA_ALLOWED_HOSTS,
    );
  }

  get enabled(): boolean {
    return this.appConfig.chatbot.enabled;
  }

  /** Ao subir, retoma o que ficou na caixa de entrada (reinício/queda no meio de um atendimento). */
  onModuleInit() {
    if (this.enabled) void this.sweep();
  }

  onModuleDestroy() {
    this.shuttingDown = true;
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
  }

  // ───────────────────────── entrada ─────────────────────────

  /** Modo teste ligado: só os números cadastrados passam. Desligado: todos. */
  private allowedNow(numero: unknown): boolean {
    const c = this.appConfig.chatbot;
    if (!c.testMode) return true;
    return isAllowedNumber(numero, parseNumberList(c.testNumbers));
  }

  /** Quando o webhook chega mas o bot não age, o log diz por quê (no máximo uma vez por minuto por motivo). */
  private readonly ignoradoEm = new Map<string, number>();
  private ignorar(motivo: string, detalhe = ''): void {
    const agora = Date.now();
    // Um aviso por minuto para cada motivo e número: o tráfego de outros clientes não pode esconder o seu.
    const chave = `${motivo}|${detalhe}`;
    if (agora - (this.ignoradoEm.get(chave) ?? 0) < 60_000) return;
    if (this.ignoradoEm.size > 500) this.ignoradoEm.clear();
    this.ignoradoEm.set(chave, agora);
    this.logger.log(
      `Webhook do GOSAC ignorado: ${motivo}${detalhe ? ` (${detalhe})` : ''}`,
    );
  }
  private final4(numero: unknown): string {
    const d = String(numero ?? '').replace(/\D/g, '');
    return d ? `número terminado em ${d.slice(-4)}` : 'sem número no payload';
  }

  /** Chamado pelo webhook. Nunca lança e nunca bloqueia a resposta HTTP. */
  receive(payload: unknown): void {
    if (!this.enabled) {
      this.ignorar('o chatbot está desligado em Ajustes');
      return;
    }
    try {
      const msg = parseWebhook(payload);
      if (!msg) {
        const chaves =
          payload && typeof payload === 'object'
            ? Object.keys(payload as object)
                .slice(0, 8)
                .join(',')
            : typeof payload;
        this.ignorar(
          'o payload não tem contactId e ticketId',
          `campos: ${chaves}`,
        );
        return;
      }
      if (msg.isGroup) return this.ignorar('mensagem de grupo');
      if (msg.mediaType && IGNORED_MEDIA.has(msg.mediaType))
        return this.ignorar(`tipo de mídia ignorado: ${msg.mediaType}`);
      // Modo teste: só os números da lista (os demais seguem como se o bot não existisse)
      if (!this.allowedNow(msg.numero))
        return this.ignorar(
          'modo teste ligado e o número não está na lista',
          this.final4(msg.numero),
        );

      if (msg.fromMe) {
        // Só interessa saber se um humano assumiu a conversa.
        if (AGENT_SIGNATURE.test(msg.body.trim())) {
          void this.lock
            .withLock(msg.contactId, () => this.markHumanActive(msg))
            .catch((error) => this.onError(msg.contactId, error));
        }
        return;
      }
      void this.ingest(msg);
    } catch (error) {
      this.logger.error(
        `Webhook ignorado por erro: ${(error as Error).message}`,
      );
    }
  }

  /** Grava na caixa de entrada (dedupe entre instâncias) e agenda o processamento após o debounce. */
  private async ingest(msg: Inbound): Promise<void> {
    try {
      const inserted = await this.inbox.add(msg);
      if (inserted)
        this.schedule(msg.contactId, this.appConfig.chatbot.debounceMs);
    } catch (error) {
      this.logger.error(
        `Falha ao gravar mensagem na caixa de entrada: ${(error as Error).message}`,
      );
    }
  }

  private schedule(contactId: number, delayMs: number): void {
    if (this.shuttingDown) return;
    const existing = this.timers.get(contactId);
    if (existing) clearTimeout(existing);
    this.timers.set(
      contactId,
      setTimeout(() => {
        this.timers.delete(contactId);
        void this.drain(contactId);
      }, delayMs),
    );
  }

  /**
   * Esvazia a caixa de entrada de um cliente: pega a trava (uma instância por cliente), espera o
   * cliente ficar quieto (debounce), junta as mensagens e processa. Repete até não sobrar nada.
   */
  async drain(contactId: number): Promise<void> {
    if (this.shuttingDown) return;
    if (this.activeDrains >= this.maxDrains)
      return this.schedule(contactId, 500);

    const release = await this.lock.tryLock(contactId).catch((error) => {
      this.logger.error(
        `Falha ao obter trava do contato ${contactId}: ${(error as Error).message}`,
      );
      return null;
    });
    if (!release) {
      const tries = (this.retries.get(contactId) ?? 0) + 1;
      if (tries <= 5) {
        this.retries.set(contactId, tries);
        this.schedule(contactId, 1500);
      } else this.retries.delete(contactId);
      return;
    }

    this.retries.delete(contactId);
    this.activeDrains++;
    try {
      for (let guard = 0; guard < 50 && !this.shuttingDown; guard++) {
        const rows = await this.inbox.pending(contactId);
        if (!rows.length) break;

        const quietFor =
          Date.now() - Math.max(...rows.map((r) => r.receivedAt.getTime()));
        const wait = this.appConfig.chatbot.debounceMs - quietFor;
        if (wait > 0) {
          await new Promise((r) => setTimeout(r, wait));
          continue; // chegou mais coisa? relê e junta
        }

        try {
          await this.process(this.toBatch(rows));
        } catch (error) {
          await this.onError(contactId, error);
        } finally {
          await this.inbox.markProcessed(rows.map((r) => r.id));
        }
      }
    } finally {
      this.activeDrains--;
      await release();
    }
  }

  private toBatch(rows: PendingMessage[]): Batch {
    const batch: Batch = {
      texts: [],
      files: [],
      audio: false,
      last: rows[rows.length - 1].msg,
    };
    for (const { msg } of rows) {
      const hasFile =
        !!msg.mediaPath &&
        !!msg.mediaType &&
        !NON_FILE_MEDIA.has(msg.mediaType);
      if (msg.body.trim()) batch.texts.push(msg.body);
      if (hasFile) batch.files.push(msg);
      if (msg.mediaType === 'ptt' || msg.mediaType === 'audio')
        batch.audio = true;
    }
    return batch;
  }

  /** Rede de segurança: retoma clientes com mensagens paradas (queda, reinício, trava ocupada demais). */
  @Interval(30_000)
  async sweep(): Promise<void> {
    if (!this.enabled || this.shuttingDown) return;
    try {
      const stale = await this.inbox.staleContacts(
        this.appConfig.chatbot.debounceMs + 5_000,
      );
      for (const contactId of stale)
        if (!this.timers.has(contactId)) this.schedule(contactId, 200);
    } catch (error) {
      this.logger.warn(
        `Varredura da caixa de entrada falhou: ${(error as Error).message}`,
      );
    }
  }

  private async onError(contactId: number, error: unknown): Promise<void> {
    const n = (this.errorCount.get(contactId) ?? 0) + 1;
    this.errorCount.set(contactId, n);
    this.logger.error(
      `Erro ao processar contato ${contactId} (${n}): ${(error as Error)?.stack ?? error}`,
    );
    // Falhas repetidas: não deixa o cliente preso, entrega a um humano.
    if (n >= 2) {
      this.errorCount.delete(contactId);
      const conv = await this.repo
        .findOne({ where: { contactId } })
        .catch(() => null);
      if (conv && conv.step !== 'HUMANO')
        await this.finishHandoff(conv, {}).catch(() => undefined);
    }
  }

  // ───────────────────────── regras de conversa ─────────────────────────

  private async markHumanActive(msg: Inbound): Promise<void> {
    const conv =
      (await this.repo.findOne({ where: { contactId: msg.contactId } })) ??
      this.newConversation(msg);
    conv.ticketId = msg.ticketId;
    conv.step = 'HUMANO';
    conv.flow = null;
    conv.emAtendimento = true;
    conv.finalizouTriagem = true;
    conv.lastMessageAt = new Date();
    await this.repo.save(conv);
  }

  private newConversation(msg: Inbound): ChatbotConversation {
    return this.repo.create({
      contactId: msg.contactId,
      ticketId: msg.ticketId,
      numero: msg.numero ?? null,
      contactName: msg.contactName ? clip(msg.contactName, 120) : null,
      step: 'BOT',
      trilha: null,
      nome: null,
      flow: null,
      arquivos: 0,
      invalidCount: 0,
      offTopicCount: 0,
      emAtendimento: false,
      finalizouTriagem: false,
      history: [],
      processedIds: [],
      lastMessageAt: new Date(),
    });
  }

  private composeCtx(conv: ChatbotConversation) {
    return {
      contactId: conv.contactId,
      nome: conv.nome,
      history: conv.history ?? [],
      pendente: conv.flow
        ? promptOf(runtimeContent.published, conv.flow)
        : null,
      dados: conv.flow?.vars ?? {},
    };
  }

  private async send(
    conv: ChatbotConversation,
    replies: Reply[],
    flowId?: string,
  ): Promise<void> {
    if (!replies.length) return;
    const bubbles = await this.humanizer.compose(
      this.composeCtx(conv),
      replies,
      flowId ?? conv.flow?.flowId,
    );
    await this.messenger.sendTexts(conv.ticketId, bubbles);
    this.pushHistory(conv, { role: 'bot', text: clip(bubbles.join(' ')) });
  }

  private pushHistory(conv: ChatbotConversation, turn: HistoryTurn): void {
    conv.history = [...(conv.history ?? []), turn].slice(-MAX_HISTORY);
  }

  /** Começa (ou recomeça) pelo fluxo de início. */
  private async restart(
    conv: ChatbotConversation,
    prefix: Reply[] = [],
    intencao?: string,
  ): Promise<void> {
    const entry = entryFlow(runtimeContent.published);
    conv.flow = null;
    conv.trilha = null;
    conv.invalidCount = 0;
    conv.arquivos = 0;
    if (!entry) {
      this.logger.warn('Nenhum fluxo de início publicado: o bot não responde.');
      await this.repo.save(conv);
      return;
    }
    const r = startFlow(
      runtimeContent.published,
      entry.id,
      conv.nome ? { nome: conv.nome } : {},
    );
    const direto = await this.seguirIntencao(conv, r, intencao);
    await this.apply(
      conv,
      direto
        ? { ...direto, replies: [...prefix, ...direto.replies] }
        : { ...r, replies: [...prefix, ...r.replies] },
    );
  }

  /**
   * Modo atendente: quem já chega dizendo o que quer ("queria saber o endereço") não passa pelo menu.
   * Só vale se a mensagem escolhe um caminho ou traz uma dúvida; o resto segue o início normal.
   */
  private async seguirIntencao(
    conv: ChatbotConversation,
    inicio: FlowResult,
    intencao?: string,
  ): Promise<FlowResult | null> {
    const texto = intencao?.trim();
    if (
      !texto ||
      SO_CUMPRIMENTO.test(texto) ||
      !this.humanizer.atendenteAtivo ||
      !inicio.state ||
      inicio.effects.length
    )
      return null;
    conv.flow = inicio.state;
    const input = await this.interpretWithAi(conv, texto);
    if (!['opcao', 'duvida', 'duvida_sem_resposta'].includes(input.kind))
      return null;
    return stepFlow(runtimeContent.published, inicio.state, input, {
      maxInvalid: this.appConfig.chatbot.maxInvalid,
    });
  }

  async process(batch: Batch): Promise<void> {
    const msg = batch.last;
    let conv = await this.repo.findOne({ where: { contactId: msg.contactId } });
    const now = new Date();

    // Reenvio do mesmo webhook
    if (conv && msg.messageId && conv.processedIds?.includes(msg.messageId))
      return;

    // 1) Contato novo
    if (!conv) {
      conv = this.newConversation(msg);
      const created = msg.ticketCreatedAt ?? now;
      if (!sameManausDay(created, now)) {
        // Ticket antigo reaberto: já está com humanos, o bot não interfere.
        conv.step = 'HUMANO';
        conv.emAtendimento = true;
        conv.finalizouTriagem = true;
        this.remember(conv, msg);
        await this.repo.save(conv);
        return;
      }
      await this.repo.save(conv);
      this.remember(conv, msg);
      // O Redator usa a 1ª mensagem do cliente ("Oi", "Boa tarde"...) para responder com naturalidade.
      if (msg.body.trim())
        this.pushHistory(conv, { role: 'cliente', text: clip(msg.body) });
      return this.restart(conv, [], msg.body);
    }

    conv.numero = msg.numero ?? conv.numero;
    conv.contactName = msg.contactName
      ? clip(msg.contactName, 120)
      : conv.contactName;
    const previousActivity = conv.lastMessageAt;
    conv.lastMessageAt = now;
    this.remember(conv, msg);

    // 2) Novo ticket para um cliente conhecido
    if (conv.ticketId !== msg.ticketId) {
      conv.ticketId = msg.ticketId;
      conv.emAtendimento = false;
      conv.step = 'BOT';
      const rec = conv.finalizouTriagem
        ? recognitionFlow(runtimeContent.published)
        : undefined;
      if (rec) {
        conv.flow = null;
        return this.apply(
          conv,
          startFlow(
            runtimeContent.published,
            rec.id,
            conv.nome ? { nome: conv.nome } : {},
          ),
        );
      }
      return this.restart(conv);
    }

    // 3) Atendimento humano em andamento: bot em silêncio, salvo ociosidade longa
    if (conv.step === 'HUMANO') {
      const idleMs = now.getTime() - new Date(previousActivity).getTime();
      if (idleMs > this.appConfig.chatbot.humanIdleMinutes * 60_000) {
        conv.step = 'BOT';
        conv.emAtendimento = false;
        conv.finalizouTriagem = false;
        conv.driveFolderId = null;
        conv.nome = null;
        return this.restart(conv, [
          {
            texto: sistema().reinicio_por_pausa,
            sistema: 'reinicio_por_pausa',
          },
        ]);
      }
      await this.repo.save(conv);
      return;
    }

    // 4) Áudio sem texto
    const text = batch.texts.join(' ').trim();
    if (batch.audio && !text && !batch.files.length) {
      await this.repo.save(conv);
      await this.send(conv, [
        {
          texto: sistema().audio_nao_suportado,
          sistema: 'audio_nao_suportado',
        },
      ]);
      await this.repo.save(conv);
      return;
    }

    // 5) Arquivos recebidos vão para a pasta do cliente
    if (batch.files.length) await this.storeFiles(conv, batch.files);

    // 6) Sem fluxo (conversa antiga, fluxo despublicado...): começa do início
    if (!conv.flow || !currentNode(runtimeContent.published, conv.flow)) {
      if (text) this.pushHistory(conv, { role: 'cliente', text: clip(text) });
      return this.restart(conv, [], text);
    }

    // 7) Interpretação → motor
    const hasFile = batch.files.length > 0;
    let input: FlowInput | null = parseText(
      runtimeContent.published,
      conv.flow,
      text,
      hasFile,
    );
    if (input === null) input = await this.interpretWithAi(conv, text);
    else if (input.kind === 'valor' && this.conferirComIa(conv, text)) {
      // Texto que "passa" na validação mas pode não ser resposta ("Não entendi" como nome, pergunta como texto).
      const ai = await this.interpretWithAi(conv, text);
      // Sem veredito claro da IA, vale o que o cliente escreveu (já passou na validação).
      const manter = ai.kind === 'invalido';
      if (!manter) input = ai;
    }
    if (text) this.pushHistory(conv, { role: 'cliente', text: clip(text) });
    else if (hasFile)
      this.pushHistory(conv, { role: 'cliente', text: '[enviou um arquivo]' });

    if (input.kind === 'fora_escopo')
      return this.offTopic(conv, input.severidade);

    // "Na verdade quero saber o endereço": recomeça e já atende o que ele pediu.
    if (input.kind === 'recomecar' && text.split(/\s+/).length >= 4)
      return this.restart(conv, [], text);

    const antes = conv.flow.nodeId;
    const r = stepFlow(runtimeContent.published, conv.flow, input, {
      maxInvalid: this.appConfig.chatbot.maxInvalid,
    });
    // Avançou: as advertências de assunto fora ficam para trás (quem voltou ao trilho não é punido).
    if (r.state && r.state.nodeId !== antes) conv.offTopicCount = 0;
    await this.apply(conv, r);
  }

  /** Mensagem fora do assunto: avisa, soma advertências e reapresenta a etapa. */
  private async offTopic(
    conv: ChatbotConversation,
    severidade: 'leve' | 'grave',
  ): Promise<void> {
    const max = this.appConfig.chatbot.maxOffTopic;
    const antes = conv.offTopicCount ?? 0;
    conv.offTopicCount = antes + (severidade === 'grave' ? 2 : 1);
    await this.repo.save(conv);
    if (antes >= max) return; // já passou do limite: não gasta resposta
    const replies: Reply[] =
      conv.offTopicCount >= max
        ? [
            {
              texto: sistema().fora_escopo_limite,
              sistema: 'fora_escopo_limite',
            },
          ]
        : [
            { texto: sistema().fora_escopo, sistema: 'fora_escopo' },
            ...(conv.flow
              ? [promptOf(runtimeContent.published, conv.flow)].filter(
                  (x): x is Reply => !!x,
                )
              : []),
          ];
    await this.send(conv, replies);
    await this.repo.save(conv);
  }

  private remember(conv: ChatbotConversation, msg: Inbound): void {
    if (!msg.messageId) return;
    conv.processedIds = [...(conv.processedIds ?? []), msg.messageId].slice(
      -MAX_PROCESSED_IDS,
    );
  }

  /** Aplica o resultado do motor: estado, textos, ferramentas (em cadeia) e encaminhamento. */
  private async apply(
    conv: ChatbotConversation,
    result: FlowResult,
  ): Promise<void> {
    let r = result;
    const atendente = this.humanizer.atendenteAtivo;
    for (let guard = 0; guard < MAX_TOOL_CHAIN; guard++) {
      if (atendente)
        r = pularRespondidas(runtimeContent.published, r, {
          maxInvalid: this.appConfig.chatbot.maxInvalid,
        });
      if (r.nome) conv.nome = r.nome;
      if (r.state?.vars['trilha'])
        conv.trilha = r.state.vars['trilha'].slice(0, 16);
      conv.flow = r.state;
      conv.invalidCount = r.state?.invalidos ?? 0;
      conv.arquivos = r.state?.arquivos ?? conv.arquivos;
      await this.repo.save(conv); // persiste ANTES de enviar: um reenvio do webhook não repete a resposta
      // Terminou o assunto e volta ao início: "mais alguma coisa?" vai na mesma mensagem.
      if (atendente && !r.state && r.saiu === 'menu' && !r.effects.length)
        return this.restart(conv, r.replies);
      await this.send(conv, r.replies, r.flowId);

      const tool = r.effects.find(
        (e): e is Extract<Effect, { type: 'ferramenta' }> =>
          e.type === 'ferramenta',
      );
      const hand = r.effects.find(
        (e): e is Extract<Effect, { type: 'handoff' }> => e.type === 'handoff',
      );
      if (hand) {
        await this.finishHandoff(conv, {
          reutilizar: hand.reutilizar,
          jaAvisou: hand.jaAvisou,
          flowId: r.flowId,
          vars: hand.vars,
        });
        return;
      }
      if (!r.state) {
        // saiu do fluxo sem encaminhar: volta ao início
        if (r.saiu === 'menu') return this.restart(conv);
        await this.repo.save(conv);
        return;
      }
      if (!tool) {
        await this.repo.save(conv);
        return;
      }
      const toolResult = await this.runTool(conv, r.state, tool);
      r = resumeTool(runtimeContent.published, conv.flow!, toolResult);
    }
    this.logger.warn(
      `Cadeia de ferramentas longa demais (ticket ${conv.ticketId}); encaminhando.`,
    );
    await this.finishHandoff(conv, {});
  }

  /** Nome legível de cada variável do fluxo (título da etapa que a perguntou). */
  private rotulosDoFluxo(flowId?: string): Record<string, string> {
    const rotulos: Record<string, string> = {};
    const flow = flowId ? fluxoPorId(flowId) : undefined;
    for (const n of flow?.nos ?? [])
      if ('variavel' in n && n.variavel) rotulos[n.variavel] = n.titulo;
    return rotulos;
  }

  private async runTool(
    conv: ChatbotConversation,
    state: FlowState,
    eff: Extract<Effect, { type: 'ferramenta' }>,
  ): Promise<ToolResult> {
    const tool = this.tools.get(eff.ferramenta);
    if (!tool) return { ok: false, motivo: 'ferramenta_desconhecida' };
    if (!tool.disponivel()) return { ok: false, motivo: 'indisponivel' };
    const flow = fluxoPorId(state.flowId);
    const rotulos: Record<string, string> = {};
    for (const n of flow?.nos ?? [])
      if ('variavel' in n && n.variavel) rotulos[n.variavel] = n.titulo;
    const ctx: ToolContext = {
      conv: {
        contactId: conv.contactId,
        ticketId: conv.ticketId,
        nome: conv.nome,
        numero: conv.numero,
        driveFolderId: conv.driveFolderId,
        crmLeadId: conv.crmLeadId,
      },
      state,
      params: eff.params,
      flowNome: flow?.nome ?? '',
      rotulos,
    };
    try {
      const result = await tool.executar(ctx);
      if (result.ok && result.conv) {
        if (result.conv.driveFolderId !== undefined)
          conv.driveFolderId = result.conv.driveFolderId;
        if (result.conv.crmLeadId !== undefined)
          conv.crmLeadId = result.conv.crmLeadId;
      }
      return result;
    } catch (error) {
      this.logger.error(
        `Ferramenta ${eff.ferramenta} falhou (ticket ${conv.ticketId}): ${(error as Error).message}`,
      );
      return { ok: false, motivo: 'erro' };
    }
  }

  private async finishHandoff(
    conv: ChatbotConversation,
    input: {
      reutilizar?: boolean;
      jaAvisou?: boolean;
      flowId?: string;
      vars?: Record<string, string>;
    },
  ): Promise<void> {
    const result = await this.handoff.execute(conv, {
      ...input,
      rotulos: this.rotulosDoFluxo(input.flowId),
    });
    conv.step = 'HUMANO';
    conv.emAtendimento = true;
    conv.finalizouTriagem = true;
    conv.atendenteId = result.atendenteId ?? conv.atendenteId;
    conv.filaId = result.filaId ?? conv.filaId;
    conv.handoffError = result.error;
    conv.crmLeadId = result.crmLeadId ?? conv.crmLeadId;
    conv.flow = null;
    conv.history = []; // minimiza dados guardados depois da triagem
    await this.repo.save(conv);
  }

  private async storeFiles(
    conv: ChatbotConversation,
    files: Inbound[],
  ): Promise<void> {
    if (!conv.driveFolderId || !conv.nome) return;
    for (const file of files) {
      try {
        if (
          !file.mediaPath ||
          !isAllowedMediaUrl(file.mediaPath, this.allowedHosts)
        ) {
          this.logger.warn(
            'Mídia fora da lista de hosts permitidos — ignorada',
          );
          continue;
        }
        const media = await this.messenger.downloadMedia(
          file.mediaPath,
          this.allowedHosts,
        );
        await this.drive.saveFile(
          conv.driveFolderId,
          conv.nome,
          media.filename ?? file.body,
          media.contentType,
          media.data,
        );
      } catch (error) {
        this.logger.error(
          `Arquivo não salvo no Drive (ticket ${conv.ticketId}): ${(error as Error).message}`,
        );
      }
    }
  }

  /** Conta uma chamada de IA no teto diário do cliente. false = estourou o teto. */
  private consumeAiCall(conv: ChatbotConversation): boolean {
    const today = manausDay();
    if (conv.aiCallsDate !== today) {
      conv.aiCallsDate = today;
      conv.aiCallsDay = 0;
    }
    if (conv.aiCallsDay >= this.appConfig.chatbot.aiDailyLimit) return false;
    conv.aiCallsDay++;
    return true;
  }

  private async interpretWithAi(
    conv: ChatbotConversation,
    text: string,
  ): Promise<FlowInput> {
    if (!text) return { kind: 'invalido' };
    // Quem já estourou as advertências de fora de escopo não gasta mais IA: texto livre é ignorado.
    if ((conv.offTopicCount ?? 0) >= this.appConfig.chatbot.maxOffTopic)
      return { kind: 'fora_escopo', severidade: 'leve' };
    if (!this.agents.available) return { kind: 'invalido' };
    if (!this.consumeAiCall(conv)) return { kind: 'invalido', falhaIa: true };

    const p = runtimeContent.published;
    const state = conv.flow!;
    const node: FlowNode | null = currentNode(p, state) ?? null;
    const flow = fluxoPorId(state.flowId);
    const kb = flow?.kb?.length ? flow.kb : KNOWLEDGE_BASE;
    return this.agents.resolve(
      {
        node,
        state,
        validOptions: validOptions(p, state),
        rotulos: this.rotulosDe(node, state),
        message: text,
        history: conv.history ?? [],
      },
      kb,
      guidanceOf(flow),
    );
  }

  private pedeNome(conv: ChatbotConversation): boolean {
    const node = conv.flow
      ? currentNode(runtimeContent.published, conv.flow)
      : null;
    return (
      node?.tipo === 'pergunta' &&
      (node.validacao ?? (node.variavel === 'nome' ? 'nome' : 'texto')) ===
        'nome'
    );
  }

  /** Nome: sempre confere com a IA. Texto livre: só quando parece pergunta. */
  private conferirComIa(conv: ChatbotConversation, text: string): boolean {
    if (!this.agents.available) return false;
    if ((conv.offTopicCount ?? 0) >= this.appConfig.chatbot.maxOffTopic)
      return false;
    const node = conv.flow
      ? currentNode(runtimeContent.published, conv.flow)
      : null;
    if (node?.tipo !== 'pergunta') return false;
    return this.pedeNome(conv) || text.includes('?');
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

  // ───────────────────────── manutenção ─────────────────────────

  /** Privacidade: apaga conversas sem atividade há 90 dias. */
  @Cron('0 4 * * *')
  async cleanup(): Promise<void> {
    if (!this.enabled) return;
    const cut = new Date(Date.now() - 90 * 24 * 3600_000);
    const res = await this.repo.delete({ updatedAt: LessThan(cut) });
    await this.inbox.purge();
    if (res.affected)
      this.logger.log(`Limpeza: ${res.affected} conversa(s) antigas removidas`);
  }

  async stats() {
    const rows: Array<{ step: string; total: string }> = await this.repo
      .createQueryBuilder('c')
      .select('c.step', 'step')
      .addSelect('COUNT(*)', 'total')
      .groupBy('c.step')
      .getRawMany();
    return {
      enabled: this.enabled,
      aiEnabled: this.ai.enabled,
      aiBreakerOpen: this.ai.breakerOpen,
      agentDecisions: this.agents.counters,
      comunicacao: {
        humanizada: this.appConfig.chatbot.humanize,
        resultados: this.humanizer.counters,
        reprovacoes: this.humanizer.rejections,
      },
      crmEnabled: this.appConfig.crm.enabled,
      testMode: this.appConfig.chatbot.testMode,
      testNumbers: parseNumberList(this.appConfig.chatbot.testNumbers).length,
      model: this.appConfig.openai.model,
      conversationsByStep: Object.fromEntries(
        rows.map((r) => [r.step, Number(r.total)]),
      ),
      pendingHandoffErrors: await this.repo
        .count({ where: { handoffError: Not(IsNull()) } })
        .catch(() => 0),
    };
  }
}
