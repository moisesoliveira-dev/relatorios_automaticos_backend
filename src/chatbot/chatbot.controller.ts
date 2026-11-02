import { Controller, Get, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TabsGuard } from '../auth/guards/tabs.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Tabs } from '../auth/decorators/tabs.decorator';
import { UserRole } from '../users/entities/user.entity';
import { ChatbotService } from './services/chatbot.service';

@Controller('chatbot')
@UseGuards(JwtAuthGuard, RolesGuard, TabsGuard)
export class ChatbotController {
  constructor(private readonly chatbot: ChatbotService) {}

  /** Painel rápido: está ligado? IA ativa? quantas conversas por etapa? */
  @Get('status')
  @Roles(UserRole.MASTER, UserRole.ADMIN)
  @Tabs('configuracoes')
  @SkipThrottle()
  status() {
    return this.chatbot.stats();
  }
}
