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

@Module({
    imports: [
        TypeOrmModule.forFeature([GosacGroup, PonttaSalesOrder, GosacSalesOrderLink]),
        PonttaModule,
        SettingsModule,
    ],
    controllers: [GosacController, GosacWebhookController],
    providers: [GosacService],
    exports: [GosacService],
})
export class GosacModule { }
