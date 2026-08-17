import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PonttaService } from '../pontta/pontta.service';

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
}

const AREA_OFFSETS: Record<PcpAreaKey, number> = {
    molhada: 20,
    intima: 25,
    social: 30,
};

const AREA_LABELS: Record<PcpAreaKey, string> = {
    molhada: 'Áreas Molhadas',
    intima: 'Áreas Íntimas',
    social: 'Áreas Sociais',
};

interface WorkingRow {
    ponttaId: string;
    code: string;
    customerName: string;
    deliveryDate: Date;
    areas: Partial<Record<PcpAreaKey, { tentative: Date; environments: string[] }>>;
    unclassified: string[];
}

@Injectable()
export class PcpScheduleService {
    private readonly ponttaEmail: string;
    private readonly ponttaPassword: string;

    /** Cache curto para evitar rajadas de chamadas ao Pontta no refresh. */
    private cache: { key: string; expiresAt: number; value: PcpScheduleResponse } | null = null;
    private static readonly CACHE_TTL_MS = 2 * 60 * 1000;
    private static readonly PAGE_DELAY_MS = 350;
    private static readonly ITEM_DELAY_MS = 200;
    private static readonly MAX_PAGES = 8;
    private static readonly PAGE_SIZE = 50;

    constructor(
        private readonly ponttaService: PonttaService,
        private readonly configService: ConfigService,
    ) {
        this.ponttaEmail = this.configService.get<string>('PONTTA_EMAIL') || 'seu_email_pontta@example.com';
        this.ponttaPassword = this.configService.get<string>('PONTTA_PASSWORD') || '***REMOVIDO***';
    }

    async getSchedule(query?: string): Promise<PcpScheduleResponse> {
        const cacheKey = `q:${(query || '').trim().toLowerCase()}`;
        const cached = this.cache;
        if (cached && cached.key === cacheKey && cached.expiresAt > Date.now()) {
            return cached.value;
        }

        const asOf = this.toDateString(this.todayLocal());
        const asOfDate = this.parseDateOnly(asOf)!;

        let token = await this.ponttaService.authenticate(this.ponttaEmail, this.ponttaPassword);
        let rawOrders: any[];

        try {
            rawOrders = await this.fetchSalesOrders(token, asOf, query);
        } catch (error) {
            if (error?.status === 401 || error?.response?.status === 401) {
                this.ponttaService.clearTokenCache(this.ponttaEmail);
                token = await this.ponttaService.authenticate(this.ponttaEmail, this.ponttaPassword);
                rawOrders = await this.fetchSalesOrders(token, asOf, query);
            } else {
                throw error;
            }
        }

        const mapped = rawOrders.map((item) => this.mapSalesOrder(item));
        const withDelivery = mapped.filter((order) => {
            if (!order.deliveryDate) return false;
            const d = this.parseDateOnly(order.deliveryDate);
            return !!d && d >= asOfDate;
        });

        const workingRows: WorkingRow[] = [];
        for (let i = 0; i < withDelivery.length; i += 1) {
            const order = withDelivery[i];
            if (i > 0) {
                await this.sleep(PcpScheduleService.ITEM_DELAY_MS);
            }

            let items: any[] = [];
            try {
                items = await this.withRetry(
                    () => this.ponttaService.getSalesOrderItems(token, order.ponttaId),
                    `items PV ${order.code}`,
                );
            } catch (error) {
                console.warn(`[PCP] Falha ao buscar items do PV ${order.code}:`, error?.message || error);
            }

            const classified = this.classifyEnvironments(items);
            const deliveryDate = this.parseDateOnly(order.deliveryDate!)!;
            const areas: WorkingRow['areas'] = {};

            for (const key of Object.keys(AREA_OFFSETS) as PcpAreaKey[]) {
                const envs = classified[key];
                if (!envs.length) continue;
                const tentative = this.adjustToTueThuFri(
                    this.addBusinessDays(deliveryDate, AREA_OFFSETS[key]),
                );
                areas[key] = { tentative, environments: envs };
            }

            workingRows.push({
                ponttaId: order.ponttaId,
                code: order.code,
                customerName: order.customerName,
                deliveryDate,
                areas,
                unclassified: classified.unclassified,
            });
        }

        const resolved = this.resolveConflicts(workingRows);
        const calendar = this.buildCalendar(resolved);

        const response: PcpScheduleResponse = {
            asOf,
            salesOrders: resolved,
            calendar,
        };

        this.cache = {
            key: cacheKey,
            expiresAt: Date.now() + PcpScheduleService.CACHE_TTL_MS,
            value: response,
        };

        return response;
    }

    private async fetchSalesOrders(
        token: string,
        asOf: string,
        query?: string,
    ): Promise<any[]> {
        if (query && query.trim().length > 0) {
            return this.withRetry(
                () => this.ponttaService.searchSalesOrders(token, query.trim(), 0, 100),
                'searchSalesOrders',
            );
        }

        // Janela menor + páginas espaçadas para não estourar o rate limit do Pontta.
        const start = this.addCalendarDays(this.parseDateOnly(asOf)!, -365);
        const end = this.addCalendarDays(this.parseDateOnly(asOf)!, 90);
        end.setHours(23, 59, 59, 999);

        const startIso = start.toISOString();
        const endIso = end.toISOString();
        const all: any[] = [];

        for (let page = 0; page < PcpScheduleService.MAX_PAGES; page += 1) {
            if (page > 0) {
                await this.sleep(PcpScheduleService.PAGE_DELAY_MS);
            }

            const chunk = await this.withRetry(
                () =>
                    this.ponttaService.getSalesOrdersSummaryByDateRange(
                        token,
                        startIso,
                        endIso,
                        page,
                        PcpScheduleService.PAGE_SIZE,
                    ),
                `sales-orders page ${page}`,
            );

            all.push(...chunk);
            if (chunk.length < PcpScheduleService.PAGE_SIZE) break;
        }

        return all;
    }

    private async withRetry<T>(fn: () => Promise<T>, label: string, attempts = 4): Promise<T> {
        let lastError: any;
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            try {
                return await fn();
            } catch (error) {
                lastError = error;
                const status = error?.status || error?.response?.status;
                const message = String(error?.message || error?.response?.data?.message || '');
                const isRateLimited =
                    status === 429 ||
                    /too many requests/i.test(message);

                if (!isRateLimited || attempt === attempts) {
                    throw error;
                }

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

    private todayLocal(): Date {
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        return now;
    }

    private mapSalesOrder(item: any): {
        ponttaId: string;
        code: string;
        customerName: string;
        deliveryDate: string | null;
    } {
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
            deliveryDate: this.normalizeDateString(rawDelivery),
        };
    }

    private classifyEnvironments(items: any[]): Record<PcpAreaKey, string[]> & { unclassified: string[] } {
        const result: Record<PcpAreaKey, string[]> & { unclassified: string[] } = {
            molhada: [],
            intima: [],
            social: [],
            unclassified: [],
        };

        for (const item of items) {
            const rawName = String(item?.name || item?.description || item?.title || '').trim();
            if (!rawName) continue;

            const displayName = this.formatEnvironmentDisplayName(rawName);
            const area = this.matchArea(rawName);
            if (area) {
                result[area].push(displayName);
            } else {
                result.unclassified.push(displayName);
            }
        }

        return result;
    }

    private formatEnvironmentDisplayName(rawName: string): string {
        const normalized = this.normalizeText(rawName);
        const firstWord = rawName.trim().split(/\s+/)[0] || rawName;

        // WC / Dorm com nome de pessoa: exibir tipo + primeira palavra do restante
        if (/^wc\b/.test(normalized) || /^dormitorio\b/.test(normalized) || /^dorm\b/.test(normalized)) {
            const parts = rawName.trim().split(/\s+/);
            if (parts.length >= 2) {
                const personFirst = parts[1];
                const type = /^wc\b/.test(normalized)
                    ? 'WC'
                    : /^dorm\s*master\b/.test(normalized) || /^dormitorio\s*master\b/.test(normalized)
                        ? 'Dorm Master'
                        : 'Dorm';
                if (type === 'Dorm Master') return 'Dorm Master';
                return `${type} ${personFirst}`;
            }
        }

        return rawName.trim();
    }

    private matchArea(rawName: string): PcpAreaKey | null {
        const n = this.normalizeText(rawName);

        // Sociais (antes de matches genéricos)
        if (n.includes('sala de jantar') || n === 'sala jantar') return 'social';
        if (n.includes('sala de estar') || n === 'sala estar') return 'social';

        // Molhadas
        if (n.includes('cozinha')) return 'molhada';
        if (n.includes('area de servico') || n.includes('area servico') || n.includes('lavanderia')) return 'molhada';
        if (n.includes('gourmet')) return 'molhada';
        if (n.includes('lavabo')) return 'molhada';
        if (n.includes('varanda')) return 'molhada';
        if (/^wc\b/.test(n) || n.startsWith('wc ') || n === 'wc') return 'molhada';

        // Íntimas
        if (n.includes('dorm master') || n.includes('dormitorio master') || n.includes('suite master')) return 'intima';
        if (n.includes('circulacao')) return 'intima';
        if (n.includes('hall intimo')) return 'intima';
        if (n.includes('home theater') || n.includes('home theatre') || n.includes('cinema')) return 'intima';
        if (n.includes('escritorio')) return 'intima';
        if (/^dorm\b/.test(n) || /^dormitorio\b/.test(n) || n.startsWith('dorm ') || n.startsWith('dormitorio ')) {
            return 'intima';
        }

        return null;
    }

    private resolveConflicts(rows: WorkingRow[]): PcpSalesOrderSchedule[] {
        const occupied: Record<PcpAreaKey, Set<string>> = {
            molhada: new Set(),
            intima: new Set(),
            social: new Set(),
        };

        const assignedDates = new Map<string, Partial<Record<PcpAreaKey, { date: Date; conflictAdjusted: boolean; environments: string[] }>>>();

        for (const area of Object.keys(AREA_OFFSETS) as PcpAreaKey[]) {
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
                    const d = a.row.deliveryDate.getTime() - b.row.deliveryDate.getTime();
                    if (d !== 0) return d;
                    return a.row.code.localeCompare(b.row.code);
                });

            for (const candidate of candidates) {
                let date = new Date(candidate.tentative);
                let conflictAdjusted = false;

                while (occupied[area].has(this.toDateString(date))) {
                    date = this.nextDeliveryDay(date);
                    conflictAdjusted = true;
                }

                occupied[area].add(this.toDateString(date));

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
                        date: this.toDateString(a.date),
                        environments: a.environments,
                        conflictAdjusted: a.conflictAdjusted,
                    };
                }
                return {
                    ponttaId: row.ponttaId,
                    code: row.code,
                    customerName: row.customerName,
                    deliveryDate: this.toDateString(row.deliveryDate),
                    areas,
                    unclassified: row.unclassified,
                };
            })
            .sort((a, b) => {
                const da = a.deliveryDate || '';
                const db = b.deliveryDate || '';
                if (da !== db) return da.localeCompare(db);
                return a.code.localeCompare(b.code);
            });
    }

    private buildCalendar(orders: PcpSalesOrderSchedule[]): PcpCalendarDay[] {
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
                    const areaOrder = (['molhada', 'intima', 'social'] as PcpAreaKey[]).indexOf(a.area)
                        - (['molhada', 'intima', 'social'] as PcpAreaKey[]).indexOf(b.area);
                    if (areaOrder !== 0) return areaOrder;
                    return a.salesOrderCode.localeCompare(b.salesOrderCode);
                }),
            }));
    }

    addBusinessDays(baseDate: Date, businessDays: number): Date {
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

    adjustToTueThuFri(baseDate: Date): Date {
        const result = new Date(baseDate);
        result.setHours(0, 0, 0, 0);

        while (![2, 4, 5].includes(result.getDay())) {
            result.setDate(result.getDate() + 1);
        }

        return result;
    }

    private nextDeliveryDay(from: Date): Date {
        const result = new Date(from);
        result.setHours(0, 0, 0, 0);
        result.setDate(result.getDate() + 1);
        return this.adjustToTueThuFri(result);
    }

    private addCalendarDays(base: Date, days: number): Date {
        const result = new Date(base);
        result.setDate(result.getDate() + days);
        result.setHours(0, 0, 0, 0);
        return result;
    }

    private normalizeText(value: string): string {
        return value
            .normalize('NFD')
            .replace(/\p{M}/gu, '')
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private normalizeDateString(value: any): string | null {
        if (!value) return null;
        if (typeof value === 'string') {
            const iso = value.slice(0, 10);
            if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
            const parsed = new Date(value);
            if (!Number.isNaN(parsed.getTime())) return this.toDateString(parsed);
            return null;
        }
        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return this.toDateString(value);
        }
        return null;
    }

    private parseDateOnly(value: string): Date | null {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
        const [y, m, d] = value.split('-').map(Number);
        const date = new Date(y, m - 1, d);
        date.setHours(0, 0, 0, 0);
        return date;
    }

    private toDateString(date: Date): string {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
}

export { AREA_LABELS };
