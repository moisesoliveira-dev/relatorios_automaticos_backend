import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PonttaModule } from '../pontta/pontta.module';
import { DriveModule } from '../drive/drive.module';
import { SettingsModule } from '../settings/settings.module';
import { ChatbotConversation } from './entities/chatbot-conversation.entity';
import { ChatbotBookedSlot } from './entities/chatbot-booked-slot.entity';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './services/chatbot.service';
import { GosacMessengerService } from './services/gosac-messenger.service';
import { OpenAiService } from './services/openai.service';
import { ChatbotHandoffService } from './services/chatbot-handoff.service';
import { ChatbotRotationService } from './services/chatbot-rotation.service';
import { ChatbotDriveService } from './services/chatbot-drive.service';
import { ChatbotSchedulingService } from './services/chatbot-scheduling.service';
import { AgentOrchestrator } from './agents/agent-orchestrator.service';
import { ScopeAgent } from './agents/scope.agent';
import { InterpreterAgent } from './agents/interpreter.agent';
import { FaqAgent } from './agents/faq.agent';
import { VerifierAgent } from './agents/verifier.agent';
import { WriterAgent } from './agents/writer.agent';
import { ChatbotHumanizerService } from './services/chatbot-humanizer.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatbotConversation, ChatbotBookedSlot]),
    PonttaModule,
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
    ChatbotSchedulingService,
    AgentOrchestrator,
    ScopeAgent,
    InterpreterAgent,
    FaqAgent,
    VerifierAgent,
    WriterAgent,
    ChatbotHumanizerService,
  ],
  exports: [ChatbotService],
})
export class ChatbotModule {}
