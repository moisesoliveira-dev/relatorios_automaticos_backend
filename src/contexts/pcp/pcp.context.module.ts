import { Module } from '@nestjs/common';
import { PonttaModule } from '../../pontta/pontta.module';
import { SettingsModule } from '../../settings/settings.module';
import { GetPcpScheduleUseCase } from './application/get-pcp-schedule.use-case';
import { SALES_ORDER_PORT } from './application/ports/sales-order.port';
import { PonttaSalesOrderAdapter } from './infrastructure/adapters/pontta-sales-order.adapter';
import { PcpConfigService } from './infrastructure/pcp-config.service';
import { PcpEnvironmentOverridesService } from './infrastructure/pcp-environment-overrides.service';

/** Composition root do bounded context PCP (Clean/Hexagonal). */
@Module({
  imports: [PonttaModule, SettingsModule],
  providers: [
    GetPcpScheduleUseCase,
    PonttaSalesOrderAdapter,
    PcpConfigService,
    PcpEnvironmentOverridesService,
    {
      provide: SALES_ORDER_PORT,
      useExisting: PonttaSalesOrderAdapter,
    },
  ],
  exports: [GetPcpScheduleUseCase, PcpConfigService, PcpEnvironmentOverridesService],
})
export class PcpContextModule {}
