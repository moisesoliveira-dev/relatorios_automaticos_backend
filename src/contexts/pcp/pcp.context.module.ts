import { Module } from '@nestjs/common';
import { PonttaModule } from '../../pontta/pontta.module';
import { GetPcpScheduleUseCase } from './application/get-pcp-schedule.use-case';
import { SALES_ORDER_PORT } from './application/ports/sales-order.port';
import { PonttaSalesOrderAdapter } from './infrastructure/adapters/pontta-sales-order.adapter';

/** Composition root do bounded context PCP (Clean/Hexagonal). */
@Module({
  imports: [PonttaModule],
  providers: [
    GetPcpScheduleUseCase,
    PonttaSalesOrderAdapter,
    {
      provide: SALES_ORDER_PORT,
      useExisting: PonttaSalesOrderAdapter,
    },
  ],
  exports: [GetPcpScheduleUseCase],
})
export class PcpContextModule {}
