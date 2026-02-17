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

        console.log('=== DATABASE CONFIG ===');
        console.log('DATABASE_URL presente:', !!databaseUrl);
        console.log('DATABASE_URL raw:', databaseUrl ?? '(não definida)');

        if (databaseUrl) {
          // Parseia a URL manualmente para evitar problemas com o driver pg
          const parsed = new URL(databaseUrl);
          const config = {
            ...baseConfig,
            host: parsed.hostname,
            port: parseInt(parsed.port, 10) || 5432,
            username: decodeURIComponent(parsed.username),
            password: decodeURIComponent(parsed.password),
            database: parsed.pathname.replace(/^\//, ''),
            ssl: { rejectUnauthorized: false },
          };
          console.log('Modo: DATABASE_URL');
          console.log('Host:', config.host);
          console.log('Port:', config.port);
          console.log('Username:', config.username);
          console.log('Password:', config.password ? `${config.password.slice(0, 3)}***` : '(vazia)');
          console.log('Database:', config.database);
          console.log('======================');
          return config;
        }

        const config = {
          ...baseConfig,
          host: configService.get<string>('DB_HOST', 'localhost'),
          port: configService.get<number>('DB_PORT', 5432),
          username: configService.get<string>('DB_USERNAME', 'postgres'),
          password: configService.get<string>('DB_PASSWORD', 'postgres123'),
          database: configService.get<string>('DB_DATABASE', 'relatorios_db'),
        };
        console.log('Modo: variáveis individuais');
        console.log('Host:', config.host);
        console.log('Port:', config.port);
        console.log('Username:', config.username);
        console.log('Password:', config.password ? `${config.password.slice(0, 3)}***` : '(vazia)');
        console.log('Database:', config.database);
        console.log('======================');
        return config;
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
