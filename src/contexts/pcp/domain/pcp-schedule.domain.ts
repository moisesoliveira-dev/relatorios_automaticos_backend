import {
  PcpAreaKey,
  PcpAreaSchedule,
  PcpCalendarDay,
  PcpCalendarEntry,
  PcpSalesOrderSchedule,
  WorkingRow,
} from './pcp.types';

export function addBusinessDays(baseDate: Date, businessDays: number): Date {
  const result = new Date(baseDate);
  result.setHours(0, 0, 0, 0);

  let added = 0;
  while (added < businessDays) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) {
      added += 1;
    }
  }

  return result;
}

export function adjustToTueThuFri(baseDate: Date): Date {
  const result = new Date(baseDate);
  result.setHours(0, 0, 0, 0);

  while (![2, 4, 5].includes(result.getDay())) {
    result.setDate(result.getDate() + 1);
  }

  return result;
}

function nextDeliveryDay(from: Date): Date {
  const result = new Date(from);
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() + 1);
  return adjustToTueThuFri(result);
}

export function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function todayLocal(): Date {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

/** Ordena códigos de PV (ex.: PV-CM-646) pelo número do pedido. */
export function compareSalesOrderCodes(a: string, b: string): number {
  const na = parseSalesOrderCodeNumber(a);
  const nb = parseSalesOrderCodeNumber(b);
  if (na !== null && nb !== null && na !== nb) return na - nb;
  return a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' });
}

function parseSalesOrderCodeNumber(code: string): number | null {
  const match = String(code || '').trim().match(/(\d+)\s*$/);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Domain service: resolve conflitos de entrega por área entre pedidos. */
export class PcpConflictResolver {
  resolve(rows: WorkingRow[], areaKeys: PcpAreaKey[]): PcpSalesOrderSchedule[] {
    const occupied = Object.fromEntries(areaKeys.map((k) => [k, new Set<string>()])) as Record<PcpAreaKey, Set<string>>;

    const assignedDates = new Map<string, Partial<Record<PcpAreaKey, { date: Date; conflictAdjusted: boolean; environments: string[] }>>>();

    for (const area of areaKeys) {
      const candidates = rows
        .filter((r) => r.areas[area])
        .map((r) => ({
          row: r,
          tentative: r.areas[area]!.tentative,
          environments: r.areas[area]!.environments,
        }))
        .sort((a, b) => {
          const t = a.tentative.getTime() - b.tentative.getTime();
          if (t !== 0) return t;
          const d = a.row.baseDate.getTime() - b.row.baseDate.getTime();
          if (d !== 0) return d;
          return compareSalesOrderCodes(a.row.code, b.row.code);
        });

      for (const candidate of candidates) {
        let date = new Date(candidate.tentative);
        let conflictAdjusted = false;

        while (occupied[area].has(toDateString(date))) {
          date = nextDeliveryDay(date);
          conflictAdjusted = true;
        }

        occupied[area].add(toDateString(date));

        if (!assignedDates.has(candidate.row.ponttaId)) {
          assignedDates.set(candidate.row.ponttaId, {});
        }
        assignedDates.get(candidate.row.ponttaId)![area] = {
          date,
          conflictAdjusted,
          environments: candidate.environments,
        };
      }
    }

    return rows
      .map((row) => {
        const assigned = assignedDates.get(row.ponttaId) || {};
        const areas: Partial<Record<PcpAreaKey, PcpAreaSchedule>> = {};
        for (const key of Object.keys(assigned) as PcpAreaKey[]) {
          const a = assigned[key]!;
          areas[key] = {
            date: toDateString(a.date),
            environments: a.environments,
            conflictAdjusted: a.conflictAdjusted,
          };
        }
        return {
          ponttaId: row.ponttaId,
          code: row.code,
          customerName: row.customerName,
          approvalDate: toDateString(row.baseDate),
          deliveryDate: null,
          areas,
          unclassified: row.unclassified,
        };
      })
      .sort((a, b) => compareSalesOrderCodes(a.code, b.code));
  }

  buildCalendar(orders: PcpSalesOrderSchedule[], areaKeys: PcpAreaKey[]): PcpCalendarDay[] {
    const byDate = new Map<string, PcpCalendarEntry[]>();

    for (const order of orders) {
      for (const area of Object.keys(order.areas) as PcpAreaKey[]) {
        const schedule = order.areas[area];
        if (!schedule) continue;
        const entries = byDate.get(schedule.date) || [];
        entries.push({
          salesOrderCode: order.code,
          customerName: order.customerName,
          area,
          environments: schedule.environments,
        });
        byDate.set(schedule.date, entries);
      }
    }

    return [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, entries]) => ({
        date,
        entries: entries.sort((a, b) => {
          const areaOrder = areaKeys.indexOf(a.area) - areaKeys.indexOf(b.area);
          if (areaOrder !== 0) return areaOrder;
          return compareSalesOrderCodes(a.salesOrderCode, b.salesOrderCode);
        }),
      }));
  }
}
