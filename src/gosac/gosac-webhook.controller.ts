import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { GosacService } from './gosac.service';

/**
 * Controller para receber webhooks do GOSAC.
 * NÃO possui guards de autenticação — é chamado externamente pelo GOSAC.
 */
@Controller('gosac/webhook')
export class GosacWebhookController {
    constructor(private readonly gosacService: GosacService) { }

    /**
     * POST /api/gosac/webhook
     * Recebe notificações do GOSAC (mensagens com mídia, etc.)
     */
    @Post()
    @HttpCode(200)
    async handleWebhook(@Body() payload: any) {
        return this.gosacService.handleWebhook(payload);
    }
}
