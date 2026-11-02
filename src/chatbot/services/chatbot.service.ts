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
import { MESSAGES } from '../domain/chatbot.messages';
import { fluxoDaOpcao, fluxoPorId } from '../domain/content-runtime';
import { CustomResult, startFlow, stepFlow } from '../domain/custom-flow';
import { decide, restartDecision } from '../domain/chatbot.flow';
import { parseInput } from '../domain/input-parser';
import { renderSlotList } from '../domain/scheduling';
import {
  Decision,
  Effect,
  FlowInput,
  FlowState,
  INITIAL_FLOW_STATE,
} from '../domain/chatbot.types';
import {
  ChatbotConversation,
  HistoryTurn,
} from '../entities/chatbot-conversation.entity';
import { ChatbotBookedSlot } from '../entities/chatbot-booked-slot.entity';
import { GosacMessengerService } from './gosac-messenger.service';
import { OpenAiService } from './openai.service';
import { AgentOrchestrator } from '../agents/agent-orchestrator.service';
import { ChatbotHandoffService } from './chatbot-handoff.service';
import { ChatbotHumanizerService } from './chatbot-humanizer.service';
import { ChatbotDriveService } from './chatbot-drive.service';
import { ChatbotSchedulingService } from './chatbot-scheduling.service';
import { ChatbotInboxService, PendingMessage } from './chatbot-inbox.service';
import { ChatbotLockService } from './chatbot-lock.service';

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
  timer?: NodeJS.Timeout;
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
    @InjectRepository(ChatbotBookedSlot)
    private readonly booked: Repository<ChatbotBookedSlot>,
    private readonly messenger: GosacMessengerService,
    private readonly ai: OpenAiService,
    private readonly agents: AgentOrchestrator,
    private readonly humanizer: ChatbotHumanizerService,
    private readonly handoff: ChatbotHandoffService,
    private readonly drive: ChatbotDriveService,
    private readonly scheduling: ChatbotSchedulingService,
    private readonly inbox: ChatbotInboxService,
    private readonly lock: ChatbotLockService,
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

  /** Chamado pelo webhook. Nunca lança e nunca bloqueia a resposta HTTP. */
  receive(payload: unknown): void {
    if (!this.enabled) return;
    try {
      const msg = parseWebhook(payload);
      if (!msg || msg.isGroup) return;
      if (msg.mediaType && IGNORED_MEDIA.has(msg.mediaType)) return;

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
      // Outra instância está atendendo este cliente e vai esvaziar a fila; confere de novo em instantes.
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
          // Marca como feito mesmo se falhou: evita repetir para sempre uma mensagem problemática
          // (o onError já entrega o cliente a um humano na segunda falha seguida).
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
    // Falhas repetidas: não deixa o cliente preso — entrega a um humano.
    if (n >= 2) {
      this.errorCount.delete(contactId);
      const conv = await this.repo
        .findOne({ where: { contactId } })
        .catch(() => null);
      if (conv && conv.step !== 'HUMANO')
        await this.finishHandoff(conv, 'redirecionando').catch(() => undefined);
    }
  }

  // ───────────────────────── regras de conversa ─────────────────────────

  private async markHumanActive(msg: Inbound): Promise<void> {
    const conv =
      (await this.repo.findOne({ where: { contactId: msg.contactId } })) ??
      this.newConversation(msg);
    conv.ticketId = msg.ticketId;
    conv.step = 'HUMANO';
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
      ...INITIAL_FLOW_STATE,
      categorias: [],
      slots: null,
      emAtendimento: false,
      finalizouTriagem: false,
      history: [],
      processedIds: [],
      lastMessageAt: new Date(),
    });
  }

  private flowOf(conv: ChatbotConversation): FlowState {
    return {
      step: conv.step,
      trilha: conv.trilha,
      nome: conv.nome,
      nomePendente: conv.nomePendente,
      local: conv.local,
      categorias: conv.categorias ?? [],
      arquivos: conv.arquivos,
      invalidCount: conv.invalidCount,
      slots: conv.slots,
      offTopicCount: conv.offTopicCount ?? 0,
      custom: conv.custom ?? null,
    };
  }

  private applyPatch(
    conv: ChatbotConversation,
    patch: Partial<FlowState>,
  ): void {
    Object.assign(conv, patch);
  }

  private async send(
    conv: ChatbotConversation,
    texts: string[],
  ): Promise<void> {
    if (!texts.length) return;
    const bubbles = await this.humanizer.compose(conv, texts);
    await this.messenger.sendTexts(conv.ticketId, bubbles);
    this.pushHistory(conv, { role: 'bot', text: clip(bubbles.join(' ')) });
  }

  private pushHistory(conv: ChatbotConversation, turn: HistoryTurn): void {
    conv.history = [...(conv.history ?? []), turn].slice(-8);
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
      await this.send(conv, [MESSAGES.menu_inicial]);
      await this.repo.save(conv);
      return;
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
      if (conv.finalizouTriagem) {
        this.applyPatch(conv, {
          ...INITIAL_FLOW_STATE,
          categorias: [],
          step: 'RECONHECIMENTO',
        });
        conv.emAtendimento = false;
        await this.repo.save(conv);
        await this.send(conv, [MESSAGES.reconhecimento]);
      } else {
        this.applyPatch(conv, { ...INITIAL_FLOW_STATE, categorias: [] });
        conv.emAtendimento = false;
        await this.repo.save(conv);
        await this.send(conv, [MESSAGES.menu_inicial]);
      }
      await this.repo.save(conv);
      return;
    }

    // 3) Atendimento humano em andamento: bot em silêncio, salvo ociosidade longa
    if (conv.step === 'HUMANO') {
      const idleMs = now.getTime() - new Date(previousActivity).getTime();
      if (idleMs > this.appConfig.chatbot.humanIdleMinutes * 60_000) {
        const d = restartDecision();
        this.applyPatch(conv, d.patch);
        conv.emAtendimento = false;
        conv.finalizouTriagem = false;
        conv.driveFolderId = null;
        await this.repo.save(conv);
        await this.send(conv, [MESSAGES.reinicio_por_pausa, ...d.replies]);
      }
      await this.repo.save(conv);
      return;
    }

    // 4) Áudio sem texto
    const text = batch.texts.join(' ').trim();
    if (batch.audio && !text && !batch.files.length) {
      await this.repo.save(conv);
      await this.send(conv, [MESSAGES.audio_nao_suportado]);
      await this.repo.save(conv);
      return;
    }

    // 5) Arquivos recebidos vão para a pasta do cliente
    if (batch.files.length) await this.storeFiles(conv, batch.files);

    // 6) Interpretação → regras
    const state = this.flowOf(conv);
    const hasFile = batch.files.length > 0;

    // 6a) Dentro de um fluxo personalizado: o motor do fluxo decide (sem IA)
    if (state.step === 'CUSTOM') {
      if (text) this.pushHistory(conv, { role: 'cliente', text: clip(text) });
      const flow = state.custom ? fluxoPorId(state.custom.flowId) : undefined;
      if (!flow || !flow.ativo || !state.custom) {
        // O fluxo foi desativado/removido no meio da conversa: volta ao menu.
        return this.apply(conv, restartDecision());
      }
      const r = stepFlow(
        flow,
        state.custom,
        { text, hasFile },
        {
          maxInvalid: this.appConfig.chatbot.maxInvalid,
        },
      );
      return this.apply(conv, this.customDecision(conv, r));
    }

    let input: FlowInput | null = parseInput(state, text, hasFile);
    if (input === null) input = await this.interpretWithAi(conv, state, text);

    if (text) this.pushHistory(conv, { role: 'cliente', text: clip(text) });

    // 6b) Opção do menu que abre um fluxo personalizado
    if (state.step === 'MENU' && input.kind === 'option') {
      const flow = fluxoDaOpcao(input.value);
      if (flow)
        return this.apply(
          conv,
          this.customDecision(conv, startFlow(flow, conv.nome)),
        );
    }

    const decision = decide(state, input, {
      maxInvalid: this.appConfig.chatbot.maxInvalid,
      scheduling: this.appConfig.chatbot.ponttaEnabled,
      maxOffTopic: this.appConfig.chatbot.maxOffTopic,
    });
    await this.apply(conv, decision);
  }

  /** Converte o resultado do motor de fluxo personalizado numa Decision do motor principal. */
  private customDecision(conv: ChatbotConversation, r: CustomResult): Decision {
    const effects: Effect[] = r.effects.map((e) =>
      e.type === 'handoff'
        ? {
            type: 'handoff',
            mensagem: e.comNome ? 'redirecionando_com_nome' : 'redirecionando',
            texto: e.texto,
          }
        : e,
    );
    const nome = r.nome ? { nome: r.nome } : {};
    if (r.state)
      return {
        patch: { step: 'CUSTOM', custom: r.state, invalidCount: 0, ...nome },
        replies: r.replies,
        effects,
      };
    if (r.saiu === 'encaminhado')
      return { patch: { custom: null, ...nome }, replies: r.replies, effects };
    // Voltou ao menu. Se houve ações (ex.: criar pasta), o nome precisa sobreviver até elas rodarem.
    const d = restartDecision();
    return {
      patch: {
        ...d.patch,
        ...(effects.length ? { nome: r.nome ?? conv.nome ?? null } : {}),
      },
      replies: [...r.replies, ...d.replies],
      effects,
    };
  }

  private remember(conv: ChatbotConversation, msg: Inbound): void {
    if (!msg.messageId) return;
    conv.processedIds = [...(conv.processedIds ?? []), msg.messageId].slice(
      -MAX_PROCESSED_IDS,
    );
  }

  /** Aplica o novo estado, envia os textos e executa os efeitos externos. */
  private async apply(
    conv: ChatbotConversation,
    decision: Decision,
  ): Promise<void> {
    this.applyPatch(conv, decision.patch);
    await this.repo.save(conv); // persiste ANTES de enviar: um reenvio do webhook não repete a resposta
    await this.send(conv, decision.replies);
    for (const effect of decision.effects) await this.runEffect(conv, effect);
    await this.repo.save(conv);
  }

  private async runEffect(
    conv: ChatbotConversation,
    effect: Effect,
  ): Promise<void> {
    switch (effect.type) {
      case 'criar_pasta':
        try {
          if (conv.nome)
            conv.driveFolderId = await this.drive.ensureClientFolder(
              conv.ticketId,
              conv.nome,
            );
        } catch (error) {
          this.logger.error(
            `Pasta do cliente não criada (ticket ${conv.ticketId}): ${(error as Error).message}`,
          );
        }
        return;

      case 'salvar_preferencias':
        try {
          if (conv.driveFolderId && conv.nome)
            await this.drive.savePreferences(
              conv.driveFolderId,
              conv.nome,
              conv.categorias,
            );
        } catch (error) {
          this.logger.error(
            `Preferências não salvas (ticket ${conv.ticketId}): ${(error as Error).message}`,
          );
        }
        return;

      case 'oferecer_horarios':
        return this.offerSlots(conv);

      case 'agendar':
        return this.bookSlot(conv, effect.slotIndex);

      case 'salvar_respostas':
        try {
          if (conv.driveFolderId && conv.nome)
            await this.drive.saveAnswers(
              conv.driveFolderId,
              conv.nome,
              effect.titulo,
              effect.itens,
            );
        } catch (error) {
          this.logger.error(
            `Respostas não salvas (ticket ${conv.ticketId}): ${(error as Error).message}`,
          );
        }
        return;

      case 'handoff':
        return this.finishHandoff(
          conv,
          effect.mensagem,
          effect.reutilizarAtendente,
          effect.texto,
        );
    }
  }

  private async offerSlots(conv: ChatbotConversation): Promise<void> {
    try {
      const slots = await this.scheduling.offer();
      if (!slots.length)
        return this.finishHandoff(
          conv,
          conv.nome ? 'redirecionando_com_nome' : 'redirecionando',
        );
      conv.slots = slots;
      conv.step = 'HORARIO';
      await this.repo.save(conv);
      await this.send(conv, [renderSlotList(MESSAGES.escolher_horario, slots)]);
    } catch (error) {
      this.logger.error(`Agenda indisponível: ${(error as Error).message}`);
      return this.finishHandoff(
        conv,
        conv.nome ? 'redirecionando_com_nome' : 'redirecionando',
      );
    }
  }

  private async bookSlot(
    conv: ChatbotConversation,
    index: number,
  ): Promise<void> {
    const slot = conv.slots?.[index];
    if (!slot) return this.offerSlots(conv);
    try {
      const note = `Precisa entrar em contato com ${conv.nome ?? 'o cliente'} do número: ${conv.numero ?? 'não informado'}, para saber a localização da medição e substituir esta mensagem.`;
      const ok = await this.scheduling.book(slot, conv.contactId, note);
      if (!ok) {
        await this.send(conv, [MESSAGES.horario_indisponivel]);
        return this.offerSlots(conv);
      }
      conv.agendamentoStart = new Date(slot.startUtc);
      await this.finishHandoff(conv, 'agendado');
    } catch {
      return this.finishHandoff(
        conv,
        conv.nome ? 'redirecionando_com_nome' : 'redirecionando',
      );
    }
  }

  private async finishHandoff(
    conv: ChatbotConversation,
    kind: Parameters<ChatbotHandoffService['execute']>[1],
    reutilizar = false,
    texto?: string,
  ): Promise<void> {
    const result = await this.handoff.execute(conv, kind, reutilizar, texto);
    conv.step = 'HUMANO';
    conv.emAtendimento = true;
    conv.finalizouTriagem = true;
    conv.atendenteId = result.atendenteId ?? conv.atendenteId;
    conv.filaId = result.filaId ?? conv.filaId;
    conv.handoffError = result.error;
    conv.slots = null;
    conv.custom = null;
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

  private async interpretWithAi(
    conv: ChatbotConversation,
    state: FlowState,
    text: string,
  ): Promise<FlowInput> {
    if (!text) return { kind: 'invalid' };

    // Quem já estourou as advertências de fora de escopo não gasta mais IA: texto livre é ignorado.
    if ((conv.offTopicCount ?? 0) >= this.appConfig.chatbot.maxOffTopic) {
      return { kind: 'fora_escopo', severidade: 'leve' };
    }

    // Teto diário de mensagens interpretadas por IA, por cliente (controle de custo / abuso)
    const today = new Date(Date.now() - 4 * 3600_000)
      .toISOString()
      .slice(0, 10);
    if (conv.aiCallsDate !== today) {
      conv.aiCallsDate = today;
      conv.aiCallsDay = 0;
    }
    if (conv.aiCallsDay >= this.appConfig.chatbot.aiDailyLimit) {
      return { kind: 'invalid' };
    }
    if (this.agents.available) conv.aiCallsDay++;

    return this.agents.resolve({
      state,
      message: text,
      history: conv.history ?? [],
    });
  }

  // ───────────────────────── manutenção ─────────────────────────

  /** Privacidade: apaga conversas sem atividade há 90 dias e reservas de horário antigas. */
  @Cron('0 4 * * *')
  async cleanup(): Promise<void> {
    if (!this.enabled) return;
    const cut = new Date(Date.now() - 90 * 24 * 3600_000);
    const res = await this.repo.delete({ updatedAt: LessThan(cut) });
    await this.scheduling.cleanup();
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
      ponttaEnabled: this.appConfig.chatbot.ponttaEnabled,
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
