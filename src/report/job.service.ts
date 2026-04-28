import { Injectable, NotFoundException, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ScheduledJob } from './entities/job.entity';
import { CreateJobDto, UpdateJobDto } from './dto/job.dto';
import { ReportService } from './report.service';
import { ReportEmail } from './entities/report.entity';
import { PonttaService } from '../pontta/pontta.service';
import { GoogleDriveService } from '../gosac/google-drive.service';
import { ConfigService } from '@nestjs/config';
import * as puppeteer from 'puppeteer';

type CodeJobId = 'delivery-material-dates';

interface CodeJobDefinition {
    id: CodeJobId;
    name: string;
    description: string;
    scheduleLabel: string;
    runTimesManaus: Array<{ hour: number; minute: number }>;
}

interface CodeJobState {
    id: CodeJobId;
    isActive: boolean;
    isRunning: boolean;
    lastStatus: 'idle' | 'running' | 'success' | 'error';
    lastRunAt: string | null;
    nextRunAt: string | null;
    lastSummary: string | null;
}

interface RunCodeJobNowOptions {
    salesOrderDate?: string;
}

export interface CodeJobLogEntry {
    timestamp: string;
    level: 'info' | 'success' | 'warning' | 'error';
    message: string;
    data?: unknown;
}

interface DeliveryScheduleRow {
    salesOrderCode: string;
    customerName: string;
    salesOrderId: string;
    environmentName: string;
    responsibleName: string;
    approvalDate: Date;
    productionStartDate: Date;
    deliveryFromProductionDate: Date;
    deliveryFromApproval30Date: Date;
    deliveryTueOrThuDate: Date;
}

@Injectable()
export class JobService {
    private readonly logger = new Logger(JobService.name);
    private readonly MANAUS_UTC_OFFSET_HOURS = -4;
    private readonly ponttaEmail: string;
    private readonly ponttaPassword: string;

    private readonly codeJobDefinitions: CodeJobDefinition[] = [
        {
            id: 'delivery-material-dates',
            name: 'Gerar datas de entrega de material',
            description: 'Calcula datas por ambiente a partir da tarefa "Aprovação do Projeto Executivo", gera PDF e salva no Drive.',
            scheduleLabel: 'Diário às 00:00 (Manaus) — busca pedidos do dia anterior',
            runTimesManaus: [
                { hour: 0, minute: 0 },
            ],
        },
    ];

    private readonly codeJobStates = new Map<CodeJobId, CodeJobState>();
    private readonly codeJobLogs = new Map<CodeJobId, CodeJobLogEntry[]>();
    private readonly maxCodeJobLogs = 500;

    constructor(
        @InjectRepository(ScheduledJob)
        private jobRepository: Repository<ScheduledJob>,
        @InjectRepository(ReportEmail)
        private reportEmailRepository: Repository<ReportEmail>,
        private reportService: ReportService,
        private readonly ponttaService: PonttaService,
        private readonly googleDriveService: GoogleDriveService,
        private readonly configService: ConfigService,
    ) {
        this.ponttaEmail = this.configService.get<string>('PONTTA_EMAIL') || 'seu_email_pontta@example.com';
        this.ponttaPassword = this.configService.get<string>('PONTTA_PASSWORD') || '***REMOVIDO***';

        for (const def of this.codeJobDefinitions) {
            this.codeJobStates.set(def.id, {
                id: def.id,
                isActive: false,
                isRunning: false,
                lastStatus: 'idle',
                lastRunAt: null,
                nextRunAt: null,
                lastSummary: null,
            });
            this.codeJobLogs.set(def.id, []);
        }
    }

    // =========================
    // Jobs definidos em código
    // =========================

    getCodeJobs() {
        return this.codeJobDefinitions.map((def) => {
            const state = this.codeJobStates.get(def.id)!;
            return {
                id: def.id,
                name: def.name,
                description: def.description,
                scheduleLabel: def.scheduleLabel,
                isActive: state.isActive,
                isRunning: state.isRunning,
                lastStatus: state.lastStatus,
                lastRunAt: state.lastRunAt,
                nextRunAt: state.nextRunAt,
                lastSummary: state.lastSummary,
            };
        });
    }

    getCodeJobLogs(jobId: string, limit: number = 200) {
        const normalizedJobId = this.assertCodeJob(jobId);
        const logs = this.codeJobLogs.get(normalizedJobId) || [];
        return logs.slice(-Math.max(1, Math.min(limit, this.maxCodeJobLogs)));
    }

    clearCodeJobLogs(jobId: string) {
        const normalizedJobId = this.assertCodeJob(jobId);
        this.codeJobLogs.set(normalizedJobId, []);
        return { cleared: true };
    }

    startCodeJob(jobId: string) {
        const normalizedJobId = this.assertCodeJob(jobId);
        const state = this.codeJobStates.get(normalizedJobId)!;

        state.isActive = true;
        const nextRun = this.calculateNextCodeJobRun(normalizedJobId);
        state.nextRunAt = nextRun.toISOString();

        this.pushCodeJobLog(normalizedJobId, 'info', 'Job ativado.', {
            nextRunAt: state.nextRunAt,
        });
        return this.getCodeJobs().find((j) => j.id === normalizedJobId);
    }

    stopCodeJob(jobId: string) {
        const normalizedJobId = this.assertCodeJob(jobId);
        const state = this.codeJobStates.get(normalizedJobId)!;

        state.isActive = false;
        state.nextRunAt = null;
        state.lastStatus = state.isRunning ? 'running' : state.lastStatus;

        this.pushCodeJobLog(normalizedJobId, 'warning', 'Job desativado pelo usuário.');
        return this.getCodeJobs().find((j) => j.id === normalizedJobId);
    }

    async runCodeJobNow(jobId: string, options?: RunCodeJobNowOptions) {
        const normalizedJobId = this.assertCodeJob(jobId);
        await this.executeCodeJob(normalizedJobId, 'manual', options);
        return this.getCodeJobs().find((j) => j.id === normalizedJobId);
    }

    @Cron(CronExpression.EVERY_MINUTE)
    async checkAndExecuteCodeJobs() {
        const now = new Date();
        for (const def of this.codeJobDefinitions) {
            const state = this.codeJobStates.get(def.id)!;
            if (!state.isActive || state.isRunning || !state.nextRunAt) continue;

            const nextRun = new Date(state.nextRunAt);
            if (nextRun <= now) {
                await this.executeCodeJob(def.id, 'schedule');
            }
        }
    }

    private async executeCodeJob(
        jobId: CodeJobId,
        trigger: 'manual' | 'schedule',
        options?: RunCodeJobNowOptions,
    ) {
        const state = this.codeJobStates.get(jobId)!;
        if (state.isRunning) return;

        state.isRunning = true;
        state.lastStatus = 'running';
        this.pushCodeJobLog(jobId, 'info', `Iniciando execução (${trigger}).`);

        try {
            let summary = '';

            if (jobId === 'delivery-material-dates') {
                summary = await this.executeDeliveryMaterialDatesJob(jobId, options?.salesOrderDate);
            }

            state.lastStatus = 'success';
            state.lastSummary = summary;
            this.pushCodeJobLog(jobId, 'success', 'Execução concluída com sucesso.', { summary });
        } catch (error) {
            const message = error?.message || 'Erro desconhecido';
            state.lastStatus = 'error';
            state.lastSummary = message;
            this.pushCodeJobLog(jobId, 'error', 'Falha na execução do job.', { message });
        } finally {
            state.isRunning = false;
            state.lastRunAt = new Date().toISOString();
            if (state.isActive) {
                state.nextRunAt = this.calculateNextCodeJobRun(jobId).toISOString();
            }
        }
    }

    private async executeDeliveryMaterialDatesJob(
        jobId: CodeJobId,
        salesOrderDate?: string,
    ): Promise<string> {
        const token = await this.ponttaService.authenticate(this.ponttaEmail, this.ponttaPassword);
        const { startIso, endIso, displayDate } = this.getDateRangeForManausInUtc(salesOrderDate);

        this.pushCodeJobLog(jobId, 'info', 'Buscando pedidos de venda válidos para a data selecionada.', {
            startIso,
            endIso,
            salesOrderDate: displayDate,
        });
        const salesOrders = await this.fetchSalesOrdersByDateRange(token, startIso, endIso, jobId);

        if (salesOrders.length === 0) {
            return 'Nenhum pedido de venda válido encontrado para o período.';
        }

        const rows: DeliveryScheduleRow[] = [];
        let scannedSalesOrders = 0;

        for (const salesOrder of salesOrders) {
            scannedSalesOrders += 1;
            const salesOrderCode = salesOrder?.code;
            if (!salesOrderCode) {
                this.pushCodeJobLog(jobId, 'warning', 'Pedido ignorado por ausência de código.', { salesOrderId: salesOrder?.id || null });
                continue;
            }

            try {
                const revenue = await this.ponttaService.getRevenueBySalesOrderCode(token, salesOrderCode);
                const salesOrderId =
                    revenue?.references?.SALES_ORDER_ID ||
                    salesOrder?.id ||
                    null;

                if (!salesOrderId) {
                    this.pushCodeJobLog(jobId, 'warning', `PV ${salesOrderCode}: SALES_ORDER_ID não encontrado.`);
                    continue;
                }

                const tasks = await this.ponttaService.getSalesOrderTasksSummary(token, salesOrderId, 0, 100);
                const extractedRows = this.extractEnvironmentSchedulesFromTasks(
                    tasks,
                    salesOrderCode,
                    salesOrder?.customer?.name || salesOrder?.customerName || '-',
                    salesOrderId,
                    jobId,
                );

                rows.push(...extractedRows);
                this.pushCodeJobLog(jobId, 'info', `PV ${salesOrderCode}: ${extractedRows.length} ambiente(s) com aprovação concluída.`);
            } catch (error) {
                const message = error?.message || 'Erro desconhecido';
                this.pushCodeJobLog(jobId, 'warning', `PV ${salesOrderCode}: falha ao processar tarefas.`, { message });
            }
        }

        if (rows.length === 0) {
            return `Pedidos lidos: ${scannedSalesOrders}. Nenhum ambiente com tarefa "Aprovação do Projeto Executivo" concluída.`;
        }

        rows.sort((a, b) => {
            if (a.salesOrderCode !== b.salesOrderCode) return a.salesOrderCode.localeCompare(b.salesOrderCode);
            return a.environmentName.localeCompare(b.environmentName);
        });

        const pdfBuffer = await this.generateDeliveryMaterialDatesPdf(rows, displayDate);

        const monthFolderId = await this.googleDriveService.ensureMonthFolderFromSettingsKey('GOOGLE_DRIVE_DELIVERY_FOLDER_ID');
        if (!monthFolderId) {
            throw new HttpException(
                'GOOGLE_DRIVE_DELIVERY_FOLDER_ID não configurado para armazenar o PDF do job.',
                HttpStatus.BAD_REQUEST,
            );
        }

        const fileName = `Datas Entrega Material - ${displayDate}.pdf`;
        await this.googleDriveService.uploadPdf(pdfBuffer, fileName, monthFolderId);

        return `Pedidos lidos: ${scannedSalesOrders} | Ambientes processados: ${rows.length} | PDF salvo: ${fileName}`;
    }

    private async fetchSalesOrdersByDateRange(
        token: string,
        startIso: string,
        endIso: string,
        jobId: CodeJobId,
    ): Promise<any[]> {
        const pageSize = 100;
        let page = 0;
        const all: any[] = [];
        const maxPages = 20;

        while (page < maxPages) {
            const chunk = await this.ponttaService.getSalesOrdersSummaryByDateRange(token, startIso, endIso, page, pageSize);
            all.push(...chunk);
            this.pushCodeJobLog(jobId, 'info', `Página ${page} de pedidos carregada.`, { count: chunk.length });

            if (chunk.length < pageSize) break;
            page += 1;
        }

        return all;
    }

    private extractEnvironmentSchedulesFromTasks(
        tasks: any[],
        salesOrderCode: string,
        customerName: string,
        salesOrderId: string,
        jobId: CodeJobId,
    ): DeliveryScheduleRow[] {
        const markerRegex = /aprova[cç][aã]o do projeto executivo/i;
        const rowsByKey = new Map<string, DeliveryScheduleRow>();

        for (const task of tasks) {
            const title = (task?.title || '').trim();
            if (!markerRegex.test(title)) continue;

            const environmentName = this.extractEnvironmentNameFromTaskTitle(title);

            if (!this.isTaskFinished(task?.stage)) {
                this.pushCodeJobLog(jobId, 'info', `PV ${salesOrderCode} | ${environmentName}: tarefa ainda não concluída.`, {
                    stage: task?.stage || null,
                });
                continue;
            }

            const approvalDate = this.resolveTaskCompletionDate(task);
            if (!approvalDate) {
                this.pushCodeJobLog(jobId, 'warning', `PV ${salesOrderCode} | ${environmentName}: tarefa concluída sem data válida.`);
                continue;
            }

            const productionStartDate = this.addBusinessDays(approvalDate, 10);
            const deliveryFromProductionDate = this.addBusinessDays(productionStartDate, 15);
            const deliveryFromApproval30Date = this.addBusinessDays(approvalDate, 30);
            const deliveryTueOrThuDate = this.adjustToTuesdayOrThursday(deliveryFromApproval30Date);

            const row: DeliveryScheduleRow = {
                salesOrderCode,
                customerName,
                salesOrderId,
                environmentName,
                responsibleName: task?.responsible?.name || '-',
                approvalDate,
                productionStartDate,
                deliveryFromProductionDate,
                deliveryFromApproval30Date,
                deliveryTueOrThuDate,
            };

            const key = `${salesOrderCode}::${environmentName}`;
            const existing = rowsByKey.get(key);
            if (!existing || row.approvalDate > existing.approvalDate) {
                rowsByKey.set(key, row);
            }
        }

        return Array.from(rowsByKey.values());
    }

    private extractEnvironmentNameFromTaskTitle(title: string): string {
        const markerRegex = /aprova[cç][aã]o do projeto executivo/i;
        const match = title.match(markerRegex);
        if (!match || match.index == null) return title;

        const environment = title.slice(0, match.index).trim().replace(/[\-:–\s]+$/, '').trim();
        return environment || title;
    }

    private isTaskFinished(stage: string | undefined): boolean {
        const normalized = (stage || '').toUpperCase();
        return ['FINISHED', 'DONE', 'COMPLETED', 'FINALIZED', 'CLOSED', 'RESOLVED'].includes(normalized);
    }

    private resolveTaskCompletionDate(task: any): Date | null {
        const candidates = [
            task?.moment,
            task?.schedule?.end,
            task?.deadline,
            task?.alert,
            task?.createdDate,
        ];

        for (const candidate of candidates) {
            if (!candidate) continue;
            const parsed = new Date(candidate);
            if (!Number.isNaN(parsed.getTime())) {
                parsed.setHours(0, 0, 0, 0);
                return parsed;
            }
        }
        return null;
    }

    private addBusinessDays(baseDate: Date, businessDays: number): Date {
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

    private adjustToTuesdayOrThursday(baseDate: Date): Date {
        const result = new Date(baseDate);
        result.setHours(0, 0, 0, 0);

        while (result.getDay() !== 2 && result.getDay() !== 4) {
            result.setDate(result.getDate() + 1);
        }

        return result;
    }

    private async generateDeliveryMaterialDatesPdf(rows: DeliveryScheduleRow[], displayDate: string): Promise<Buffer> {
        const rowsHtml = rows
            .map((row, index) => `
                <tr>
                    <td>${index + 1}</td>
                    <td>${this.escapeHtml(row.salesOrderCode)}</td>
                    <td>${this.escapeHtml(row.customerName)}</td>
                    <td>${this.escapeHtml(row.environmentName)}</td>
                    <td>${this.escapeHtml(row.responsibleName)}</td>
                    <td>${this.formatDateBr(row.approvalDate)}</td>
                    <td>${this.formatDateBr(row.productionStartDate)}</td>
                    <td>${this.formatDateBr(row.deliveryFromProductionDate)}</td>
                    <td>${this.formatDateBr(row.deliveryFromApproval30Date)}</td>
                    <td><strong>${this.formatDateBr(row.deliveryTueOrThuDate)}</strong></td>
                </tr>
            `)
            .join('');

        const calendarHtml = this.buildCalendarHtml(rows);

        const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; color: #222; margin: 24px; }
    h1 { margin: 0 0 6px; font-size: 18px; color: #1e3a5f; }
    h2 { margin: 0 0 8px; font-size: 14px; color: #1e3a5f; }
    .subtitle { margin: 0 0 16px; font-size: 12px; color: #4b5563; }
    .meta { margin-bottom: 12px; font-size: 11px; color: #374151; }
    table { width: 100%; border-collapse: collapse; font-size: 10px; }
    th, td { border: 1px solid #d1d5db; padding: 6px; text-align: left; vertical-align: top; }
    th { background: #1e3a5f; color: #fff; font-weight: 600; }
    tr:nth-child(even) td { background: #f9fafb; }
    .footer { margin-top: 12px; font-size: 10px; color: #6b7280; }
    /* Calendários */
    .calendar-section { margin-top: 24px; page-break-before: always; }
    .legend { display: flex; gap: 16px; margin-bottom: 12px; font-size: 10px; align-items: center; flex-wrap: wrap; }
    .legend-item { display: flex; align-items: center; gap: 4px; }
    .legend-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
    .calendars-wrapper { display: flex; flex-wrap: wrap; gap: 14px; }
    .month-cal { border: 1px solid #d1d5db; border-radius: 6px; overflow: hidden; width: 210px; }
    .month-cal-header { background: #1e3a5f; color: #fff; text-align: center; padding: 6px 4px; font-size: 11px; font-weight: 700; }
    .month-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 0; }
    .cal-cell { text-align: center; font-size: 9px; min-height: 26px; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; padding: 2px 1px; border: 1px solid #f3f4f6; }
    .cal-wday { background: #f3f4f6; font-weight: 700; color: #374151; min-height: 18px; justify-content: center; font-size: 8px; border-color: #e5e7eb; }
    .cal-empty { background: #fafafa; }
    .cal-day-num { font-weight: 500; line-height: 1.2; }
    .cal-dots { display: flex; gap: 1px; flex-wrap: wrap; justify-content: center; margin-top: 1px; }
    .cal-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
    .cal-dot-more { font-size: 7px; color: #6b7280; line-height: 1; }
    .has-marks { background: #f0fdf4; }
  </style>
</head>
<body>
  <h1>Datas de Entrega de Material</h1>
  <p class="subtitle">Regra: +10 dias úteis (início produção), +15 dias úteis (entrega), +30 dias úteis com ajuste para terça/quinta.</p>
  <div class="meta">Data de referência: ${this.escapeHtml(displayDate)} | Ambientes processados: ${rows.length}</div>

  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>PV</th>
        <th>Cliente</th>
        <th>Ambiente</th>
        <th>Responsável</th>
        <th>Aprovação Executivo</th>
        <th>Início Produção (+10 úteis)</th>
        <th>Entrega (+15 úteis após início)</th>
        <th>Entrega (+30 úteis da aprovação)</th>
        <th>Entrega final (terça/quinta)</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>

  <div class="calendar-section">
    <h2>Calendário de Entregas</h2>
    <div class="legend">
      <span class="legend-item"><span class="legend-dot" style="background:#9ca3af"></span> Aprovação Executivo</span>
      <span class="legend-item"><span class="legend-dot" style="background:#3b82f6"></span> Início Produção (+10)</span>
      <span class="legend-item"><span class="legend-dot" style="background:#f59e0b"></span> Entrega (+15 da produção)</span>
      <span class="legend-item"><span class="legend-dot" style="background:#ef4444"></span> Entrega +30 úteis</span>
      <span class="legend-item"><span class="legend-dot" style="background:#10b981"></span> <strong>Entrega Final (ter/qui)</strong></span>
    </div>
    ${calendarHtml}
  </div>

  <p class="footer">Documento gerado automaticamente pelo job em ${new Date().toLocaleString('pt-BR')}.</p>
</body>
</html>`;

        let browser: puppeteer.Browser | null = null;
        try {
            browser = await puppeteer.launch({
                headless: true,
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
            });

            const page = await browser.newPage();
            await page.setContent(html, { waitUntil: 'networkidle0' });
            const pdf = await page.pdf({
                format: 'A4',
                landscape: true,
                printBackground: true,
                margin: { top: '12mm', right: '10mm', bottom: '12mm', left: '10mm' },
            });

            return Buffer.from(pdf);
        } finally {
            if (browser) await browser.close();
        }
    }

    private buildCalendarHtml(rows: DeliveryScheduleRow[]): string {
        interface DotMark { color: string; title: string }
        const monthMap = new Map<string, { year: number; month: number; days: Map<number, DotMark[]> }>();

        const markDate = (date: Date, color: string, label: string, row: DeliveryScheduleRow) => {
            const key = `${date.getFullYear()}-${date.getMonth()}`;
            if (!monthMap.has(key)) {
                monthMap.set(key, { year: date.getFullYear(), month: date.getMonth(), days: new Map() });
            }
            const m = monthMap.get(key)!;
            const d = date.getDate();
            if (!m.days.has(d)) m.days.set(d, []);
            m.days.get(d)!.push({ color, title: `${row.salesOrderCode} - ${row.environmentName}: ${label}` });
        };

        for (const row of rows) {
            markDate(row.approvalDate, '#9ca3af', 'Aprovação Executivo', row);
            markDate(row.productionStartDate, '#3b82f6', 'Início Produção', row);
            markDate(row.deliveryFromProductionDate, '#f59e0b', 'Entrega +15 (produção)', row);
            markDate(row.deliveryFromApproval30Date, '#ef4444', 'Entrega +30 úteis', row);
            markDate(row.deliveryTueOrThuDate, '#10b981', 'Entrega Final (ter/qui)', row);
        }

        const sortedMonths = Array.from(monthMap.values()).sort((a, b) => {
            if (a.year !== b.year) return a.year - b.year;
            return a.month - b.month;
        });

        const weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
        const monthNames = [
            'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
            'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
        ];

        let html = '<div class="calendars-wrapper">';

        for (const m of sortedMonths) {
            const { year, month, days } = m;
            const firstDay = new Date(year, month, 1).getDay();
            const daysInMonth = new Date(year, month + 1, 0).getDate();

            html += `<div class="month-cal">`;
            html += `<div class="month-cal-header">${monthNames[month]} ${year}</div>`;
            html += `<div class="month-cal-grid">`;

            for (const wd of weekdays) {
                html += `<div class="cal-cell cal-wday">${wd}</div>`;
            }

            for (let i = 0; i < firstDay; i++) {
                html += `<div class="cal-cell cal-empty"></div>`;
            }

            for (let d = 1; d <= daysInMonth; d++) {
                const marks = days.get(d) || [];
                const hasMarks = marks.length > 0;
                html += `<div class="cal-cell cal-day${hasMarks ? ' has-marks' : ''}">`;
                html += `<span class="cal-day-num">${d}</span>`;
                if (hasMarks) {
                    html += `<div class="cal-dots">`;
                    const shown = marks.slice(0, 4);
                    for (const mark of shown) {
                        html += `<span class="cal-dot" style="background:${mark.color}" title="${this.escapeHtml(mark.title)}"></span>`;
                    }
                    if (marks.length > 4) {
                        html += `<span class="cal-dot-more">+${marks.length - 4}</span>`;
                    }
                    html += `</div>`;
                }
                html += `</div>`;
            }

            html += `</div></div>`;
        }

        html += '</div>';
        return html;
    }

    private formatDateBr(date: Date): string {
        return date.toLocaleDateString('pt-BR');
    }

    private formatDateYmd(date: Date): string {
        const y = date.getFullYear();
        const m = `${date.getMonth() + 1}`.padStart(2, '0');
        const d = `${date.getDate()}`.padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    private getDateRangeForManausInUtc(referenceDate?: string): { startIso: string; endIso: string; displayDate: string } {
        let displayDate = (referenceDate || '').trim();

        if (!displayDate) {
            // Usa ontem em horário de Manaus (job roda à 00:00 = já é o dia seguinte)
            const now = new Date();
            const yesterdayManaus = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            const parts = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'America/Manaus',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
            }).formatToParts(yesterdayManaus);

            const year = parts.find((p) => p.type === 'year')?.value || `${yesterdayManaus.getFullYear()}`;
            const month = parts.find((p) => p.type === 'month')?.value || `${yesterdayManaus.getMonth() + 1}`.padStart(2, '0');
            const day = parts.find((p) => p.type === 'day')?.value || `${yesterdayManaus.getDate()}`.padStart(2, '0');
            displayDate = `${year}-${month}-${day}`;
        }

        if (!/^\d{4}-\d{2}-\d{2}$/.test(displayDate)) {
            throw new HttpException(
                'Data inválida. Use o formato YYYY-MM-DD para salesOrderDate.',
                HttpStatus.BAD_REQUEST,
            );
        }

        const startUtc = new Date(`${displayDate}T00:00:00-04:00`);
        const endUtc = new Date(`${displayDate}T23:59:59.999-04:00`);

        if (Number.isNaN(startUtc.getTime()) || Number.isNaN(endUtc.getTime())) {
            throw new HttpException(
                'Data inválida para cálculo do período em Manaus.',
                HttpStatus.BAD_REQUEST,
            );
        }

        return {
            startIso: startUtc.toISOString(),
            endIso: endUtc.toISOString(),
            displayDate,
        };
    }

    private calculateNextCodeJobRun(jobId: CodeJobId): Date {
        const def = this.codeJobDefinitions.find((d) => d.id === jobId)!;
        const now = new Date();

        const runTimes = [...def.runTimesManaus].sort((a, b) => {
            if (a.hour !== b.hour) return a.hour - b.hour;
            return a.minute - b.minute;
        });

        const manausNow = new Date(now.getTime() + this.MANAUS_UTC_OFFSET_HOURS * 60 * 60 * 1000);

        for (const runTime of runTimes) {
            const candidate = this.createUtcDateFromManausLocal(
                manausNow.getUTCFullYear(),
                manausNow.getUTCMonth() + 1,
                manausNow.getUTCDate(),
                runTime.hour,
                runTime.minute,
            );

            if (candidate > now) {
                return candidate;
            }
        }

        const tomorrowManaus = new Date(Date.UTC(
            manausNow.getUTCFullYear(),
            manausNow.getUTCMonth(),
            manausNow.getUTCDate(),
            0,
            0,
            0,
            0,
        ));
        tomorrowManaus.setUTCDate(tomorrowManaus.getUTCDate() + 1);

        return this.createUtcDateFromManausLocal(
            tomorrowManaus.getUTCFullYear(),
            tomorrowManaus.getUTCMonth() + 1,
            tomorrowManaus.getUTCDate(),
            runTimes[0].hour,
            runTimes[0].minute,
        );
    }

    private createUtcDateFromManausLocal(
        year: number,
        month: number,
        day: number,
        hour: number,
        minute: number,
    ): Date {
        const utcHour = hour - this.MANAUS_UTC_OFFSET_HOURS;
        return new Date(Date.UTC(year, month - 1, day, utcHour, minute, 0, 0));
    }

    private assertCodeJob(jobId: string): CodeJobId {
        const exists = this.codeJobDefinitions.some((def) => def.id === jobId);
        if (!exists) {
            throw new NotFoundException(`Job de código "${jobId}" não encontrado`);
        }
        return jobId as CodeJobId;
    }

    private pushCodeJobLog(jobId: CodeJobId, level: CodeJobLogEntry['level'], message: string, data?: unknown) {
        const logs = this.codeJobLogs.get(jobId) || [];
        logs.push({ timestamp: new Date().toISOString(), level, message, data });
        if (logs.length > this.maxCodeJobLogs) {
            logs.splice(0, logs.length - this.maxCodeJobLogs);
        }
        this.codeJobLogs.set(jobId, logs);

        const extra = data ? ` ${JSON.stringify(data)}` : '';
        if (level === 'error') {
            this.logger.error(`[CodeJob:${jobId}] ${message}${extra}`);
        } else if (level === 'warning') {
            this.logger.warn(`[CodeJob:${jobId}] ${message}${extra}`);
        } else {
            this.logger.log(`[CodeJob:${jobId}] ${message}${extra}`);
        }
    }

    private escapeHtml(text: string): string {
        const source = text || '';
        return source
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    async createJob(createJobDto: CreateJobDto): Promise<ScheduledJob> {
        // Jobs de funcionalidades Gosac não dependem de emails fixos
        const isGosacJob = createJobDto.reportType.startsWith('gosac-');

        if (!isGosacJob) {
            // Verifica se existem emails fixos cadastrados para este tipo de relatório
            const fixedEmails = await this.reportEmailRepository.find({
                where: {
                    reportType: createJobDto.reportType as any,
                    isActive: true
                }
            });

            if (fixedEmails.length === 0) {
                throw new HttpException(
                    `Não é possível criar job: nenhum email fixo cadastrado para relatório do tipo "${createJobDto.reportType}". Cadastre pelo menos um email fixo antes de criar o job.`,
                    HttpStatus.BAD_REQUEST
                );
            }
        }

        const job = this.jobRepository.create(createJobDto);
        job.nextRun = this.calculateNextRun(job);
        console.log(`✅ Job criado: ${job.name}, próxima execução: ${job.nextRun}`);
        return this.jobRepository.save(job);
    }

    async findAll(): Promise<ScheduledJob[]> {
        return this.jobRepository.find({
            order: { createdAt: 'DESC' },
        });
    }

    async findOne(id: string): Promise<ScheduledJob> {
        const job = await this.jobRepository.findOne({ where: { id } });
        if (!job) {
            throw new NotFoundException(`Job ${id} não encontrado`);
        }
        return job;
    }

    async update(id: string, updateJobDto: UpdateJobDto): Promise<ScheduledJob> {
        const job = await this.findOne(id);
        Object.assign(job, updateJobDto);
        job.nextRun = this.calculateNextRun(job);
        return this.jobRepository.save(job);
    }

    async toggleActive(id: string): Promise<ScheduledJob> {
        const job = await this.findOne(id);
        job.isActive = !job.isActive;
        if (job.isActive) {
            job.nextRun = this.calculateNextRun(job);
        }
        return this.jobRepository.save(job);
    }

    async delete(id: string): Promise<void> {
        const job = await this.findOne(id);
        await this.jobRepository.remove(job);
    }

    // Executa a cada minuto para verificar jobs
    @Cron(CronExpression.EVERY_MINUTE)
    async checkAndExecuteJobs() {
        const now = new Date();
        const jobs = await this.jobRepository.find({
            where: { isActive: true },
        });

        for (const job of jobs) {
            if (job.nextRun && job.nextRun <= now) {
                await this.executeJob(job);
            }
        }
    }

    private async executeJob(job: ScheduledJob) {
        try {
            console.log(`🚀 Executando job: ${job.name} (tipo: ${job.reportType})`);

            if (job.reportType.startsWith('gosac-')) {
                // Jobs Gosac — lógica específica por tipo
                if (job.reportType === 'gosac-grupos') {
                    console.log(`📦 Job Gosac Grupos: sincronização de grupos agendada (${job.name})`);
                } else if (job.reportType === 'gosac-pagamento-montador') {
                    console.log(`💰 Job Gosac Pagamento Montador: execução agendada (${job.name})`);
                }
            } else {
                await this.reportService.generateAndSendReport(
                    null, // destinationEmail - não precisa, vai usar fixos
                    undefined, // status
                    job.filters?.limit,
                    job.filters?.startDate,
                    job.filters?.endDate,
                    undefined, // userId
                    true // useFixedEmails - sempre true para jobs
                );
            }

            job.lastRun = new Date();
            job.nextRun = this.calculateNextRun(job);
            await this.jobRepository.save(job);

            console.log(`✅ Job ${job.name} executado com sucesso. Próxima execução: ${job.nextRun}`);
        } catch (error) {
            console.error(`❌ Erro ao executar job ${job.name}:`, error);
        }
    }

    private calculateNextRun(job: ScheduledJob): Date {
        const now = new Date();
        const [hours, minutes] = job.time.split(':').map(Number);

        let nextRun = new Date();
        nextRun.setHours(hours, minutes, 0, 0);

        // Lógica por frequência
        switch (job.frequency) {
            case 'daily':
                // Se o horário de hoje já passou, agenda para amanhã
                if (nextRun <= now) {
                    nextRun.setDate(nextRun.getDate() + 1);
                }
                break;

            case 'weekly':
                // Ajusta para o dia da semana correto
                while (nextRun.getDay() !== job.dayOfWeek || nextRun <= now) {
                    nextRun.setDate(nextRun.getDate() + 1);
                }
                nextRun.setHours(hours, minutes, 0, 0);
                break;

            case 'monthly':
                // Define o dia do mês
                nextRun.setDate(Math.min(job.dayOfMonth, this.getDaysInMonth(nextRun)));
                nextRun.setHours(hours, minutes, 0, 0);

                // Se já passou este mês, vai para o próximo
                if (nextRun <= now) {
                    nextRun.setMonth(nextRun.getMonth() + 1);
                    nextRun.setDate(Math.min(job.dayOfMonth, this.getDaysInMonth(nextRun)));
                    nextRun.setHours(hours, minutes, 0, 0);
                }
                break;
        }

        return nextRun;
    }

    private getDaysInMonth(date: Date): number {
        return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    }
}
