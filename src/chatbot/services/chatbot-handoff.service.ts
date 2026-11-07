import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
import { sistema } from '../domain/content-runtime';
import { render } from '../engine/text';
import type { Reply } from '../engine/flow.types';
import { ChatbotConversation } from '../entities/chatbot-conversation.entity';
import { GosacMessengerService } from './gosac-messenger.service';
import { ChatbotRotationService } from './chatbot-rotation.service';
import { ChatbotHumanizerService } from './chatbot-humanizer.service';
import {
  CRM_FLUXOS,
  contatoGosac,
  CrmFluxo,
  CrmFunilService,
  fluxoDaTrilha,
  linhasDaTriagem,
} from './crm-funil.service';

export interface HandoffResult {
  atendenteId: number | null;
  filaId: number | null;
  /** Lead no funil comercial (CMSYS), quando foi registrado. */
  crmLeadId: string | null;
  error: string | null;
}

export interface HandoffInput {
  /** Devolver ao mesmo atendente que já atendeu este cliente (quando houver). */
  reutilizar?: boolean;
  /** O fluxo já enviou a própria mensagem de encaminhamento: não mandar a padrão. */
  jaAvisou?: boolean;
  /** Fluxo de onde o cliente vem (jeito de falar). */
  flowId?: string;
  /** Respostas coletadas na triagem (viram o resumo no funil comercial). */
  vars?: Record<string, string>;
  /** Nome legível de cada variável (título da etapa que a perguntou). */
  rotulos?: Record<string, string>;
}

/** Entrega o cliente a um atendente humano: rodízio → ticket no GOSAC → lead no funil comercial (CMSYS). */
@Injectable()
export class ChatbotHandoffService {
  private readonly logger = new Logger(ChatbotHandoffService.name);

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly messenger: GosacMessengerService,
    private readonly rotation: ChatbotRotationService,
    private readonly crm: CrmFunilService,
    private readonly humanizer: ChatbotHumanizerService,
  ) {}

  /** Mensagem padrão de encaminhamento (com o nome, quando conhecido). */
  defaultReply(nome: string | null): Reply {
    const s = sistema();
    return nome
      ? {
          texto: render(s.redirecionando_com_nome, { nome }),
          sistema: 'redirecionando_com_nome',
        }
      : { texto: s.redirecionando, sistema: 'redirecionando' };
  }

  async execute(
    conv: ChatbotConversation,
    input: HandoffInput = {},
  ): Promise<HandoffResult> {
    const cfg = this.appConfig.chatbot;
    const errors: string[] = [];

    // 1) Quem atende
    let userId: number | null = null;
    let queueId: number | null = null;
    let atendenteNome: string | null = null;

    if (input.reutilizar && conv.atendenteId) {
      userId = conv.atendenteId;
      queueId = conv.filaId;
    } else {
      const pick = await this.rotation.next();
      if (pick) {
        userId = pick.gosacUserId;
        queueId = pick.gosacQueueId;
        atendenteNome = pick.name;
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
    if (!input.jaAvisou) {
      try {
        const bubbles = await this.humanizer.compose(
          {
            contactId: conv.contactId,
            nome: conv.nome,
            history: conv.history ?? [],
          },
          [this.defaultReply(conv.nome)],
          input.flowId,
        );
        await this.messenger.sendTexts(conv.ticketId, bubbles);
      } catch (error) {
        errors.push(`mensagem: ${(error as Error).message}`);
      }
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

    // 4) Funil comercial do CMSYS: falha aqui nunca impede a entrega
    let crmLeadId: string | null = conv.crmLeadId ?? null;
    if (this.crm.enabled) {
      try {
        crmLeadId = await this.registrarNoFunil(
          conv,
          input,
          input.reutilizar ? null : atendenteNome,
          errors,
        );
      } catch (error) {
        errors.push(`funil: ${(error as Error).message}`);
      }
    }

    if (errors.length)
      this.logger.error(
        `Handoff do ticket #${conv.ticketId} com falhas: ${errors.join(' | ')}`,
      );
    return {
      atendenteId: userId,
      filaId: queueId,
      crmLeadId,
      error: errors.length ? errors.join(' | ').slice(0, 500) : null,
    };
  }

  /**
   * Cria (ou atualiza, sem duplicar) o lead do cliente, define o consultor pelo atendente do rodízio,
   * grava o que ele respondeu e anota o resumo da triagem no histórico.
   */
  private async registrarNoFunil(
    conv: ChatbotConversation,
    input: HandoffInput,
    atendente: string | null,
    errors: string[],
  ): Promise<string> {
    const vars = input.vars ?? {};
    const linhas = linhasDaTriagem(vars, input.rotulos);
    const auto = fluxoDaTrilha(
      vars['trilha'],
      this.appConfig.crm.fluxo as CrmFluxo,
    );
    const fluxo = CRM_FLUXOS.includes(auto.fluxo) ? auto.fluxo : '2.2';
    const lead = await this.crm.registrar({
      contato: contatoGosac(conv.numero, conv.contactId),
      nome:
        (vars['nome'] || conv.nome || conv.contactName || '').trim() ||
        `Cliente ${conv.numero ?? conv.ticketId}`,
      telefone: conv.numero,
      fluxo,
      fluxoProvisorio: auto.provisorio,
      atendente,
      atendimento: String(conv.ticketId),
      conversa: linhas.join('; ').slice(0, 300) || undefined,
    });

    // Passos complementares: se algum falhar o lead já existe, então só registramos o aviso.
    const ambientes = vars['ambientes']?.trim();
    if (ambientes) {
      await this.crm
        .editar(lead.id, { ambientes: ambientes.slice(0, 200) })
        .catch((e: Error) => errors.push(`funil/cadastro: ${e.message}`));
    }
    if (linhas.length && !input.reutilizar) {
      await this.crm
        .nota(
          lead.id,
          `Triagem pelo chatbot (ticket #${conv.ticketId}):\n${linhas.map((l) => `- ${l}`).join('\n')}`,
        )
        .catch((e: Error) => errors.push(`funil/nota: ${e.message}`));
    }
    return lead.id;
  }
}
