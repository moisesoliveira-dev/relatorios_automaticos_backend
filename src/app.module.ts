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
import { GosacModule } from './gosac/gosac.module';
import { RotationModule } from './rotation/rotation.module';
import { User } from './users/entities/user.entity';
import { Report, ReportEmail, ReportExecution } from './report/entities/report.entity';
import { GosacGroup } from './gosac/entities/gosac-group.entity';
import { PonttaSalesOrder } from './gosac/entities/pontta-sales-order.entity';
import { GosacSalesOrderLink } from './gosac/entities/gosac-sales-order-link.entity';
import { DashboardMetric, SystemLog } from './report/entities/dashboard.entity';
import { ScheduledJob } from './report/entities/job.entity';
import { Setting } from './settings/entities/setting.entity';
import { Rotation } from './rotation/entities/rotation.entity';
import { PonttaRotation } from './rotation/entities/pontta-rotation.entity';

function parseDatabaseUrl(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port, 10) || 5432,
    username: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ''),
  };
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    // Conexão principal do app (users, settings, reports, etc.)
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const databaseUrl = configService.get<string>('DATABASE_URL')?.trim();
        const baseConfig = {
          type: 'postgres' as const,
          entities: [User, Report, ReportEmail, ReportExecution, DashboardMetric, SystemLog, ScheduledJob, Setting, GosacGroup, PonttaSalesOrder, GosacSalesOrderLink],
          synchronize: true,
          logging: false,
        };

        console.log('=== DATABASE CONFIG (app) ===');
        console.log('DATABASE_URL presente:', !!databaseUrl);

        if (databaseUrl) {
          const parsed = parseDatabaseUrl(databaseUrl);
          console.log('Modo: DATABASE_URL');
          console.log('Host:', parsed.host);
          console.log('Database:', parsed.database);
          console.log('============================');
          return {
            ...baseConfig,
            ...parsed,
            ssl: { rejectUnauthorized: false },
          };
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
        console.log('Database:', config.database);
        console.log('============================');
        return config;
      },
      inject: [ConfigService],
    }),
    // Conexão separada só para tb_rotation (outro banco Railway)
    TypeOrmModule.forRootAsync({
      name: 'rotation',
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const rotationUrl = configService.get<string>('ROTATION_DATABASE_URL')?.trim();
        console.log('=== DATABASE CONFIG (rotation) ===');
        console.log('ROTATION_DATABASE_URL presente:', !!rotationUrl);

        if (!rotationUrl) {
          throw new Error('ROTATION_DATABASE_URL não configurada — necessário para o CRUD de rodízio');
        }

        const parsed = parseDatabaseUrl(rotationUrl);
        console.log('Host:', parsed.host);
        console.log('Database:', parsed.database);
        console.log('==================================');

        return {
          name: 'rotation',
          type: 'postgres' as const,
          entities: [Rotation, PonttaRotation],
          // Tabelas já existem e são gerenciadas por outro sistema
          synchronize: false,
          logging: false,
          ...parsed,
          ssl: { rejectUnauthorized: false },
        };
      },
      inject: [ConfigService],
    }),
    AuthModule,
    UsersModule,
    SettingsModule,
    ReportModule,
    GosacModule,
    RotationModule,
  ],
  controllers: [AppController],
  providers: [AppService, AppInitService],
})
export class AppModule { }
