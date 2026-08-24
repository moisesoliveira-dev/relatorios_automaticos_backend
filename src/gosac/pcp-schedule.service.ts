import { Injectable } from '@nestjs/common';
import { GetPcpScheduleUseCase } from '../contexts/pcp/application/get-pcp-schedule.use-case';
import {
  AREA_LABELS,
  PcpScheduleResponse,
} from '../contexts/pcp/domain/pcp.types';

export type { PcpAreaKey, PcpAreaSchedule, PcpSalesOrderSchedule, PcpScheduleResponse } from '../contexts/pcp/domain/pcp.types';
export { AREA_LABELS };

/**
 * Adapter de apresentação (Nest): delega ao use case do bounded context PCP.
 * Mantém compatibilidade com GosacController.
 */
@Injectable()
export class PcpScheduleService {
  constructor(private readonly getPcpScheduleUseCase: GetPcpScheduleUseCase) {}

  getSchedule(query?: string, light = false): Promise<PcpScheduleResponse> {
    return this.getPcpScheduleUseCase.execute(query, light);
  }
}
