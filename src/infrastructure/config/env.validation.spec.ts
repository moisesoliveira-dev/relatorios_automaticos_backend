import { validateEnv } from './env.validation';

const base = {
  JWT_SECRET: 'a'.repeat(40),
  ENCRYPTION_KEY: 'b'.repeat(40),
};

describe('validateEnv', () => {
  it('em produção recusa segredos de exemplo ou curtos', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        DB_HOST: 'h',
        JWT_SECRET: 'sua_chave_secreta_super_longa_aqui_1234567',
      }),
    ).toThrow(/JWT_SECRET/);
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        DB_HOST: 'h',
        ENCRYPTION_KEY: 'curta',
      }),
    ).toThrow(/ENCRYPTION_KEY/);
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'production', DB_HOST: 'h' }),
    ).not.toThrow();
  });

  it('fora de produção não bloqueia (desenvolvimento local)', () => {
    expect(() =>
      validateEnv({ ...base, JWT_SECRET: 'sua_x', ENCRYPTION_KEY: 'sua_y' }),
    ).not.toThrow();
  });

  it('DB_SSL é independente do NODE_ENV', () => {
    expect(validateEnv({ ...base }).DB_SSL).toBeUndefined();
    expect(validateEnv({ ...base, DB_SSL: 'true' }).DB_SSL).toBe(true);
    expect(validateEnv({ ...base, DB_SSL: 'false' }).DB_SSL).toBe(false);
  });

  it('chatbot ligado exige OpenAI, GOSAC e segredo do webhook em produção; funil comercial só se ligado', () => {
    const on = {
      ...base,
      CHATBOT_ENABLED: 'true',
      GOSAC_BASE_URL: 'https://g',
      GOSAC_API_KEY: 'k',
    };
    expect(() => validateEnv(on)).toThrow(/OPENAI_API_KEY/);
    expect(() => validateEnv({ ...on, OPENAI_API_KEY: 'sk' })).not.toThrow();
    expect(() =>
      validateEnv({
        ...on,
        OPENAI_API_KEY: 'sk',
        NODE_ENV: 'production',
        DB_HOST: 'h',
      }),
    ).toThrow(/GOSAC_WEBHOOK_SECRET/);
    expect(() =>
      validateEnv({ ...on, OPENAI_API_KEY: 'sk', CHATBOT_CRM_ENABLED: 'true' }),
    ).toThrow(/CRM_API_URL e CRM_API_KEY/);
    expect(() =>
      validateEnv({
        ...on,
        OPENAI_API_KEY: 'sk',
        CHATBOT_CRM_ENABLED: 'true',
        CRM_API_URL: 'https://c',
        CRM_API_KEY: 'k',
      }),
    ).not.toThrow();
  });

  it('valores padrão seguros', () => {
    const e = validateEnv({ ...base });
    expect(e).toMatchObject({
      CHATBOT_ENABLED: false,
      CHATBOT_CRM_ENABLED: false,
      CHATBOT_CRM_FLUXO: '2.2',
      JWT_EXPIRES_IN: '12h',
      DB_SYNCHRONIZE: false,
    });
  });
});
