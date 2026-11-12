import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TabsGuard } from '../auth/guards/tabs.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Tabs } from '../auth/decorators/tabs.decorator';
import { UserRole } from '../users/entities/user.entity';
import { ChatbotService } from './services/chatbot.service';
import { ChatbotAdminService } from './services/chatbot-admin.service';
import { ChatbotContentService } from './services/chatbot-content.service';
import { AiUsageService, emTeste } from './services/ai-usage.service';
import { ChatbotRuntimeConfigService } from './services/chatbot-runtime-config.service';
import { ListConversationsDto, SimulateDto } from './dto/admin.dto';
import { ToolRegistry } from './tools/tool.registry';
import type { FlowState } from './engine/flow.types';

/** Painel de operação da IA. Só master/admin com a aba "ia". */
@Controller('chatbot')
@UseGuards(JwtAuthGuard, RolesGuard, TabsGuard)
@Roles(UserRole.MASTER, UserRole.ADMIN)
@Tabs('ia')
export class ChatbotController {
  constructor(
    private readonly chatbot: ChatbotService,
    private readonly admin: ChatbotAdminService,
    private readonly config: ChatbotRuntimeConfigService,
    private readonly content: ChatbotContentService,
    private readonly tools: ToolRegistry,
    private readonly usage: AiUsageService,
  ) {}

  private who(req: { user?: { email?: string } }): string | null {
    return req.user?.email ?? null;
  }

  /** Estado do sistema (liga/desliga, IA, disjuntor, decisões dos agentes). */
  @Get('status')
  @SkipThrottle()
  status() {
    return this.chatbot.stats();
  }

  @Get('overview')
  @SkipThrottle()
  overview() {
    return this.admin.overview();
  }

  @Get('conversations')
  @SkipThrottle()
  list(@Query() q: ListConversationsDto) {
    return this.admin.list(q);
  }

  @Get('conversations/:id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.detail(id);
  }

  @Post('conversations/:id/silenciar')
  silenciar(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.silenciar(id);
  }

  @Post('conversations/:id/devolver-ao-bot')
  devolver(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.devolverAoBot(id);
  }

  @Post('simulate')
  simulate(@Body() body: SimulateDto) {
    return emTeste(() => this.admin.converse(body));
  }

  /** Fluxos publicados, tipos de etapa, ferramentas e mensagens do sistema (para a tela). */
  @Get('catalog')
  @SkipThrottle()
  catalog() {
    return this.admin.catalog();
  }

  /** Ferramentas disponíveis para os fluxos (com parâmetros e pré-requisitos). */
  @Get('tools')
  @SkipThrottle()
  listTools() {
    return this.tools.describe();
  }

  @Get('config')
  @SkipThrottle()
  getConfig() {
    return this.config.describe();
  }

  @Put('config')
  saveConfig(@Body() body: { values: Record<string, unknown> }) {
    return this.config.save(body?.values);
  }

  // ───────── conteúdo editável (fluxos, mensagens do sistema, base, jeito de falar) ─────────

  @Get('content')
  @SkipThrottle()
  getContent() {
    return this.content.get();
  }

  @Put('content/draft')
  saveDraft(@Body() body: unknown, @Req() req: { user?: { email?: string } }) {
    return this.content.saveDraft(body, this.who(req));
  }

  @Delete('content/draft')
  discardDraft() {
    return this.content.discardDraft();
  }

  /** Prévia de um fluxo do rascunho: roda sem enviar nada (ferramentas em modo simulado). */
  @Post('content/flows/preview')
  @SkipThrottle()
  previewFlow(
    @Body()
    body: {
      fluxos: unknown;
      fluxoId: string;
      estado: FlowState | null;
      texto?: string;
      usarIA?: boolean;
      conversa?: Array<{ role: 'cliente' | 'bot'; text: string }>;
    },
  ) {
    return this.content.previewFlow(body);
  }

  // ───────── gastos com a OpenAI ─────────

  /** Consumo e custo estimado no período (origem: cliente, teste ou todas). */
  @Get('usage')
  @SkipThrottle()
  usageSummary(@Query('dias') dias?: string, @Query('origem') origem?: string) {
    return this.usage.resumo(
      Number(dias) || 30,
      origem === 'teste' || origem === 'todas' ? origem : 'cliente',
    );
  }

  /** Corrige a cotação do dólar e os preços por modelo (por 1 milhão de tokens, em dólares). */
  @Put('usage/prices')
  async saveUsagePrices(
    @Body()
    body: {
      cotacao?: number;
      precos?: Record<
        string,
        { entrada: number; cache: number; saida: number }
      >;
    },
  ) {
    await this.usage.salvarPrecos(body ?? {});
    return this.usage.resumo(30);
  }

  @Post('content/publish')
  publish(@Req() req: { user?: { email?: string } }) {
    return this.content.publish(this.who(req));
  }

  @Post('content/rollback')
  rollback(@Req() req: { user?: { email?: string } }) {
    return this.content.rollback(this.who(req));
  }
}
