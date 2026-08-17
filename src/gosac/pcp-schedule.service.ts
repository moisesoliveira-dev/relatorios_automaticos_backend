import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
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
    from: string;
    to: string;
    salesOrders: PcpSalesOrderSchedule[];
    withoutDeliveryDate: PcpSalesOrderSchedule[];
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

    constructor(
        private readonly ponttaService: PonttaService,
        private readonly configService: ConfigService,
    ) {
        this.ponttaEmail = this.configService.get<string>('PONTTA_EMAIL') || 'seu_email_pontta@example.com';
        this.ponttaPassword = this.configService.get<string>('PONTTA_PASSWORD') || '***REMOVIDO***';
    }

    async getSchedule(from: string, to: string, query?: string): Promise<PcpScheduleResponse> {
        if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
            throw new HttpException('Parâmetros from e to são obrigatórios (YYYY-MM-DD).', HttpStatus.BAD_REQUEST);
        }
        if (from > to) {
            throw new HttpException('from deve ser anterior ou igual a to.', HttpStatus.BAD_REQUEST);
        }

        let token = await this.ponttaService.authenticate(this.ponttaEmail, this.ponttaPassword);
        let rawOrders: any[];

        try {
            rawOrders = await this.fetchSalesOrders(token, from, to, query);
        } catch (error) {
            if (error?.status === 401 || error?.response?.status === 401) {
                this.ponttaService.clearTokenCache(this.ponttaEmail);
                token = await this.ponttaService.authenticate(this.ponttaEmail, this.ponttaPassword);
                rawOrders = await this.fetchSalesOrders(token, from, to, query);
            } else {
                throw error;
            }
        }

        const mapped = rawOrders.map((item) => this.mapSalesOrder(item));
        const fromDate = this.parseDateOnly(from)!;
        const toDate = this.parseDateOnly(to)!;

        const withDelivery: typeof mapped = [];
        const withoutDelivery: PcpSalesOrderSchedule[] = [];

        for (const order of mapped) {
            if (!order.deliveryDate) {
                withoutDelivery.push({
                    ...order,
                    areas: {},
                    unclassified: [],
                });
                continue;
            }
            const d = this.parseDateOnly(order.deliveryDate);
            if (!d || d < fromDate || d > toDate) continue;
            withDelivery.push(order);
        }

        const workingRows: WorkingRow[] = [];
        for (const order of withDelivery) {
            let items: any[] = [];
            try {
                items = await this.ponttaService.getSalesOrderItems(token, order.ponttaId);
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

        return {
            from,
            to,
            salesOrders: resolved,
            withoutDeliveryDate: withoutDelivery.sort((a, b) => a.code.localeCompare(b.code)),
            calendar,
        };
    }

    private async fetchSalesOrders(
        token: string,
        from: string,
        to: string,
        query?: string,
    ): Promise<any[]> {
        if (query && query.trim().length > 0) {
            return this.ponttaService.searchSalesOrders(token, query.trim(), 0, 100);
        }

        // Pontta filtra por saleDate; amplia a janela para capturar PVs cujo deliveryDate caia no período.
        const expandedStart = this.addCalendarDays(this.parseDateOnly(from)!, -60);
        const endDate = this.parseDateOnly(to)!;
        endDate.setHours(23, 59, 59, 999);

        const startIso = expandedStart.toISOString();
        const endIso = endDate.toISOString();

        const pageSize = 100;
        const maxPages = 20;
        const all: any[] = [];

        for (let page = 0; page < maxPages; page += 1) {
            const chunk = await this.ponttaService.getSalesOrdersSummaryByDateRange(
                token,
                startIso,
                endIso,
                page,
                pageSize,
            );
            all.push(...chunk);
            if (chunk.length < pageSize) break;
        }

        return all;
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
