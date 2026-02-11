import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThanOrEqual } from 'typeorm';
import { ReportEmail } from './entities/report.entity';
import { DashboardMetric, SystemLog } from './entities/dashboard.entity';
import { CreateReportEmailDto, UpdateReportEmailDto } from './dto/report.dto';
import { User, UserStatus } from '../users/entities/user.entity';

@Injectable()
export class DashboardService {
    constructor(
        @InjectRepository(ReportEmail)
        private reportEmailRepository: Repository<ReportEmail>,
        @InjectRepository(DashboardMetric)
        private dashboardMetricRepository: Repository<DashboardMetric>,
        @InjectRepository(SystemLog)
        private systemLogRepository: Repository<SystemLog>,
    ) { }

    // ===== REPORT EMAILS =====

    async createReportEmail(dto: CreateReportEmailDto): Promise<ReportEmail> {
        const reportEmail = this.reportEmailRepository.create(dto);
        return this.reportEmailRepository.save(reportEmail);
    }

    async findAllReportEmails(reportType?: string): Promise<ReportEmail[]> {
        const where: any = {};
        if (reportType) {
            where.reportType = reportType;
        }
        return this.reportEmailRepository.find({
            where,
            order: { createdAt: 'DESC' }
        });
    }

    async findActiveReportEmails(reportType: string): Promise<ReportEmail[]> {
        return this.reportEmailRepository.find({
            where: { reportType, isActive: true },
            order: { createdAt: 'DESC' }
        });
    }

    async findReportEmailById(id: string): Promise<ReportEmail> {
        const email = await this.reportEmailRepository.findOne({ where: { id } });
        if (!email) {
            throw new NotFoundException('Email não encontrado');
        }
        return email;
    }

    async updateReportEmail(id: string, dto: UpdateReportEmailDto): Promise<ReportEmail> {
        const email = await this.findReportEmailById(id);
        Object.assign(email, dto);
        return this.reportEmailRepository.save(email);
    }

    async deleteReportEmail(id: string): Promise<void> {
        const email = await this.findReportEmailById(id);
        await this.reportEmailRepository.remove(email);
    }

    async toggleReportEmail(id: string): Promise<ReportEmail> {
        const email = await this.findReportEmailById(id);
        email.isActive = !email.isActive;
        return this.reportEmailRepository.save(email);
    }

    // ===== DASHBOARD METRICS =====

    async getDashboardStats(): Promise<any> {
        const currentPeriod = this.getCurrentPeriod();
        const previousPeriod = this.getPreviousPeriod();

        // Busca métricas do período atual
        const currentMetrics = await this.dashboardMetricRepository.find({
            where: { period: currentPeriod }
        });

        // Busca métricas do período anterior para calcular trends
        const previousMetrics = await this.dashboardMetricRepository.find({
            where: { period: previousPeriod }
        });

        const getMetricValue = (type: string, metrics: DashboardMetric[]) => {
            const metric = metrics.find(m => m.metricType === type);
            return metric?.value || 0;
        };

        const calculateTrend = (current: number, previous: number): number => {
            if (previous === 0) return current > 0 ? 100 : 0;
            return Math.round(((current - previous) / previous) * 100);
        };

        const reportsGenerated = getMetricValue('reports_generated', currentMetrics);
        const emailsSent = getMetricValue('emails_sent', currentMetrics);
        const occurrencesFetched = getMetricValue('occurrences_fetched', currentMetrics);

        const prevReportsGenerated = getMetricValue('reports_generated', previousMetrics);
        const prevEmailsSent = getMetricValue('emails_sent', previousMetrics);
        const prevOccurrencesFetched = getMetricValue('occurrences_fetched', previousMetrics);

        // Conta usuários ativos diretamente (sem injetar UserRepository)
        // Vamos retornar um valor padrão por agora
        const activeUsers = 1; // Valor padrão, será atualizado quando houver integração

        return {
            reportsGenerated,
            emailsSent,
            occurrencesFetched,
            activeUsers,
            reportsGeneratedTrend: calculateTrend(reportsGenerated, prevReportsGenerated),
            emailsSentTrend: calculateTrend(emailsSent, prevEmailsSent),
            occurrencesFetchedTrend: calculateTrend(occurrencesFetched, prevOccurrencesFetched),
            activeUsersTrend: 0,
        };
    }

    private getCurrentPeriod(): string {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    private getPreviousPeriod(): string {
        const now = new Date();
        now.setMonth(now.getMonth() - 1);
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    async incrementMetric(metricType: string, increment: number = 1): Promise<void> {
        const period = this.getCurrentPeriod();

        let metric = await this.dashboardMetricRepository.findOne({
            where: { metricType, period }
        });

        if (metric) {
            metric.value += increment;
            await this.dashboardMetricRepository.save(metric);
        } else {
            // Busca valor anterior para referência
            const previousPeriod = this.getPreviousPeriod();
            const previousMetric = await this.dashboardMetricRepository.findOne({
                where: { metricType, period: previousPeriod }
            });

            metric = this.dashboardMetricRepository.create({
                metricType,
                period,
                value: increment,
                previousValue: previousMetric?.value || 0
            });
            await this.dashboardMetricRepository.save(metric);
        }
    }

    // ===== SYSTEM STATUS =====

    async getSystemStatus(): Promise<{ name: string; status: string; latency: string }[]> {
        const services = ['api_backend', 'database', 'api_pontta', 'email_server'];
        const result: { name: string; status: string; latency: string }[] = [];

        for (const service of services) {
            const latestLog = await this.systemLogRepository.findOne({
                where: { service },
                order: { checkedAt: 'DESC' }
            });

            result.push({
                name: this.getServiceDisplayName(service),
                status: latestLog?.status || 'online',
                latency: latestLog?.latencyMs ? `${latestLog.latencyMs}ms` : '-'
            });
        }

        return result;
    }

    private getServiceDisplayName(service: string): string {
        const names: Record<string, string> = {
            'api_backend': 'API Backend',
            'database': 'Banco de Dados',
            'api_pontta': 'API Pontta',
            'email_server': 'Servidor de Email'
        };
        return names[service] || service;
    }

    async logSystemStatus(service: string, status: string, latencyMs?: number, message?: string): Promise<void> {
        const log = this.systemLogRepository.create({
            service,
            status,
            latencyMs,
            message
        });
        await this.systemLogRepository.save(log);
    }

    // ===== RECENT REPORTS (para Dashboard) =====

    async getRecentReports(limit: number = 5): Promise<any[]> {
        // Isso será preenchido pelo ReportService quando persistirmos execuções
        // Por agora retorna dados mockados se não houver dados
        return [];
    }
}
