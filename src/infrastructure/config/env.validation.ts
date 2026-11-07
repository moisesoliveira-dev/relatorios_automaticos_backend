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
  GOSAC_BASE_URL?: string;
  GOSAC_API_KEY?: string;
  GOSAC_WEBHOOK_SECRET?: string;
  MASTER_SETUP_TOKEN?: string;
  DB_SSL_REJECT_UNAUTHORIZED: boolean;
  DB_SYNCHRONIZE: boolean;
  DB_SSL?: boolean;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL: string;
  OPENAI_TEMPERATURE?: number;
  OPENAI_TIMEOUT_MS: number;
  CHATBOT_ENABLED: boolean;
  CHATBOT_AI_ENABLED: boolean;
  /** Modo teste: o chatbot só atende os números de CHATBOT_TEST_NUMBERS. */
  CHATBOT_TEST_MODE: boolean;
  CHATBOT_TEST_NUMBERS?: string;
  CHATBOT_DEBOUNCE_MS: number;
  CHATBOT_MAX_INVALID: number;
  CHATBOT_MAX_OFF_TOPIC: number;
  CHATBOT_HUMANIZE: boolean;
  CHATBOT_TYPING_DELAY: boolean;
  CHATBOT_WRITER_DAILY_LIMIT: number;
  CHATBOT_AI_DAILY_LIMIT: number;
  CHATBOT_HUMAN_IDLE_MINUTES: number;
  /** Funil comercial do CMSYS (API de integração): cria o lead no encaminhamento e alimenta as ferramentas do fluxo. */
  CHATBOT_CRM_ENABLED: boolean;
  CHATBOT_CRM_FLUXO: string;
  CRM_API_URL?: string;
  CRM_API_KEY?: string;
  CHATBOT_DRIVE_ROOT_FOLDER_ID?: string;
  CHATBOT_FALLBACK_GOSAC_USER_ID?: number;
  CHATBOT_FALLBACK_GOSAC_QUEUE_ID?: number;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  SMTP_FROM?: string;
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

  const placeholder = /^(sua[_-]|change[_-]?me|troque|example|secret$)/i;
  if (isProduction && jwtSecret && placeholder.test(jwtSecret)) {
    errors.push('JWT_SECRET ainda é um valor de exemplo — gere um segredo aleatório');
  }
  if (isProduction && encryptionKey && placeholder.test(encryptionKey)) {
    errors.push('ENCRYPTION_KEY ainda é um valor de exemplo — gere uma chave aleatória');
  }



  if (isProduction && !readString(config, 'DATABASE_URL') && !readString(config, 'DB_HOST')) {
    errors.push('DATABASE_URL ou DB_* são obrigatórios em produção');
  }

  const chatbotEnabled = readString(config, 'CHATBOT_ENABLED') === 'true';
  const aiEnabled = readString(config, 'CHATBOT_AI_ENABLED', 'true') !== 'false';
  if (chatbotEnabled) {
    if (aiEnabled && !readString(config, 'OPENAI_API_KEY')) {
      errors.push('OPENAI_API_KEY é obrigatório com CHATBOT_ENABLED=true (ou use CHATBOT_AI_ENABLED=false)');
    }
    if (!readString(config, 'GOSAC_BASE_URL') || !readString(config, 'GOSAC_API_KEY')) {
      errors.push('GOSAC_BASE_URL e GOSAC_API_KEY são obrigatórios com CHATBOT_ENABLED=true');
    }
    if (isProduction && !readString(config, 'GOSAC_WEBHOOK_SECRET')) {
      errors.push('GOSAC_WEBHOOK_SECRET é obrigatório em produção com CHATBOT_ENABLED=true');
    }
    if (readString(config, 'CHATBOT_CRM_ENABLED') === 'true' && (!readString(config, 'CRM_API_URL') || !readString(config, 'CRM_API_KEY'))) {
      errors.push('CRM_API_URL e CRM_API_KEY são obrigatórios com CHATBOT_CRM_ENABLED=true');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Configuração de ambiente inválida:\n- ${errors.join('\n- ')}`);
  }

  return {
    NODE_ENV: nodeEnv,
    PORT: readNumber(config, 'PORT', 3000),
    FRONTEND_URL: readString(config, 'FRONTEND_URL', 'http://localhost:4200')!,
    JWT_SECRET: jwtSecret!,
    JWT_EXPIRES_IN: readString(config, 'JWT_EXPIRES_IN', '12h')!,
    ENCRYPTION_KEY: encryptionKey!,
    DB_HOST: readString(config, 'DB_HOST', 'localhost')!,
    DB_PORT: readNumber(config, 'DB_PORT', 5432),
    DB_USERNAME: readString(config, 'DB_USERNAME', 'postgres')!,
    DB_PASSWORD: readString(config, 'DB_PASSWORD', 'postgres123')!,
    DB_DATABASE: readString(config, 'DB_DATABASE', 'relatorios_db')!,
    DATABASE_URL: readString(config, 'DATABASE_URL'),
    ROTATION_DATABASE_URL: readString(config, 'ROTATION_DATABASE_URL'),
    GOSAC_BASE_URL: readString(config, 'GOSAC_BASE_URL'),
    GOSAC_API_KEY: readString(config, 'GOSAC_API_KEY'),
    GOSAC_WEBHOOK_SECRET: readString(config, 'GOSAC_WEBHOOK_SECRET'),
    MASTER_SETUP_TOKEN: readString(config, 'MASTER_SETUP_TOKEN'),
    DB_SSL_REJECT_UNAUTHORIZED: readString(config, 'DB_SSL_REJECT_UNAUTHORIZED') === 'true',
    DB_SYNCHRONIZE: readString(config, 'DB_SYNCHRONIZE') === 'true',
    // SSL na conexão com o banco, independente do NODE_ENV. Vazio = segue o NODE_ENV (produção liga).
    DB_SSL: readString(config, 'DB_SSL') === undefined ? undefined : readString(config, 'DB_SSL') === 'true',
    OPENAI_API_KEY: readString(config, 'OPENAI_API_KEY'),
    OPENAI_MODEL: readString(config, 'OPENAI_MODEL', 'gpt-4o-mini')!,
    // Modelos de raciocínio (o-series/gpt-5) não aceitam temperature: deixe OPENAI_TEMPERATURE vazio para omitir.
    OPENAI_TEMPERATURE: config['OPENAI_TEMPERATURE'] === '' ? undefined : readNumber(config, 'OPENAI_TEMPERATURE', 0),
    OPENAI_TIMEOUT_MS: readNumber(config, 'OPENAI_TIMEOUT_MS', 12000),
    CHATBOT_ENABLED: chatbotEnabled,
    CHATBOT_AI_ENABLED: aiEnabled,
    CHATBOT_TEST_MODE: readString(config, 'CHATBOT_TEST_MODE') === 'true',
    CHATBOT_TEST_NUMBERS: readString(config, 'CHATBOT_TEST_NUMBERS'),
    CHATBOT_DEBOUNCE_MS: readNumber(config, 'CHATBOT_DEBOUNCE_MS', 3000),
    CHATBOT_MAX_INVALID: readNumber(config, 'CHATBOT_MAX_INVALID', 3),
    CHATBOT_MAX_OFF_TOPIC: readNumber(config, 'CHATBOT_MAX_OFF_TOPIC', 3),
    // Mensagens com voz natural (agente Redator). Desligue para usar sempre os textos padrão.
    CHATBOT_HUMANIZE: readString(config, 'CHATBOT_HUMANIZE') !== 'false',
    // Pequena pausa de "digitando" antes de cada bolha (parece conversa de pessoa).
    CHATBOT_TYPING_DELAY: readString(config, 'CHATBOT_TYPING_DELAY') !== 'false',
    CHATBOT_WRITER_DAILY_LIMIT: readNumber(config, 'CHATBOT_WRITER_DAILY_LIMIT', 60),
    CHATBOT_AI_DAILY_LIMIT: readNumber(config, 'CHATBOT_AI_DAILY_LIMIT', 40),
    CHATBOT_HUMAN_IDLE_MINUTES: readNumber(config, 'CHATBOT_HUMAN_IDLE_MINUTES', 60),
    CHATBOT_CRM_ENABLED: readString(config, 'CHATBOT_CRM_ENABLED') === 'true',
    CHATBOT_CRM_FLUXO: ['1', '2.1', '2.2'].includes(readString(config, 'CHATBOT_CRM_FLUXO') ?? '') ? readString(config, 'CHATBOT_CRM_FLUXO')! : '2.2',
    CRM_API_URL: readString(config, 'CRM_API_URL'),
    CRM_API_KEY: readString(config, 'CRM_API_KEY'),
    CHATBOT_DRIVE_ROOT_FOLDER_ID: readString(config, 'CHATBOT_DRIVE_ROOT_FOLDER_ID'),
    CHATBOT_FALLBACK_GOSAC_USER_ID: readString(config, 'CHATBOT_FALLBACK_GOSAC_USER_ID')
      ? readNumber(config, 'CHATBOT_FALLBACK_GOSAC_USER_ID', 0)
      : undefined,
    CHATBOT_FALLBACK_GOSAC_QUEUE_ID: readString(config, 'CHATBOT_FALLBACK_GOSAC_QUEUE_ID')
      ? readNumber(config, 'CHATBOT_FALLBACK_GOSAC_QUEUE_ID', 0)
      : undefined,
    SMTP_HOST: readString(config, 'SMTP_HOST'),
    SMTP_PORT: readString(config, 'SMTP_PORT'),
    SMTP_USER: readString(config, 'SMTP_USER'),
    SMTP_PASS: readString(config, 'SMTP_PASS'),
    SMTP_FROM: readString(config, 'SMTP_FROM'),
  };
}
