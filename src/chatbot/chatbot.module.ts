import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DriveModule } from '../drive/drive.module';
import { SettingsModule } from '../settings/settings.module';
import { ChatbotConversation } from './entities/chatbot-conversation.entity';
import { ChatbotInboxMessage } from './entities/chatbot-inbox-message.entity';
import { ChatbotInboxService } from './services/chatbot-inbox.service';
import { ChatbotLockService } from './services/chatbot-lock.service';
import { ChatbotAdminService } from './services/chatbot-admin.service';
import { ChatbotContentService } from './services/chatbot-content.service';
import { ChatbotRuntimeConfigService } from './services/chatbot-runtime-config.service';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './services/chatbot.service';
import { GosacMessengerService } from './services/gosac-messenger.service';
import { OpenAiService } from './services/openai.service';
import { ChatbotHandoffService } from './services/chatbot-handoff.service';
import { ChatbotRotationService } from './services/chatbot-rotation.service';
import { ChatbotDriveService } from './services/chatbot-drive.service';
import { CrmFunilService } from './services/crm-funil.service';
import { AgentOrchestrator } from './agents/agent-orchestrator.service';
import { ScopeAgent } from './agents/scope.agent';
import { InterpreterAgent } from './agents/interpreter.agent';
import { FaqAgent } from './agents/faq.agent';
import { VerifierAgent } from './agents/verifier.agent';
import { WriterAgent } from './agents/writer.agent';
import { AttendantAgent } from './agents/attendant.agent';
import { ChatbotHumanizerService } from './services/chatbot-humanizer.service';
import { ToolRegistry } from './tools/tool.registry';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatbotConversation, ChatbotInboxMessage]),
    DriveModule,
    SettingsModule,
  ],
  controllers: [ChatbotController],
  providers: [
    ChatbotService,
    GosacMessengerService,
    OpenAiService,
    ChatbotHandoffService,
    ChatbotRotationService,
    ChatbotDriveService,
    CrmFunilService,
    ChatbotInboxService,
    ChatbotLockService,
    ChatbotAdminService,
    ChatbotRuntimeConfigService,
    ChatbotContentService,
    AgentOrchestrator,
    ScopeAgent,
    InterpreterAgent,
    FaqAgent,
    VerifierAgent,
    WriterAgent,
    AttendantAgent,
    ChatbotHumanizerService,
    ToolRegistry,
  ],
  exports: [ChatbotService, ToolRegistry],
})
export class ChatbotModule {}
