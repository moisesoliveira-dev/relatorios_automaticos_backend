export type PcpAreaKey = 'molhada' | 'intima' | 'social';

export interface PcpAreaSchedule {
  date: string;
  environments: string[];
  conflictAdjusted: boolean;
}

export interface PcpSalesOrderSchedule {
  ponttaId: string;
  code: string;
  customerName: string;
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
  salesOrders: PcpSalesOrderSchedule[];
  calendar: PcpCalendarDay[];
  environmentsPending?: boolean;
}

export const AREA_OFFSETS: Record<PcpAreaKey, number> = {
  molhada: 20,
  intima: 25,
  social: 30,
};

export const AREA_LABELS: Record<PcpAreaKey, string> = {
  molhada: 'Áreas Molhadas',
  intima: 'Áreas Íntimas',
  social: 'Áreas Sociais',
};

export interface SalesOrderSummary {
  ponttaId: string;
  code: string;
  customerName: string;
  deliveryDate: string | null;
}

export interface WorkingRow {
  ponttaId: string;
  code: string;
  customerName: string;
  deliveryDate: Date;
  areas: Partial<Record<PcpAreaKey, { tentative: Date; environments: string[] }>>;
  unclassified: string[];
}
