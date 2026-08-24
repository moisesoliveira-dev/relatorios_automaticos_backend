import { Module } from '@nestjs/common';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
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
import { InfrastructureConfigModule } from './infrastructure/config/infrastructure-config.module';
import { AppConfigService } from './infrastructure/config/app-config.service';
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

function buildAppDatabaseConfig(appConfig: AppConfigService): TypeOrmModuleOptions {
  const databaseUrl = appConfig.databaseUrl?.trim();
  const baseConfig: TypeOrmModuleOptions = {
    type: 'postgres',
    entities: [
      User,
      Report,
      ReportEmail,
      ReportExecution,
      DashboardMetric,
      SystemLog,
      ScheduledJob,
      Setting,
      GosacGroup,
      PonttaSalesOrder,
      GosacSalesOrderLink,
    ],
    synchronize: !appConfig.isProduction,
    logging: appConfig.isDevelopment,
  };

  if (databaseUrl) {
    const parsed = parseDatabaseUrl(databaseUrl);
    return {
      ...baseConfig,
      ...parsed,
      ssl: appConfig.isProduction ? { rejectUnauthorized: false } : false,
    };
  }

  const db = appConfig.database;
  return {
    ...baseConfig,
    host: db.host,
    port: db.port,
    username: db.username,
    password: db.password,
    database: db.database,
  };
}

function buildRotationDatabaseConfig(appConfig: AppConfigService): TypeOrmModuleOptions {
  const rotationUrl = appConfig.rotationDatabaseUrl?.trim();
  if (!rotationUrl) {
    throw new Error('ROTATION_DATABASE_URL não configurada');
  }

  const parsed = parseDatabaseUrl(rotationUrl);
  return {
    name: 'rotation',
    type: 'postgres',
    entities: [Rotation, PonttaRotation],
    synchronize: false,
    logging: false,
    ...parsed,
    ssl: { rejectUnauthorized: false },
  };
}

const rotationEnabled = !!process.env.ROTATION_DATABASE_URL?.trim();
const rotationImports = rotationEnabled
  ? [
      TypeOrmModule.forRootAsync({
        name: 'rotation',
        imports: [InfrastructureConfigModule],
        useFactory: (appConfig: AppConfigService) => buildRotationDatabaseConfig(appConfig),
        inject: [AppConfigService],
      }),
      RotationModule,
    ]
  : [];

if (process.env.NODE_ENV === 'production' && !rotationEnabled) {
  throw new Error('ROTATION_DATABASE_URL é obrigatória em produção');
}

if (!rotationEnabled) {
  console.warn('[App] ROTATION_DATABASE_URL ausente — módulo de rodízio desabilitado (ok em desenvolvimento local)');
}

@Module({
  imports: [
    InfrastructureConfigModule,
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [InfrastructureConfigModule],
      useFactory: (appConfig: AppConfigService) => buildAppDatabaseConfig(appConfig),
      inject: [AppConfigService],
    }),
    ...rotationImports,
    AuthModule,
    UsersModule,
    SettingsModule,
    ReportModule,
    GosacModule,
  ],
  controllers: [AppController],
  providers: [AppService, AppInitService],
})
export class AppModule {}
