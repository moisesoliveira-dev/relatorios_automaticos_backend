export type PcpAreaKey = 'molhada' | 'intima' | 'social';

import type { PcpAreaConfig } from './pcp-area-config';

export interface PcpAreaSchedule {
  date: string;
  environments: string[];
  conflictAdjusted: boolean;
}

export interface PcpSalesOrderSchedule {
  ponttaId: string;
  code: string;
  customerName: string;
  approvalDate: string | null;
  deliveryDate: string | null;
  areas: Partial<Record<PcpAreaKey, PcpAreaSchedule>>;
  unclassified: string[];
}

export interface PcpCalendarEntry {
  salesOrderCode: string;
  customerName: string;
  area: PcpAreaKey;
  environments: string[];
}

export interface PcpCalendarDay {
  date: string;
  entries: PcpCalendarEntry[];
}

export interface PcpScheduleResponse {
  asOf: string;
  areaConfig: PcpAreaConfig;
  salesOrders: PcpSalesOrderSchedule[];
  calendar: PcpCalendarDay[];
  environmentsPending?: boolean;
}

export interface SalesOrderSummary {
  ponttaId: string;
  code: string;
  customerName: string;
  deliveryDate: string | null;
  approvalDate: string | null;
}

export interface WorkingRow {
  ponttaId: string;
  code: string;
  customerName: string;
  baseDate: Date;
  areas: Partial<Record<PcpAreaKey, { tentative: Date; environments: string[] }>>;
  unclassified: string[];
}
