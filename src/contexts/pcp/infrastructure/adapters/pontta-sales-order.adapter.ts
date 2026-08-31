import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../../infrastructure/config/app-config.service';
import { PonttaService } from '../../../../pontta/pontta.service';
import { SalesOrderPort } from '../../application/ports/sales-order.port';
import { SalesOrderSummary } from '../../domain/pcp.types';

function normalizeDateString(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const iso = value.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      const y = parsed.getFullYear();
      const m = String(parsed.getMonth() + 1).padStart(2, '0');
      const d = String(parsed.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

/** Adapter (infra): Pontta como fonte de pedidos de venda. */
@Injectable()
export class PonttaSalesOrderAdapter implements SalesOrderPort {
  private summaryCache: { key: string; expiresAt: number; orders: SalesOrderSummary[] } | null = null;
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;
  private static readonly MAX_PAGES = 8;
  private static readonly PAGE_SIZE = 100;
  private static readonly ITEM_CONCURRENCY = 5;

  constructor(
    private readonly ponttaService: PonttaService,
    private readonly appConfig: AppConfigService,
  ) {}

  async fetchEligibleOrders(asOf: string, query?: string): Promise<SalesOrderSummary[]> {
    const asOfDate = this.parseDateOnly(asOf);
    if (!asOfDate) return [];

    const summaryKey = `sum:${asOf}:q:${(query || '').trim().toLowerCase()}`;
    const cached = this.summaryCache;
    if (cached && cached.key === summaryKey && cached.expiresAt > Date.now()) {
      return this.filterByDeliveryDate(cached.orders, asOfDate);
    }

    const { email, password } = this.appConfig.ponttaCredentials;
    let token = await this.ponttaService.authenticate(email, password);
    let rawOrders: any[];

    try {
      rawOrders = await this.fetchRawOrders(token, asOf, query);
    } catch (error: any) {
      if (error?.status === 401 || error?.response?.status === 401) {
        this.ponttaService.clearTokenCache(email);
        token = await this.ponttaService.authenticate(email, password);
        rawOrders = await this.fetchRawOrders(token, asOf, query);
      } else {
        throw error;
      }
    }

    const mapped = rawOrders.map((item) => this.mapSalesOrder(item));
    this.summaryCache = {
      key: summaryKey,
      expiresAt: Date.now() + PonttaSalesOrderAdapter.CACHE_TTL_MS,
      orders: mapped,
    };

    return this.filterByDeliveryDate(mapped, asOfDate);
  }

  async fetchOrderItems(ponttaId: string, _code: string): Promise<any[]> {
    const { email, password } = this.appConfig.ponttaCredentials;
    let token = await this.ponttaService.authenticate(email, password);
    try {
      return await this.withRetry(() => this.ponttaService.getSalesOrderItems(token, ponttaId), `items ${ponttaId}`);
    } catch (error: any) {
      if (error?.status === 401 || error?.response?.status === 401) {
        this.ponttaService.clearTokenCache(email);
        token = await this.ponttaService.authenticate(email, password);
        return await this.withRetry(() => this.ponttaService.getSalesOrderItems(token, ponttaId), `items ${ponttaId} retry`);
      }
      throw error;
    }
  }

  private async fetchRawOrders(token: string, asOf: string, query?: string): Promise<any[]> {
    if (query && query.trim().length > 0) {
      return this.withRetry(
        () => this.ponttaService.searchSalesOrders(token, query.trim(), 0, 100),
        'searchSalesOrders',
      );
    }

    const start = this.addCalendarDays(this.parseDateOnly(asOf)!, -365);
    const end = this.addCalendarDays(this.parseDateOnly(asOf)!, 90);
    end.setHours(23, 59, 59, 999);

    const all: any[] = [];
    for (let page = 0; page < PonttaSalesOrderAdapter.MAX_PAGES; page += 1) {
      const chunk = await this.withRetry(
        () =>
          this.ponttaService.getSalesOrdersSummaryByDateRange(
            token,
            start.toISOString(),
            end.toISOString(),
            page,
            PonttaSalesOrderAdapter.PAGE_SIZE,
          ),
        `sales-orders page ${page}`,
      ) as any[];
      all.push(...chunk);
      if (chunk.length < PonttaSalesOrderAdapter.PAGE_SIZE) break;
    }
    return all;
  }

  private mapSalesOrder(item: any): SalesOrderSummary {
    const rawDelivery =
      item.deliveryDate ||
      item.delivery_date ||
      item.expectedDeliveryDate ||
      item.forecastDeliveryDate ||
      null;

    return {
      ponttaId: String(item.id || item.ponttaId || ''),
      code: String(item.code || item.number || ''),
      customerName: item.customer?.name || item.customerName || '',
      deliveryDate: normalizeDateString(rawDelivery),
      approvalDate: null,
    };
  }

  async fetchOrderTasks(ponttaId: string): Promise<Array<Record<string, unknown>>> {
    const { email, password } = this.appConfig.ponttaCredentials;
    let token = await this.ponttaService.authenticate(email, password);
    try {
      return await this.withRetry(
        () => this.ponttaService.getSalesOrderTasksSummary(token, ponttaId),
        `tasks ${ponttaId}`,
      );
    } catch (error: any) {
      if (error?.status === 401 || error?.response?.status === 401) {
        this.ponttaService.clearTokenCache(email);
        token = await this.ponttaService.authenticate(email, password);
        return await this.withRetry(
          () => this.ponttaService.getSalesOrderTasksSummary(token, ponttaId),
          `tasks ${ponttaId} retry`,
        );
      }
      throw error;
    }
  }

  private filterByDeliveryDate(orders: SalesOrderSummary[], _asOfDate: Date): SalesOrderSummary[] {
    return orders.filter((order) => !!order.ponttaId && !!order.code);
  }

  private async withRetry<T>(fn: () => Promise<T>, label: string, attempts = 4): Promise<T> {
    let lastError: any;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        const status = (error as any)?.status || (error as any)?.response?.status;
        const message = String((error as any)?.message || (error as any)?.response?.data?.message || '');
        const isRateLimited = status === 429 || /too many requests/i.test(message);
        if (!isRateLimited || attempt === attempts) throw error;
        const waitMs = Math.min(8000, 1000 * Math.pow(2, attempt - 1));
        console.warn(`[PCP] Rate limit em ${label}. Tentativa ${attempt}/${attempts}, aguardando ${waitMs}ms`);
        await this.sleep(waitMs);
      }
    }
    throw lastError;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private addCalendarDays(base: Date, days: number): Date {
    const result = new Date(base);
    result.setDate(result.getDate() + days);
    result.setHours(0, 0, 0, 0);
    return result;
  }

  private parseDateOnly(value: string): Date | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setHours(0, 0, 0, 0);
    return date;
  }
}
