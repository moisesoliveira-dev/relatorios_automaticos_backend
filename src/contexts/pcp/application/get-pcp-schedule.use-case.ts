import { Inject, Injectable } from '@nestjs/common';
import {
  AREA_OFFSETS,
  PcpAreaKey,
  PcpScheduleResponse,
  WorkingRow,
} from '../domain/pcp.types';
import { EnvironmentClassifier } from '../domain/environment-classifier';
import {
  addBusinessDays,
  adjustToTueThuFri,
  parseDateOnly,
  PcpConflictResolver,
  todayLocal,
  toDateString,
} from '../domain/pcp-schedule.domain';
import { SALES_ORDER_PORT } from './ports/sales-order.port';
import type { SalesOrderPort } from './ports/sales-order.port';

/** Use case (application layer): orquestra domínio + portas. */
@Injectable()
export class GetPcpScheduleUseCase {
  private readonly classifier = new EnvironmentClassifier();
  private readonly conflictResolver = new PcpConflictResolver();
  private fullCache: { key: string; expiresAt: number; value: PcpScheduleResponse } | null = null;
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;
  private static readonly ITEM_CONCURRENCY = 5;

  constructor(@Inject(SALES_ORDER_PORT) private readonly salesOrders: SalesOrderPort) {}

  async execute(query?: string, light = false): Promise<PcpScheduleResponse> {
    const cacheKey = `q:${(query || '').trim().toLowerCase()}`;

    if (!light) {
      const cached = this.fullCache;
      if (cached && cached.key === cacheKey && cached.expiresAt > Date.now()) {
        return cached.value;
      }
    }

    const asOf = toDateString(todayLocal());
    const eligible = await this.salesOrders.fetchEligibleOrders(asOf, query);

    if (light) {
      const workingRows = eligible.map((order) => this.buildRowWithoutItems(order));
      const resolved = this.conflictResolver.resolve(workingRows);
      return {
        asOf,
        salesOrders: resolved,
        calendar: this.conflictResolver.buildCalendar(resolved),
        environmentsPending: true,
      };
    }

    const workingRows = await this.buildRowsWithItems(eligible);
    const resolved = this.conflictResolver.resolve(workingRows);
    const response: PcpScheduleResponse = {
      asOf,
      salesOrders: resolved,
      calendar: this.conflictResolver.buildCalendar(resolved),
      environmentsPending: false,
    };

    this.fullCache = {
      key: cacheKey,
      expiresAt: Date.now() + GetPcpScheduleUseCase.CACHE_TTL_MS,
      value: response,
    };

    return response;
  }

  private buildRowWithoutItems(order: { ponttaId: string; code: string; customerName: string; deliveryDate: string | null }): WorkingRow {
    const deliveryDate = parseDateOnly(order.deliveryDate!)!;
    const areas: WorkingRow['areas'] = {};
    for (const key of Object.keys(AREA_OFFSETS) as PcpAreaKey[]) {
      areas[key] = {
        tentative: adjustToTueThuFri(addBusinessDays(deliveryDate, AREA_OFFSETS[key])),
        environments: [],
      };
    }
    return {
      ponttaId: order.ponttaId,
      code: order.code,
      customerName: order.customerName,
      deliveryDate,
      areas,
      unclassified: [],
    };
  }

  private async buildRowsWithItems(
    eligible: Array<{ ponttaId: string; code: string; customerName: string; deliveryDate: string | null }>,
  ): Promise<WorkingRow[]> {
    const rows: WorkingRow[] = new Array(eligible.length);
    let nextIndex = 0;

    const worker = async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= eligible.length) return;

        const order = eligible[index];
        let items: any[] = [];
        try {
          items = await this.salesOrders.fetchOrderItems(order.ponttaId, order.code);
        } catch (error: any) {
          console.warn(`[PCP] Falha ao buscar items do PV ${order.code}:`, error?.message || error);
        }

        const classified = this.classifier.classify(items);
        const deliveryDate = parseDateOnly(order.deliveryDate!)!;
        const areas: WorkingRow['areas'] = {};

        for (const key of Object.keys(AREA_OFFSETS) as PcpAreaKey[]) {
          const envs = classified[key];
          if (!envs.length) continue;
          areas[key] = {
            tentative: adjustToTueThuFri(addBusinessDays(deliveryDate, AREA_OFFSETS[key])),
            environments: envs,
          };
        }

        rows[index] = {
          ponttaId: order.ponttaId,
          code: order.code,
          customerName: order.customerName,
          deliveryDate,
          areas,
          unclassified: classified.unclassified,
        };
      }
    };

    const pool = Math.min(GetPcpScheduleUseCase.ITEM_CONCURRENCY, Math.max(1, eligible.length));
    await Promise.all(Array.from({ length: pool }, () => worker()));
    return rows.filter(Boolean);
  }
}
