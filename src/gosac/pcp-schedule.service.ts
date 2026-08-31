import { Injectable } from '@nestjs/common';
import { GetPcpScheduleUseCase } from '../contexts/pcp/application/get-pcp-schedule.use-case';
import { PcpAreaConfig } from '../contexts/pcp/domain/pcp-area-config';
import { PcpScheduleResponse } from '../contexts/pcp/domain/pcp.types';
import { PcpConfigService } from '../contexts/pcp/infrastructure/pcp-config.service';

export type { PcpAreaKey, PcpAreaSchedule, PcpSalesOrderSchedule, PcpScheduleResponse } from '../contexts/pcp/domain/pcp.types';
export type { PcpAreaConfig, PcpAreaConfigItem } from '../contexts/pcp/domain/pcp-area-config';

/** Adapter de apresentação (Nest): delega ao use case do bounded context PCP. */
@Injectable()
export class PcpScheduleService {
  constructor(
    private readonly getPcpScheduleUseCase: GetPcpScheduleUseCase,
    private readonly pcpConfigService: PcpConfigService,
  ) {}

  getSchedule(query?: string, light = false): Promise<PcpScheduleResponse> {
    return this.getPcpScheduleUseCase.execute(query, light);
  }

  getConfig(): Promise<PcpAreaConfig> {
    return this.pcpConfigService.getConfig();
  }

  saveConfig(config: PcpAreaConfig): Promise<PcpAreaConfig> {
    return this.pcpConfigService.saveConfig(config);
  }
}
