import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { PonttaService } from '../pontta/pontta.service';
import { CsvService } from '../csv/csv.service';
import { ExcelService } from '../excel/excel.service';
import { EmailService } from '../email/email.service';
import { Report, ReportExecution, ReportStatus, ReportType, ReportEmail } from './entities/report.entity';
import { DashboardService } from './dashboard.service';
import { CreateReportDto, UpdateReportDto, GenerateReportDto } from './dto/report.dto';

@Injectable()
export class ReportService {
    private ponttaEmail: string;
    private ponttaPassword: string;

    constructor(
        @InjectRepository(Report)
        private reportRepository: Repository<Report>,
        @InjectRepository(ReportExecution)
        private executionRepository: Repository<ReportExecution>,
        @InjectRepository(ReportEmail)
        private reportEmailRepository: Repository<ReportEmail>,
        private readonly ponttaService: PonttaService,
        private readonly csvService: CsvService,
        private readonly excelService: ExcelService,
        private readonly emailService: EmailService,
        private readonly configService: ConfigService,
        private readonly dashboardService: DashboardService,
    ) {
        this.ponttaEmail = this.configService.get<string>('PONTTA_EMAIL') || '';
        this.ponttaPassword = this.configService.get<string>('PONTTA_PASSWORD') || '';
    }

    // ===== CRUD DE RELATÓRIOS =====

    async createReport(dto: CreateReportDto, userId: string): Promise<Report> {
        const report = this.reportRepository.create({
            ...dto,
            createdById: userId,
            status: ReportStatus.PENDING,
        });
        return this.reportRepository.save(report);
    }

    async findAllReports(): Promise<Report[]> {
        return this.reportRepository.find({
            order: { createdAt: 'DESC' },
            relations: ['createdBy'],
        });
    }

    async findReportById(id: string): Promise<Report> {
        const report = await this.reportRepository.findOne({
            where: { id },
            relations: ['createdBy'],
        });
        if (!report) {
            throw new NotFoundException('Relatório não encontrado');
        }
        return report;
    }

    async updateReport(id: string, dto: UpdateReportDto): Promise<Report> {
        const report = await this.findReportById(id);
        Object.assign(report, dto);
        return this.reportRepository.save(report);
    }

    async deleteReport(id: string): Promise<void> {
        const report = await this.findReportById(id);
        await this.reportRepository.remove(report);
    }

    // ===== EXECUÇÕES DE RELATÓRIOS =====

    async getReportExecutions(reportId?: string, limit: number = 20): Promise<ReportExecution[]> {
        const where: any = {};
        if (reportId) {
            where.reportId = reportId;
        }
        return this.executionRepository.find({
            where,
            order: { executedAt: 'DESC' },
            take: limit,
            relations: ['report', 'executedBy'],
        });
    }

    async getRecentExecutions(limit: number = 5): Promise<any[]> {
        const executions = await this.executionRepository.find({
            order: { executedAt: 'DESC' },
            take: limit,
            relations: ['report'],
        });

        return executions.map(exec => ({
            id: exec.id,
            name: exec.report?.name || 'Ocorrências Pontta',
            date: exec.executedAt.toLocaleString('pt-BR'),
            status: exec.status === ReportStatus.SUCCESS ? 'success' :
                exec.status === ReportStatus.FAILED ? 'failed' : 'pending',
            records: exec.recordsProcessed,
        }));
    }

    // ===== GERAÇÃO E ENVIO DE RELATÓRIOS =====

    async generateAndSendReport(
        destinationEmail: string | null,
        status?: string,
        limit?: number,
        startDate?: string,
        endDate?: string,
        userId?: string,
        useFixedEmails?: boolean,
    ) {
        const startTime = Date.now();

        // Cria registro de execução
        const execution = this.executionRepository.create({
            status: ReportStatus.PROCESSING,
            executedById: userId || null,
        });
        await this.executionRepository.save(execution);

        try {
            // 1. Autentica na API Pontta
            const token = await this.ponttaService.authenticate(this.ponttaEmail, this.ponttaPassword);

            // 2. Busca todas as ocorrências
            let occurrences = await this.ponttaService.getAllOccurrences(token, status);

            // 3. Aplica filtros de data
            occurrences = this.applyDateFilters(occurrences, startDate, endDate);

            // 4. Aplica limite se especificado
            if (limit && limit > 0) {
                occurrences = occurrences.slice(0, limit);
            }

            // 5. Filtra apenas os campos necessários
            const filteredData = this.ponttaService.filterOccurrenceFields(occurrences);

            // 6. Gera o Excel
            const excelBuffer = await this.excelService.generateExcel(filteredData);

            // 7. Coleta emails para envio
            const emailsToSend: string[] = [];

            if (destinationEmail) {
                emailsToSend.push(destinationEmail);
            }

            if (useFixedEmails) {
                const fixedEmails = await this.reportEmailRepository.find({
                    where: { reportType: 'occurrences', isActive: true }
                });
                emailsToSend.push(...fixedEmails.map(e => e.email));
            }

            // Remove duplicatas
            const uniqueEmails = [...new Set(emailsToSend)];

            if (uniqueEmails.length === 0) {
                throw new Error('Nenhum email disponível para envio');
            }

            // 8. Envia para todos os emails
            for (const email of uniqueEmails) {
                await this.emailService.sendReportEmail(email, excelBuffer, true);
            }

            // Atualiza execução
            execution.status = ReportStatus.SUCCESS;
            execution.recordsProcessed = filteredData.length;
            execution.emailsSentTo = uniqueEmails;
            execution.completedAt = new Date();
            execution.durationMs = Date.now() - startTime;
            await this.executionRepository.save(execution);

            // Atualiza métricas do dashboard
            await this.dashboardService.incrementMetric('reports_generated');
            await this.dashboardService.incrementMetric('emails_sent', uniqueEmails.length);
            await this.dashboardService.incrementMetric('occurrences_fetched', filteredData.length);

            return {
                executionId: execution.id,
                totalRecords: filteredData.length,
                sentTo: uniqueEmails,
                generatedAt: new Date().toISOString(),
                durationMs: execution.durationMs,
            };
        } catch (error) {
            // Atualiza execução com erro
            execution.status = ReportStatus.FAILED;
            execution.errorMessage = error.message;
            execution.completedAt = new Date();
            execution.durationMs = Date.now() - startTime;
            await this.executionRepository.save(execution);

            throw error;
        }
    }

    async generateReportExcel(
        status?: string,
        limit?: number,
        startDate?: string,
        endDate?: string
    ): Promise<Buffer> {
        // 1. Autentica na API Pontta
        const token = await this.ponttaService.authenticate(this.ponttaEmail, this.ponttaPassword);

        // 2. Busca todas as ocorrências
        let occurrences = await this.ponttaService.getAllOccurrences(token, status);

        // 3. Aplica filtros de data
        occurrences = this.applyDateFilters(occurrences, startDate, endDate);

        // 4. Aplica limite se especificado
        if (limit && limit > 0) {
            occurrences = occurrences.slice(0, limit);
        }

        // 5. Filtra apenas os campos necessários
        const filteredData = this.ponttaService.filterOccurrenceFields(occurrences);

        // 6. Gera e retorna o Excel
        return this.excelService.generateExcel(filteredData);
    }

    async generateReportCsv(
        status?: string,
        limit?: number,
        startDate?: string,
        endDate?: string
    ): Promise<string> {
        // 1. Autentica na API Pontta
        const token = await this.ponttaService.authenticate(this.ponttaEmail, this.ponttaPassword);

        // 2. Busca todas as ocorrências
        let occurrences = await this.ponttaService.getAllOccurrences(token, status);

        // 3. Aplica filtros de data
        occurrences = this.applyDateFilters(occurrences, startDate, endDate);

        // 4. Aplica limite se especificado
        if (limit && limit > 0) {
            occurrences = occurrences.slice(0, limit);
        }

        // 5. Filtra apenas os campos necessários
        const filteredData = this.ponttaService.filterOccurrenceFields(occurrences);

        // 6. Gera e retorna o CSV
        return this.csvService.generateCsv(filteredData);
    }

    async previewReport(
        status?: string,
        page: number = 0,
        size: number = 10,
        startDate?: string,
        endDate?: string
    ) {
        // 1. Autentica na API Pontta
        const token = await this.ponttaService.authenticate(this.ponttaEmail, this.ponttaPassword);

        // 2. Busca todas as ocorrências para contar total
        let allOccurrences = await this.ponttaService.getAllOccurrences(token, status);

        // 3. Aplica filtros de data
        allOccurrences = this.applyDateFilters(allOccurrences, startDate, endDate);

        const total = allOccurrences.length;

        // 4. Aplica paginação
        const start = page * size;
        const paginatedOccurrences = allOccurrences.slice(start, start + size);

        // 5. Filtra apenas os campos necessários
        const filteredData = this.ponttaService.filterOccurrenceFields(paginatedOccurrences);

        return {
            data: filteredData,
            pagination: {
                page,
                size,
                total,
                totalPages: Math.ceil(total / size),
            },
            generatedAt: new Date().toISOString(),
        };
    }

    private applyDateFilters(occurrences: any[], startDate?: string, endDate?: string): any[] {
        let filtered = [...occurrences];

        if (startDate) {
            const start = new Date(startDate);
            filtered = filtered.filter(occ => {
                const created = new Date(occ.createdDate);
                return created >= start;
            });
        }

        if (endDate) {
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999); // Inclui o dia inteiro
            filtered = filtered.filter(occ => {
                const created = new Date(occ.createdDate);
                return created <= end;
            });
        }

        return filtered;
    }
}
