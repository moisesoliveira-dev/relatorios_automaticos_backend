import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { JobService } from './job.service';
import { JobController } from './job.controller';
import { PonttaModule } from '../pontta/pontta.module';
import { CsvModule } from '../csv/csv.module';
import { ExcelModule } from '../excel/excel.module';
import { EmailModule } from '../email/email.module';
import { Report, ReportEmail, ReportExecution } from './entities/report.entity';
import { DashboardMetric, SystemLog } from './entities/dashboard.entity';
import { ScheduledJob } from './entities/job.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            Report,
            ReportEmail,
            ReportExecution,
            DashboardMetric,
            SystemLog,
            ScheduledJob,
        ]),
        PonttaModule,
        CsvModule,
        ExcelModule,
        EmailModule,
    ],
    controllers: [ReportController, DashboardController, JobController],
    providers: [ReportService, DashboardService, JobService],
    exports: [ReportService, DashboardService, JobService],
})
export class ReportModule { }
