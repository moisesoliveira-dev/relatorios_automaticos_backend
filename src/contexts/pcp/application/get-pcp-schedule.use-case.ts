import { Inject, Injectable } from '@nestjs/common';
import { resolveExecutiveApprovalDate } from '../domain/executive-approval.domain';
import { pcpAreaKeys, pcpBusinessDaysMap } from '../domain/pcp-area-config';
import {
  PcpAreaKey,
  PcpScheduleResponse,
  SalesOrderSummary,
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
import { PcpConfigService } from '../infrastructure/pcp-config.service';
import { SALES_ORDER_PORT } from './ports/sales-order.port';
import type { SalesOrderPort } from './ports/sales-order.port';

/** Use case (application layer): orquestra domínio + portas. */
@Injectable()
export class GetPcpScheduleUseCase {
  private readonly classifier = new EnvironmentClassifier();
  private readonly conflictResolver = new PcpConflictResolver();
  private fullCache: { key: string; expiresAt: number; value: PcpScheduleResponse } | null = null;
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;
  private static readonly TASK_CONCURRENCY = 5;

  constructor(
    @Inject(SALES_ORDER_PORT) private readonly salesOrders: SalesOrderPort,
    private readonly pcpConfigService: PcpConfigService,
  ) {}

  async execute(query?: string, light = false): Promise<PcpScheduleResponse> {
    const areaConfig = await this.pcpConfigService.getConfig();
    const areaKeys = pcpAreaKeys(areaConfig);
    const offsets = pcpBusinessDaysMap(areaConfig);
    const cacheKey = `q:${(query || '').trim().toLowerCase()}:cfg:${JSON.stringify(areaConfig.areas.map((a) => [a.key, a.businessDays, a.color]))}`;

    if (!light) {
      const cached = this.fullCache;
      if (cached && cached.key === cacheKey && cached.expiresAt > Date.now()) {
        return cached.value;
      }
    }

    const asOf = toDateString(todayLocal());
    const asOfDate = todayLocal();
    const rawOrders = await this.salesOrders.fetchEligibleOrders(asOf, query);
    const eligible = await this.enrichWithApprovalDates(rawOrders);
    const filtered = eligible.filter((order) => this.isOrderVisible(order, offsets, areaKeys, asOfDate, light));

    if (light) {
      const workingRows = filtered.map((order) => this.buildRowWithoutItems(order, offsets, areaKeys));
      const resolved = this.conflictResolver.resolve(workingRows, areaKeys);
      return {
        asOf,
        areaConfig,
        salesOrders: resolved,
        calendar: this.conflictResolver.buildCalendar(resolved, areaKeys),
        environmentsPending: true,
      };
    }

    const workingRows = await this.buildRowsWithItems(filtered, offsets, areaKeys);
    const resolved = this.conflictResolver.resolve(workingRows, areaKeys);
    const response: PcpScheduleResponse = {
      asOf,
      areaConfig,
      salesOrders: resolved,
      calendar: this.conflictResolver.buildCalendar(resolved, areaKeys),
      environmentsPending: false,
    };

    this.fullCache = {
      key: cacheKey,
      expiresAt: Date.now() + GetPcpScheduleUseCase.CACHE_TTL_MS,
      value: response,
    };

    return response;
  }

  private async enrichWithApprovalDates(orders: SalesOrderSummary[]): Promise<SalesOrderSummary[]> {
    const enriched = new Array<SalesOrderSummary>(orders.length);
    let nextIndex = 0;

    const worker = async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= orders.length) return;

        const order = orders[index];
        let approvalDate: string | null = null;
        try {
          const tasks = await this.salesOrders.fetchOrderTasks(order.ponttaId);
          const resolved = resolveExecutiveApprovalDate(tasks);
          approvalDate = resolved ? toDateString(resolved) : null;
        } catch (error: any) {
          console.warn(`[PCP] Falha ao buscar tarefas do PV ${order.code}:`, error?.message || error);
        }

        enriched[index] = { ...order, approvalDate };
      }
    };

    const pool = Math.min(GetPcpScheduleUseCase.TASK_CONCURRENCY, Math.max(1, orders.length));
    await Promise.all(Array.from({ length: pool }, () => worker()));
    return enriched.filter(Boolean);
  }

  private isOrderVisible(
    order: SalesOrderSummary,
    offsets: Record<PcpAreaKey, number>,
    areaKeys: PcpAreaKey[],
    asOfDate: Date,
    light: boolean,
  ): boolean {
    if (!order.approvalDate) return false;
    const base = parseDateOnly(order.approvalDate);
    if (!base) return false;

    if (light) {
      return areaKeys.some((key) => adjustToTueThuFri(addBusinessDays(base, offsets[key] || 0)) >= asOfDate);
    }

    return areaKeys.some((key) => adjustToTueThuFri(addBusinessDays(base, offsets[key] || 0)) >= asOfDate);
  }

  private buildRowWithoutItems(
    order: SalesOrderSummary,
    offsets: Record<PcpAreaKey, number>,
    areaKeys: PcpAreaKey[],
  ): WorkingRow {
    const baseDate = parseDateOnly(order.approvalDate!)!;
    const areas: WorkingRow['areas'] = {};
    for (const key of areaKeys) {
      areas[key] = {
        tentative: adjustToTueThuFri(addBusinessDays(baseDate, offsets[key] || 0)),
        environments: [],
      };
    }
    return {
      ponttaId: order.ponttaId,
      code: order.code,
      customerName: order.customerName,
      baseDate,
      areas,
      unclassified: [],
    };
  }

  private async buildRowsWithItems(
    eligible: SalesOrderSummary[],
    offsets: Record<PcpAreaKey, number>,
    areaKeys: PcpAreaKey[],
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
        const baseDate = parseDateOnly(order.approvalDate!)!;
        const areas: WorkingRow['areas'] = {};

        for (const key of areaKeys) {
          const envs = classified[key];
          if (!envs.length) continue;
          areas[key] = {
            tentative: adjustToTueThuFri(addBusinessDays(baseDate, offsets[key] || 0)),
            environments: envs,
          };
        }

        rows[index] = {
          ponttaId: order.ponttaId,
          code: order.code,
          customerName: order.customerName,
          baseDate,
          areas,
          unclassified: classified.unclassified,
        };
      }
    };

    const pool = Math.min(GetPcpScheduleUseCase.TASK_CONCURRENCY, Math.max(1, eligible.length));
    await Promise.all(Array.from({ length: pool }, () => worker()));
    return rows.filter(Boolean);
  }
}
