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

  get gosacWebhookSecret(): string | undefined {
    return this.env.GOSAC_WEBHOOK_SECRET;
  }

  get masterSetupToken(): string | undefined {
    return this.env.MASTER_SETUP_TOKEN;
  }

  get dbSslRejectUnauthorized(): boolean {
    return this.env.DB_SSL_REJECT_UNAUTHORIZED;
  }

  /** SSL do banco: DB_SSL explícito vence; sem ele, produção liga e o resto desliga. */
  get dbSsl(): boolean {
    return this.env.DB_SSL ?? this.isProduction;
  }

  get dbSynchronize(): boolean {
    return this.env.DB_SYNCHRONIZE;
  }

  /**
   * Ajustes editados pela tela da IA (tabela settings). Valem na hora, em todas as instâncias
   * (recarregados a cada 30 s) e têm prioridade sobre as variáveis de ambiente.
   */
  private runtime: Record<string, string> = {};

  setRuntimeOverrides(map: Record<string, string>): void {
    this.runtime = { ...map };
  }

  runtimeOverrides(): Readonly<Record<string, string>> {
    return this.runtime;
  }

  private pick(key: string): string | undefined {
    const v = this.runtime[key];
    return v === undefined || v === '' ? undefined : v;
  }
  private bool(key: string, fallback: boolean): boolean {
    const v = this.pick(key);
    return v === undefined ? fallback : v === 'true';
  }
  private num(key: string, fallback: number): number {
    const v = this.pick(key);
    const n = v === undefined ? NaN : Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  private optNum(key: string, fallback?: number): number | undefined {
    const v = this.pick(key);
    if (v === undefined) return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  private str(key: string, fallback?: string): string | undefined {
    return this.pick(key) ?? fallback;
  }

  get chatbot() {
    const e = this.env;
    return {
      enabled: this.bool('CHATBOT_ENABLED', e.CHATBOT_ENABLED),
      aiEnabled: this.bool('CHATBOT_AI_ENABLED', e.CHATBOT_AI_ENABLED),
      ponttaEnabled: this.bool('CHATBOT_PONTTA_ENABLED', e.CHATBOT_PONTTA_ENABLED),
      debounceMs: this.num('CHATBOT_DEBOUNCE_MS', e.CHATBOT_DEBOUNCE_MS),
      maxInvalid: this.num('CHATBOT_MAX_INVALID', e.CHATBOT_MAX_INVALID),
      maxOffTopic: this.num('CHATBOT_MAX_OFF_TOPIC', e.CHATBOT_MAX_OFF_TOPIC),
      humanize: this.bool('CHATBOT_HUMANIZE', e.CHATBOT_HUMANIZE),
      typingDelay: this.bool('CHATBOT_TYPING_DELAY', e.CHATBOT_TYPING_DELAY),
      writerDailyLimit: this.num('CHATBOT_WRITER_DAILY_LIMIT', e.CHATBOT_WRITER_DAILY_LIMIT),
      aiDailyLimit: this.num('CHATBOT_AI_DAILY_LIMIT', e.CHATBOT_AI_DAILY_LIMIT),
      humanIdleMinutes: this.num('CHATBOT_HUMAN_IDLE_MINUTES', e.CHATBOT_HUMAN_IDLE_MINUTES),
      measureOwnerId: this.str('CHATBOT_MEASURE_OWNER_ID', e.CHATBOT_MEASURE_OWNER_ID),
      dealWorkflowId: this.str('CHATBOT_DEAL_WORKFLOW_ID', e.CHATBOT_DEAL_WORKFLOW_ID),
      dealFallbackEmail: this.str('CHATBOT_DEAL_FALLBACK_EMAIL', e.CHATBOT_DEAL_FALLBACK_EMAIL),
      driveRootFolderId: this.str('CHATBOT_DRIVE_ROOT_FOLDER_ID', e.CHATBOT_DRIVE_ROOT_FOLDER_ID),
      fallbackGosacUserId: this.optNum('CHATBOT_FALLBACK_GOSAC_USER_ID', e.CHATBOT_FALLBACK_GOSAC_USER_ID),
      fallbackGosacQueueId: this.optNum('CHATBOT_FALLBACK_GOSAC_QUEUE_ID', e.CHATBOT_FALLBACK_GOSAC_QUEUE_ID),
    };
  }

  get openai() {
    const e = this.env;
    return {
      apiKey: this.str('OPENAI_API_KEY', e.OPENAI_API_KEY),
      model: this.str('OPENAI_MODEL', e.OPENAI_MODEL)!,
      temperature: e.OPENAI_TEMPERATURE,
      timeoutMs: e.OPENAI_TIMEOUT_MS,
    };
  }

  /** Modelo de um agente: ajuste da tela > variável OPENAI_MODEL_<AGENTE> > modelo padrão. */
  modelFor(agent: string): string {
    const key = `OPENAI_MODEL_${agent.toUpperCase()}`;
    return this.pick(key) || process.env[key]?.trim() || this.openai.model;
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

  get jobsEnabled(): boolean {
    return this.env.JOBS_ENABLED !== 'false';
  }

  get autoTasks(): {
    diasChecagemMedida: number;
    diasRevisaoProjeto: number;
    diasProjetoExecutivo: number;
    diasAprovacaoExecutivo: number;
    diasEnvioCliente: number;
  } {
    return {
      diasChecagemMedida: Number(this.env.TASK_DIAS_CHECAGEM_MEDIDA || 2),
      diasRevisaoProjeto: Number(this.env.TASK_DIAS_REVISAO_PROJETO || 2),
      diasProjetoExecutivo: Number(this.env.TASK_DIAS_PROJETO_EXECUTIVO || 2),
      diasAprovacaoExecutivo: Number(this.env.TASK_DIAS_APROVACAO_EXECUTIVO || 2),
      diasEnvioCliente: Number(this.env.TASK_DIAS_ENVIO_CLIENTE || 2),
    };
  }
}
