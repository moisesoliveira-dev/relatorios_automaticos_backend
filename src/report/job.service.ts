import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ScheduledJob } from './entities/job.entity';
import { CreateJobDto, UpdateJobDto } from './dto/job.dto';
import { ReportService } from './report.service';
import { ReportEmail } from './entities/report.entity';
import { HttpException, HttpStatus } from '@nestjs/common';

@Injectable()
export class JobService {
    constructor(
        @InjectRepository(ScheduledJob)
        private jobRepository: Repository<ScheduledJob>,
        @InjectRepository(ReportEmail)
        private reportEmailRepository: Repository<ReportEmail>,
        private reportService: ReportService,
    ) { }

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
