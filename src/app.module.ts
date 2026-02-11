import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppInitService } from './app-init.service';
import { ReportModule } from './report/report.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { SettingsModule } from './settings/settings.module';
import { User } from './users/entities/user.entity';
import { Report, ReportEmail, ReportExecution } from './report/entities/report.entity';
import { DashboardMetric, SystemLog } from './report/entities/dashboard.entity';
import { ScheduledJob } from './report/entities/job.entity';
import { Setting } from './settings/entities/setting.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('DB_HOST', 'localhost'),
        port: configService.get('DB_PORT', 5432),
        username: configService.get('DB_USERNAME', 'postgres'),
        password: configService.get('DB_PASSWORD', 'postgres123'),
        database: configService.get('DB_DATABASE', 'relatorios_db'),
        entities: [User, Report, ReportEmail, ReportExecution, DashboardMetric, SystemLog, ScheduledJob, Setting],
        synchronize: true, // Apenas em desenvolvimento
        logging: false,
      }),
      inject: [ConfigService],
    }),
    AuthModule,
    UsersModule,
    SettingsModule,
    ReportModule,
  ],
  controllers: [AppController],
  providers: [AppService, AppInitService],
})
export class AppModule { }
