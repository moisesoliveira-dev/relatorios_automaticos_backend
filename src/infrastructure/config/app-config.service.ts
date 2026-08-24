import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppEnvironment, EnvConfig } from './env.validation';

@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService) {}

  get env(): EnvConfig {
    return this.configService.get<EnvConfig>('env')!;
  }

  get nodeEnv(): AppEnvironment {
    return this.env.NODE_ENV;
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get isDevelopment(): boolean {
    return this.nodeEnv === 'development';
  }

  get port(): number {
    return this.env.PORT;
  }

  get frontendUrl(): string {
    return this.env.FRONTEND_URL;
  }

  get jwtSecret(): string {
    return this.env.JWT_SECRET;
  }

  get jwtExpiresIn(): string {
    return this.env.JWT_EXPIRES_IN;
  }

  get encryptionKey(): string {
    return this.env.ENCRYPTION_KEY;
  }

  get ponttaCredentials(): { email: string; password: string } {
    return {
      email: this.env.PONTTA_EMAIL,
      password: this.env.PONTTA_PASSWORD,
    };
  }

  get ponttaApi(): {
    authUrl: string;
    apiUrl: string;
    apiKey: string;
    businessUnitId?: string;
  } {
    return {
      authUrl: this.env.PONTTA_AUTH_URL,
      apiUrl: this.env.PONTTA_API_URL,
      apiKey: this.env.PONTTA_API_KEY,
      businessUnitId: this.env.PONTTA_BUSINESS_UNIT_ID,
    };
  }

  get gosacApi(): { baseUrl?: string; apiKey?: string } {
    return {
      baseUrl: this.env.GOSAC_BASE_URL,
      apiKey: this.env.GOSAC_API_KEY,
    };
  }

  get rotationDatabaseUrl(): string | undefined {
    return this.env.ROTATION_DATABASE_URL;
  }

  get databaseUrl(): string | undefined {
    return this.env.DATABASE_URL;
  }

  get database(): {
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
  } {
    return {
      host: this.env.DB_HOST,
      port: this.env.DB_PORT,
      username: this.env.DB_USERNAME,
      password: this.env.DB_PASSWORD,
      database: this.env.DB_DATABASE,
    };
  }
}
