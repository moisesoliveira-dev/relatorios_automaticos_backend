import { Controller, Post, Body, HttpCode, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { GosacWebhookGuard } from './gosac-webhook.guard';
import { GosacService } from './gosac.service';
import { ChatbotService } from '../chatbot/services/chatbot.service';

/**
 * Controller para receber webhooks do GOSAC.
 * Chamado externamente pelo GOSAC; protegido por segredo compartilhado (GosacWebhookGuard).
 */
@Controller('gosac/webhook')
@UseGuards(GosacWebhookGuard)
@SkipThrottle()
export class GosacWebhookController {
    constructor(
        private readonly gosacService: GosacService,
        private readonly chatbotService: ChatbotService,
    ) { }

    /**
     * POST /api/gosac/webhook
     * Recebe notificações do GOSAC (mensagens com mídia, etc.)
     */
    @Post()
    @HttpCode(200)
    async handleWebhook(@Body() payload: any) {
        // Chatbot com IA (só age se CHATBOT_ENABLED=true; responde em segundo plano, sem atrasar o GOSAC)
        this.chatbotService.receive(payload);
        return this.gosacService.handleWebhook(payload);
    }
}
