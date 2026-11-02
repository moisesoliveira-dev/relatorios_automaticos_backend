import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Delete,
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
import { ChatbotRuntimeConfigService } from './services/chatbot-runtime-config.service';
import { ListConversationsDto, SimulateDto } from './dto/admin.dto';

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
    return this.admin.converse(body);
  }

  @Get('catalog')
  @SkipThrottle()
  catalog() {
    return this.admin.catalog();
  }

  @Get('config')
  @SkipThrottle()
  getConfig() {
    return this.config.describe();
  }

  @Put('config')
  saveConfig(@Body() body: { values: Record<string, unknown> }) {
    return this.config.save(body?.values as Record<string, unknown>);
  }

  // ───────── conteúdo editável (mensagens, base, ambientes, guia da IA) ─────────

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

  @Post('content/flows/preview')
  @SkipThrottle()
  previewFlow(@Body() body: { fluxo: unknown; estado: unknown; texto?: string }) {
    return this.content.previewFlow(body as never);
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
