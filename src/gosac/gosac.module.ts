import { Module } from '@nestjs/common';
import { GosacService } from './gosac.service';
import { GosacWebhookController } from './gosac-webhook.controller';
import { DriveModule } from '../drive/drive.module';
import { ChatbotModule } from '../chatbot/chatbot.module';

@Module({
    imports: [DriveModule, ChatbotModule],
    controllers: [GosacWebhookController],
    providers: [GosacService],
    exports: [GosacService, DriveModule],
})
export class GosacModule { }
