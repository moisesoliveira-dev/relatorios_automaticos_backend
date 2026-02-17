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
      useFactory: (configService: ConfigService) => {
        // Railway fornece DATABASE_URL automaticamente ao adicionar o plugin PostgreSQL
        const databaseUrl = configService.get<string>('DATABASE_URL');
        const baseConfig = {
          type: 'postgres' as const,
          entities: [User, Report, ReportEmail, ReportExecution, DashboardMetric, SystemLog, ScheduledJob, Setting],
          synchronize: true,
          logging: false,
        };

        if (databaseUrl) {
          return {
            ...baseConfig,
            url: databaseUrl,
            ssl: { rejectUnauthorized: false }, // Necessário no Railway
          };
        }

        return {
          ...baseConfig,
          host: configService.get<string>('DB_HOST', 'localhost'),
          port: configService.get<number>('DB_PORT', 5432),
          username: configService.get<string>('DB_USERNAME', 'postgres'),
          password: configService.get<string>('DB_PASSWORD', 'postgres123'),
          database: configService.get<string>('DB_DATABASE', 'relatorios_db'),
        };
      },
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
