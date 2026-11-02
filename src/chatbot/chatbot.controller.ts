import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
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
  ) {}

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
    return this.admin.simulate({
      ...body,
      step: body.step as never,
      trilha: body.trilha as never,
    });
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
}
