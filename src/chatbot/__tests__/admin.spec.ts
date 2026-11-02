import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
import { validateEnv } from '../../infrastructure/config/env.validation';
import { ChatbotAdminService } from '../services/chatbot-admin.service';
import { ChatbotRuntimeConfigService } from '../services/chatbot-runtime-config.service';
import { MESSAGES } from '../domain/chatbot.messages';

const baseEnv = {
  JWT_SECRET: 'a'.repeat(40),
  ENCRYPTION_KEY: 'b'.repeat(40),
  PONTTA_EMAIL: 'x@x.com',
  PONTTA_PASSWORD: 'x',
  PONTTA_API_KEY: 'k',
  GOSAC_BASE_URL: 'https://gosac.exemplo.com',
  GOSAC_API_KEY: 'g',
};

function build(env: Record<string, unknown> = {}) {
  const appConfig = new AppConfigService({
    get: () => validateEnv({ ...baseEnv, ...env }),
  } as any);
  const rows = new Map<string, { value: string; category: string }>();
  const settings = {
    getAllDecrypted: jest.fn(async () =>
      [...rows].map(([key, r]) => ({
        key,
        value: r.value,
        category: r.category,
        isEncrypted: false,
        description: '',
      })),
    ),
    upsert: jest.fn(
      async (key: string, value: string, category: string) =>
        void rows.set(key, { value, category }),
    ),
    delete: jest.fn(async (key: string) => void rows.delete(key)),
  };
  const config = new ChatbotRuntimeConfigService(appConfig, settings as any);
  return { appConfig, settings, config, rows };
}

describe('ChatbotRuntimeConfigService — ajustes pela tela', () => {
  it('mostra o valor efetivo e de onde ele vem (padrão / ambiente / tela)', () => {
    const t = build({ CHATBOT_DEBOUNCE_MS: '5000' });
    const by = (k: string) => t.config.describe().find((f) => f.key === k)!;
    expect(by('CHATBOT_DEBOUNCE_MS')).toMatchObject({ value: 5000 });
    expect(by('CHATBOT_MAX_INVALID')).toMatchObject({
      value: 3,
      source: 'padrão',
    });
  });

  it('o que é salvo vale na hora e passa a vir da "tela"', async () => {
    const t = build();
    await t.config.save({
      CHATBOT_MAX_INVALID: 5,
      CHATBOT_HUMANIZE: false,
      OPENAI_MODEL: 'gpt-4o',
    });
    expect(t.appConfig.chatbot.maxInvalid).toBe(5);
    expect(t.appConfig.chatbot.humanize).toBe(false);
    expect(t.appConfig.openai.model).toBe('gpt-4o');
    expect(
      t.config.describe().find((f) => f.key === 'CHATBOT_MAX_INVALID'),
    ).toMatchObject({ value: 5, source: 'tela' });
    expect(t.settings.upsert).toHaveBeenCalledWith(
      'CHATBOT_MAX_INVALID',
      '5',
      'chatbot',
      expect.any(String),
    );
  });

  it('null remove o ajuste e volta ao ambiente/padrão', async () => {
    const t = build();
    await t.config.save({ CHATBOT_MAX_INVALID: 7 });
    await t.config.save({ CHATBOT_MAX_INVALID: null });
    expect(t.appConfig.chatbot.maxInvalid).toBe(3);
    expect(t.settings.delete).toHaveBeenCalledWith('CHATBOT_MAX_INVALID');
  });

  it('recusa chaves desconhecidas, tipos errados e valores fora da faixa (sem gravar nada)', async () => {
    const t = build();
    await expect(t.config.save({ JWT_SECRET: 'x' })).rejects.toThrow(
      /desconhecido/,
    );
    await expect(t.config.save({ CHATBOT_MAX_INVALID: 99 })).rejects.toThrow(
      /no máximo/,
    );
    await expect(t.config.save({ CHATBOT_MAX_INVALID: 'abc' })).rejects.toThrow(
      /inteiro/,
    );
    await expect(t.config.save({ CHATBOT_HUMANIZE: 'sim' })).rejects.toThrow(
      /ligado ou desligado/,
    );
    await expect(
      t.config.save({ OPENAI_MODEL: 'modelo; DROP TABLE' }),
    ).rejects.toThrow(/inválidos/);
    await expect(
      t.config.save({ CHATBOT_DRIVE_ROOT_FOLDER_ID: '../../etc' }),
    ).rejects.toThrow(/inválido/);
    // uma alteração válida junto de uma inválida não grava nenhuma
    await expect(
      t.config.save({ CHATBOT_MAX_INVALID: 4, CHATBOT_MAX_OFF_TOPIC: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(t.settings.upsert).not.toHaveBeenCalled();
  });

  it('chave da OpenAI: formato validado, nunca devolvida, só "configurada"', async () => {
    const t = build();
    await expect(
      t.config.save({ OPENAI_API_KEY: 'chave-invalida' }),
    ).rejects.toThrow(/inválida/);
    await t.config.save({ OPENAI_API_KEY: 'sk-' + 'a'.repeat(40) });
    const f = t.config.describe().find((x) => x.key === 'OPENAI_API_KEY')!;
    expect(f.value).toBeNull();
    expect(f.configured).toBe(true);
    expect(JSON.stringify(t.config.describe())).not.toContain('sk-aaaa');
    expect(t.appConfig.openai.apiKey).toBe('sk-' + 'a'.repeat(40));
  });

  it('modelo por agente: tela > variável de ambiente > padrão', async () => {
    const t = build();
    expect(t.appConfig.modelFor('writer')).toBe('gpt-4o-mini');
    process.env.OPENAI_MODEL_WRITER = 'env-model';
    expect(t.appConfig.modelFor('writer')).toBe('env-model');
    await t.config.save({ OPENAI_MODEL_WRITER: 'tela-model' });
    expect(t.appConfig.modelFor('writer')).toBe('tela-model');
    delete process.env.OPENAI_MODEL_WRITER;
  });

  it('não deixa ligar o chatbot sem os pré-requisitos', async () => {
    await expect(
      build({
        GOSAC_BASE_URL: undefined,
        GOSAC_API_KEY: undefined,
      }).config.save({ CHATBOT_ENABLED: true }),
    ).rejects.toThrow(/GOSAC/);
    await expect(
      build().config.save({ CHATBOT_ENABLED: true }),
    ).rejects.toThrow(/chave da OpenAI/);
    const ok = build();
    await ok.config.save({
      OPENAI_API_KEY: 'sk-' + 'b'.repeat(40),
      CHATBOT_ENABLED: true,
    });
    expect(ok.appConfig.chatbot.enabled).toBe(true);
    await expect(
      build({ NODE_ENV: 'production', DB_HOST: 'h' }).config.save({
        CHATBOT_AI_ENABLED: false,
        CHATBOT_ENABLED: true,
      }),
    ).rejects.toThrow(/GOSAC_WEBHOOK_SECRET/);
  });

  it('reload lê só ajustes da categoria do chatbot e ignora chaves fora da lista', async () => {
    const t = build();
    t.rows.set('CHATBOT_MAX_INVALID', { value: '6', category: 'chatbot' });
    t.rows.set('JWT_SECRET', { value: 'x', category: 'chatbot' });
    t.rows.set('CHATBOT_MAX_OFF_TOPIC', { value: '9', category: 'general' });
    await t.config.reload();
    expect(t.appConfig.chatbot.maxInvalid).toBe(6);
    expect(t.appConfig.chatbot.maxOffTopic).toBe(3);
    expect(t.appConfig.runtimeOverrides()).not.toHaveProperty('JWT_SECRET');
  });
});

describe('ChatbotAdminService', () => {
  const conv = (over: Record<string, unknown> = {}) => ({
    id: '11111111-1111-1111-1111-111111111111',
    contactId: 5,
    ticketId: 50,
    nome: 'Ana',
    contactName: 'Ana W',
    numero: '5592999990000',
    step: 'CATEGORIAS',
    trilha: 'planta',
    local: null,
    categorias: [1, 3],
    arquivos: 2,
    invalidCount: 1,
    offTopicCount: 2,
    aiCallsDay: 4,
    emAtendimento: false,
    finalizouTriagem: false,
    atendenteId: null,
    handoffError: 'x',
    driveFolderId: 'p',
    agendamentoStart: null,
    history: [{ role: 'cliente', text: 'oi' }],
    lastMessageAt: new Date(),
    createdAt: new Date(),
    slots: null,
    ...over,
  });
  const make = (row: any = conv(), agentsImpl?: (ctx: any) => any) => {
    const store = { row };
    const repo = {
      findOne: jest.fn(async () => store.row),
      save: jest.fn(async (c: any) => c),
    } as any;
    const appConfig = new AppConfigService({
      get: () => validateEnv(baseEnv),
    } as any);
    const agents = {
      available: !!agentsImpl,
      resolve: jest.fn(async (c: any) => agentsImpl!(c)),
    } as any;
    return {
      svc: new ChatbotAdminService(
        repo,
        appConfig,
        agents,
        {} as any,
        { enabled: false, compose: jest.fn() } as any,
      ),
      repo,
      agents,
      store,
    };
  };

  it('detalhe: mostra categorias por nome, histórico e mascara o telefone', async () => {
    const d = await make().svc.detail('11111111-1111-1111-1111-111111111111');
    expect(d.categorias).toEqual(['Cozinha', 'Dormitório']);
    expect(d.historico).toHaveLength(1);
    expect(d.numero).toBe('5592•••••000');
    expect(d.numero).not.toContain('99999');
  });

  it('conversa inexistente → 404', async () => {
    const t = make(null);
    await expect(t.svc.detail('x')).rejects.toBeInstanceOf(NotFoundException);
    await expect(t.svc.silenciar('x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('silenciar põe em atendimento humano; devolver ao bot recomeça do menu e limpa o erro', async () => {
    const t = make();
    expect(await t.svc.silenciar('id')).toMatchObject({
      etapa: 'HUMANO',
      emAtendimento: true,
    });
    await t.svc.devolverAoBot('id');
    expect(t.store.row).toMatchObject({
      step: 'MENU',
      trilha: null,
      emAtendimento: false,
      finalizouTriagem: false,
      handoffError: null,
      driveFolderId: null,
    });
  });

  it('simulador: cliente que chega vê o menu; número resolve por regras, sem IA e sem efeitos reais', async () => {
    const t = make(conv(), () => ({ kind: 'invalid' }));
    const inicio = await t.svc.converse({});
    expect(inicio.mensagens).toEqual([MESSAGES.menu_inicial]);
    expect(inicio.estado.step).toBe('MENU');
    const r = await t.svc.converse({
      texto: '1',
      estado: inicio.estado as never,
    });
    expect(r).toMatchObject({ origem: 'regras', terminou: false });
    expect(r.estado).toMatchObject({ step: 'NOME', trilha: 'projeto' });
    expect(r.mensagens).toEqual([MESSAGES.pedir_nome]);
    expect(t.agents.resolve).not.toHaveBeenCalled();
  });

  it('simulador: a conversa continua passo a passo e o encaminhamento a encerra', async () => {
    const t = make();
    let r: any = await t.svc.converse({
      inicio: { step: 'ENVIO_ARQUIVOS', trilha: 'projeto', nome: 'Ana' },
    });
    expect(r.estado).toMatchObject({ step: 'ENVIO_ARQUIVOS', arquivos: 1 });
    r = await t.svc.converse({ texto: 'ok', estado: r.estado });
    expect(r.terminou).toBe(true);
    expect(r.efeitos).toEqual(['Encaminharia a um atendente (rodízio)']);
    await expect(
      t.svc.converse({ texto: 'oi', estado: r.estado }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('simulador: texto livre usa a IA; fora de escopo recusa e reapresenta o passo', async () => {
    const t = make(conv(), () => ({ kind: 'fora_escopo', severidade: 'leve' }));
    const r = await t.svc.converse({
      texto: 'me conta uma piada',
      inicio: undefined,
      estado: { step: 'CASA_AP', trilha: 'semNada' },
    });
    expect(r.origem).toBe('ia');
    expect(r.mensagens).toEqual([MESSAGES.fora_escopo, MESSAGES.casa_ou_ap]);
  });

  it('simulador: sem IA cai nas regras e avisa; texto vazio e estado adulterado são recusados', async () => {
    const t = make();
    const r = await t.svc.converse({
      texto: 'quero cozinha',
      estado: { step: 'MENU' },
    });
    expect(r).toMatchObject({ origem: 'nenhuma' });
    expect(r.mensagens).toEqual([MESSAGES.invalida_generica]);
    expect(r.aviso).toMatch(/IA não está disponível/);
    await expect(
      t.svc.converse({ texto: '   ', estado: { step: 'MENU' } }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      t.svc.converse({ texto: '1', estado: { step: 'XYZ' } }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      t.svc.converse({
        texto: '1',
        estado: { step: 'CUSTOM', custom: { flowId: 'nao_existe' } },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('catálogo: mensagens com objetivo e pontos, base de conhecimento e categorias', () => {
    const c = make().svc.catalog();
    expect(c.mensagens.find((m) => m.chave === 'menu_inicial')).toMatchObject({
      objetivo: expect.any(String),
    });
    expect(c.baseConhecimento.length).toBeGreaterThan(3);
    expect(c.etapas.map((e) => e.etapa)).toContain('HUMANO');
    expect(c.categorias[1]).toBe('Cozinha');
  });
});
