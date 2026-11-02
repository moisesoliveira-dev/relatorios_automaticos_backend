import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GosacService } from './gosac.service';
import { GosacController } from './gosac.controller';
import { GosacWebhookController } from './gosac-webhook.controller';
import { GosacGroup } from './entities/gosac-group.entity';
import { PonttaSalesOrder } from './entities/pontta-sales-order.entity';
import { GosacSalesOrderLink } from './entities/gosac-sales-order-link.entity';
import { PonttaModule } from '../pontta/pontta.module';
import { SettingsModule } from '../settings/settings.module';
import { MontadorPdfService } from './montador-pdf.service';
import { DriveModule } from '../drive/drive.module';
import { PcpScheduleService } from './pcp-schedule.service';
import { PcpContextModule } from '../contexts/pcp/pcp.context.module';
import { ChatbotModule } from '../chatbot/chatbot.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([GosacGroup, PonttaSalesOrder, GosacSalesOrderLink]),
        PonttaModule,
        SettingsModule,
        PcpContextModule,
        DriveModule,
        ChatbotModule,
    ],
    controllers: [GosacController, GosacWebhookController],
    providers: [GosacService, MontadorPdfService, PcpScheduleService],
    exports: [GosacService, DriveModule],
})
export class GosacModule { }
