export type AppEnvironment = 'development' | 'production' | 'test';

export interface EnvConfig {
  NODE_ENV: AppEnvironment;
  PORT: number;
  FRONTEND_URL: string;
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  ENCRYPTION_KEY: string;
  DB_HOST: string;
  DB_PORT: number;
  DB_USERNAME: string;
  DB_PASSWORD: string;
  DB_DATABASE: string;
  DATABASE_URL?: string;
  ROTATION_DATABASE_URL?: string;
  PONTTA_AUTH_URL: string;
  PONTTA_API_URL: string;
  PONTTA_API_KEY: string;
  PONTTA_BUSINESS_UNIT_ID?: string;
  PONTTA_EMAIL: string;
  PONTTA_PASSWORD: string;
  GOSAC_BASE_URL?: string;
  GOSAC_API_KEY?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  SMTP_FROM?: string;
  JOBS_ENABLED?: string;
  TASK_DIAS_CHECAGEM_MEDIDA?: string;
  TASK_DIAS_REVISAO_PROJETO?: string;
  TASK_DIAS_PROJETO_EXECUTIVO?: string;
  TASK_DIAS_APROVACAO_EXECUTIVO?: string;
  TASK_DIAS_ENVIO_CLIENTE?: string;
}

function readString(config: Record<string, unknown>, key: string, fallback?: string): string | undefined {
  const raw = config[key];
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return fallback;
  }
  return String(raw).trim();
}

function readNumber(config: Record<string, unknown>, key: string, fallback: number): number {
  const raw = config[key];
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Valida variáveis de ambiente na inicialização (fail-fast em produção). */
export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const nodeEnv = (readString(config, 'NODE_ENV', 'development') || 'development') as AppEnvironment;
  const isProduction = nodeEnv === 'production';
  const errors: string[] = [];

  const jwtSecret = readString(config, 'JWT_SECRET');
  const encryptionKey = readString(config, 'ENCRYPTION_KEY');
  const ponttaEmail = readString(config, 'PONTTA_EMAIL');
  const ponttaPassword = readString(config, 'PONTTA_PASSWORD');

  if (!jwtSecret) {
    errors.push('JWT_SECRET é obrigatório');
  } else if (isProduction && jwtSecret.length < 32) {
    errors.push('JWT_SECRET deve ter ao menos 32 caracteres em produção');
  }

  if (!encryptionKey) {
    errors.push('ENCRYPTION_KEY é obrigatório');
  } else if (isProduction && encryptionKey.length < 32) {
    errors.push('ENCRYPTION_KEY deve ter ao menos 32 caracteres em produção');
  }

  if (!ponttaEmail) errors.push('PONTTA_EMAIL é obrigatório');
  if (!ponttaPassword) errors.push('PONTTA_PASSWORD é obrigatório');

  const ponttaApiKey = readString(config, 'PONTTA_API_KEY');
  if (!ponttaApiKey) errors.push('PONTTA_API_KEY é obrigatório');

  if (isProduction && !readString(config, 'DATABASE_URL') && !readString(config, 'DB_HOST')) {
    errors.push('DATABASE_URL ou DB_* são obrigatórios em produção');
  }

  if (errors.length > 0) {
    throw new Error(`Configuração de ambiente inválida:\n- ${errors.join('\n- ')}`);
  }

  return {
    NODE_ENV: nodeEnv,
    PORT: readNumber(config, 'PORT', 3000),
    FRONTEND_URL: readString(config, 'FRONTEND_URL', 'http://localhost:4200')!,
    JWT_SECRET: jwtSecret!,
    JWT_EXPIRES_IN: readString(config, 'JWT_EXPIRES_IN', '7d')!,
    ENCRYPTION_KEY: encryptionKey!,
    DB_HOST: readString(config, 'DB_HOST', 'localhost')!,
    DB_PORT: readNumber(config, 'DB_PORT', 5432),
    DB_USERNAME: readString(config, 'DB_USERNAME', 'postgres')!,
    DB_PASSWORD: readString(config, 'DB_PASSWORD', 'postgres123')!,
    DB_DATABASE: readString(config, 'DB_DATABASE', 'relatorios_db')!,
    DATABASE_URL: readString(config, 'DATABASE_URL'),
    ROTATION_DATABASE_URL: readString(config, 'ROTATION_DATABASE_URL'),
    PONTTA_AUTH_URL: readString(config, 'PONTTA_AUTH_URL', 'https://api.pontta.com/api/authenticate')!,
    PONTTA_API_URL: readString(config, 'PONTTA_API_URL', 'https://app.pontta.com/api')!,
    PONTTA_API_KEY: ponttaApiKey!,
    PONTTA_BUSINESS_UNIT_ID: readString(config, 'PONTTA_BUSINESS_UNIT_ID'),
    PONTTA_EMAIL: ponttaEmail!,
    PONTTA_PASSWORD: ponttaPassword!,
    GOSAC_BASE_URL: readString(config, 'GOSAC_BASE_URL'),
    GOSAC_API_KEY: readString(config, 'GOSAC_API_KEY'),
    SMTP_HOST: readString(config, 'SMTP_HOST'),
    SMTP_PORT: readString(config, 'SMTP_PORT'),
    SMTP_USER: readString(config, 'SMTP_USER'),
    SMTP_PASS: readString(config, 'SMTP_PASS'),
    SMTP_FROM: readString(config, 'SMTP_FROM'),
    JOBS_ENABLED: readString(config, 'JOBS_ENABLED'),
    TASK_DIAS_CHECAGEM_MEDIDA: readString(config, 'TASK_DIAS_CHECAGEM_MEDIDA'),
    TASK_DIAS_REVISAO_PROJETO: readString(config, 'TASK_DIAS_REVISAO_PROJETO'),
    TASK_DIAS_PROJETO_EXECUTIVO: readString(config, 'TASK_DIAS_PROJETO_EXECUTIVO'),
    TASK_DIAS_APROVACAO_EXECUTIVO: readString(config, 'TASK_DIAS_APROVACAO_EXECUTIVO'),
    TASK_DIAS_ENVIO_CLIENTE: readString(config, 'TASK_DIAS_ENVIO_CLIENTE'),
  };
}
