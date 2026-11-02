import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
import { PonttaService } from '../../pontta/pontta.service';
import { MESSAGES } from '../domain/chatbot.messages';
import { fill } from '../domain/chatbot.flow';
import { HandoffMessage } from '../domain/chatbot.types';
import { ChatbotConversation } from '../entities/chatbot-conversation.entity';
import { GosacMessengerService } from './gosac-messenger.service';
import { ChatbotRotationService } from './chatbot-rotation.service';
import { ChatbotHumanizerService } from './chatbot-humanizer.service';

export interface HandoffResult {
  atendenteId: number | null;
  filaId: number | null;
  error: string | null;
}

/** Entrega o cliente a um atendente humano: rodízio → ticket no GOSAC → (opcional) negócio no Pontta. */
@Injectable()
export class ChatbotHandoffService {
  private readonly logger = new Logger(ChatbotHandoffService.name);

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly messenger: GosacMessengerService,
    private readonly rotation: ChatbotRotationService,
    private readonly pontta: PonttaService,
    private readonly humanizer: ChatbotHumanizerService,
  ) {}

  private textFor(kind: HandoffMessage, nome: string | null): string {
    switch (kind) {
      case 'agendado':
        return MESSAGES.horario_agendado;
      case 'redirecionando_com_nome':
        return nome
          ? fill(MESSAGES.redirecionando_projetistas_com_nome, { nome })
          : MESSAGES.redirecionando_projetistas;
      default:
        return MESSAGES.redirecionando_projetistas;
    }
  }

  async execute(
    conv: ChatbotConversation,
    kind: HandoffMessage,
    reutilizar = false,
    texto?: string,
    flowId?: string,
  ): Promise<HandoffResult> {
    const cfg = this.appConfig.chatbot;
    const errors: string[] = [];

    // 1) Quem atende
    let userId: number | null = null;
    let queueId: number | null = null;
    let ponttaId: string | null = null;

    if (reutilizar && conv.atendenteId) {
      userId = conv.atendenteId;
      queueId = conv.filaId;
    } else {
      const pick = await this.rotation.next();
      if (pick) {
        userId = pick.gosacUserId;
        queueId = pick.gosacQueueId;
        ponttaId = pick.ponttaId;
      } else if (cfg.fallbackGosacUserId) {
        userId = cfg.fallbackGosacUserId;
        queueId = cfg.fallbackGosacQueueId ?? null;
        this.logger.warn(
          'Rodízio indisponível — usando atendente de contingência',
        );
      } else {
        errors.push('rodízio indisponível e sem atendente de contingência');
      }
    }

    // 2) Mensagem ao cliente (falha de envio não impede a entrega do ticket)
    try {
      // Passa pelo Redator como as demais mensagens (cai no texto original se a IA falhar)
      const bubbles = await this.humanizer.compose(
        conv,
        [texto ?? this.textFor(kind, conv.nome)],
        flowId,
      );
      await this.messenger.sendTexts(conv.ticketId, bubbles);
    } catch (error) {
      errors.push(`mensagem: ${(error as Error).message}`);
    }

    // 3) Ticket vai para a fila humana ("pending")
    try {
      await this.messenger.updateTicket(conv.ticketId, {
        userId,
        queueId,
        status: 'pending',
      });
    } catch (error) {
      errors.push(`ticket: ${(error as Error).message}`);
    }

    // 4) Pontta (desligado por padrão): só roda com CHATBOT_PONTTA_ENABLED=true
    if (cfg.ponttaEnabled && ponttaId && cfg.dealWorkflowId && !reutilizar) {
      try {
        const { email, password } = this.appConfig.ponttaCredentials;
        const token = await this.pontta.authenticate(email, password);
        await this.pontta.createDeal(token, {
          title:
            conv.nome ||
            conv.contactName ||
            conv.numero ||
            `Ticket ${conv.ticketId}`,
          responsibleId: ponttaId,
          workflowId: cfg.dealWorkflowId,
          phone: conv.numero,
          email: cfg.dealFallbackEmail ?? null,
        });
      } catch (error) {
        errors.push(`pontta: ${(error as Error).message}`);
      }
    }

    if (errors.length)
      this.logger.error(
        `Handoff do ticket #${conv.ticketId} com falhas: ${errors.join(' | ')}`,
      );
    return {
      atendenteId: userId,
      filaId: queueId,
      error: errors.length ? errors.join(' | ').slice(0, 500) : null,
    };
  }
}
