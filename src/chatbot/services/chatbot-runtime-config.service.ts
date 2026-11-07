import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
import { SettingsService } from '../../settings/settings.service';
import { canonicalNumber, parseNumberList } from '../domain/test-mode';

export type FieldType = 'boolean' | 'number' | 'text' | 'secret' | 'list';
export type FieldGroup =
  | 'geral'
  | 'ia'
  | 'comunicacao'
  | 'limites'
  | 'atendimento'
  | 'integracoes';

export interface ConfigField {
  key: string;
  label: string;
  group: FieldGroup;
  type: FieldType;
  description: string;
  min?: number;
  max?: number;
  placeholder?: string;
  /** Muda o comportamento com clientes reais: a tela pede confirmação ao alterar. */
  sensitive?: boolean;
}

/** Tudo o que a tela da IA pode alterar. Qualquer outra chave é recusada. */
export const CONFIG_FIELDS: ConfigField[] = [
  {
    key: 'CHATBOT_ENABLED',
    label: 'Chatbot ligado',
    group: 'geral',
    type: 'boolean',
    sensitive: true,
    description:
      'Liga o atendimento automático. Antes de ligar, desative o fluxo CMM no n8n (senão o cliente recebe duas respostas).',
  },
  {
    key: 'CHATBOT_TEST_MODE',
    label: 'Modo teste',
    group: 'geral',
    type: 'boolean',
    sensitive: true,
    description:
      'Ligado, o chatbot só atende os números da lista abaixo; qualquer outro número é ignorado (não recebe resposta do bot). Use para testar com segurança antes de abrir para todos.',
  },
  {
    key: 'CHATBOT_TEST_NUMBERS',
    label: 'Números do modo teste',
    group: 'geral',
    type: 'list',
    placeholder: '(92) 99123-4567',
    description:
      'Telefones com DDD que o chatbot atende no modo teste. Pode ser com ou sem 55 e com ou sem o 9.',
  },
  {
    key: 'CHATBOT_AI_ENABLED',
    label: 'Usar IA (OpenAI)',
    group: 'geral',
    type: 'boolean',
    sensitive: true,
    description:
      'Desligada, o bot funciona só com regras fixas (números, comandos, OK). Texto livre cai na mensagem de "opção inválida".',
  },
  {
    key: 'CHATBOT_HUMANIZE',
    label: 'Mensagens com voz natural',
    group: 'comunicacao',
    type: 'boolean',
    description:
      'O agente Redator reescreve cada mensagem com contexto. Desligada, vão sempre os textos padrão.',
  },
  {
    key: 'CHATBOT_TYPING_DELAY',
    label: 'Pausa de "digitando"',
    group: 'comunicacao',
    type: 'boolean',
    description:
      'Pequena espera proporcional ao tamanho antes de cada bolha, como uma pessoa digitando.',
  },
  {
    key: 'OPENAI_API_KEY',
    label: 'Chave da OpenAI',
    group: 'ia',
    type: 'secret',
    placeholder: 'sk-…',
    description:
      'Guardada criptografada. Nunca é exibida de novo. Em branco usa a variável OPENAI_API_KEY do servidor.',
  },
  {
    key: 'OPENAI_MODEL',
    label: 'Modelo padrão',
    group: 'ia',
    type: 'text',
    placeholder: 'gpt-4o-mini',
    description:
      'Usado por todos os agentes, salvo os modelos específicos abaixo.',
  },
  {
    key: 'OPENAI_MODEL_SCOPE',
    label: 'Modelo — Agente de Escopo',
    group: 'ia',
    type: 'text',
    placeholder: 'igual ao padrão',
    description: 'Decide se a mensagem é sobre móveis planejados.',
  },
  {
    key: 'OPENAI_MODEL_INTERPRETER',
    label: 'Modelo — Intérprete',
    group: 'ia',
    type: 'text',
    placeholder: 'igual ao padrão',
    description: 'Traduz texto livre em uma opção do fluxo.',
  },
  {
    key: 'OPENAI_MODEL_FAQ',
    label: 'Modelo — FAQ',
    group: 'ia',
    type: 'text',
    placeholder: 'igual ao padrão',
    description: 'Responde dúvidas usando só a base de conhecimento.',
  },
  {
    key: 'OPENAI_MODEL_VERIFIER',
    label: 'Modelo — Verificador',
    group: 'ia',
    type: 'text',
    placeholder: 'igual ao padrão',
    description:
      'Revisa a resposta do FAQ. Um modelo mais forte aqui reduz erros.',
  },
  {
    key: 'OPENAI_MODEL_WRITER',
    label: 'Modelo — Redator',
    group: 'ia',
    type: 'text',
    placeholder: 'igual ao padrão',
    description: 'Escreve a mensagem final ao cliente.',
  },
  {
    key: 'CHATBOT_DEBOUNCE_MS',
    label: 'Espera para juntar mensagens (ms)',
    group: 'limites',
    type: 'number',
    min: 500,
    max: 15000,
    description:
      'Tempo de silêncio do cliente antes de responder. Junta mensagens picadas numa resposta só.',
  },
  {
    key: 'CHATBOT_MAX_INVALID',
    label: 'Respostas inválidas até chamar um humano',
    group: 'limites',
    type: 'number',
    min: 1,
    max: 10,
    description:
      'Depois dessas tentativas sem sentido, o cliente é encaminhado a um atendente.',
  },
  {
    key: 'CHATBOT_MAX_OFF_TOPIC',
    label: 'Advertências de fora de escopo',
    group: 'limites',
    type: 'number',
    min: 1,
    max: 10,
    description:
      'Ao atingir, o bot para de responder texto livre (manipulação conta em dobro).',
  },
  {
    key: 'CHATBOT_AI_DAILY_LIMIT',
    label: 'Mensagens com IA por cliente/dia',
    group: 'limites',
    type: 'number',
    min: 1,
    max: 500,
    description: 'Teto de custo e abuso por cliente.',
  },
  {
    key: 'CHATBOT_WRITER_DAILY_LIMIT',
    label: 'Mensagens do Redator por cliente/dia',
    group: 'limites',
    type: 'number',
    min: 1,
    max: 500,
    description: 'Acima disso, vão os textos padrão.',
  },
  {
    key: 'CHATBOT_HUMAN_IDLE_MINUTES',
    label: 'Reiniciar depois de (min) sem atendente',
    group: 'atendimento',
    type: 'number',
    min: 5,
    max: 1440,
    description:
      'Se o atendimento humano ficar parado por esse tempo, o bot retoma a conversa.',
  },
  {
    key: 'CHATBOT_FALLBACK_GOSAC_USER_ID',
    label: 'Atendente de contingência (ID GOSAC)',
    group: 'atendimento',
    type: 'number',
    min: 1,
    description: 'Recebe o ticket quando o rodízio não está disponível.',
  },
  {
    key: 'CHATBOT_FALLBACK_GOSAC_QUEUE_ID',
    label: 'Fila de contingência (ID GOSAC)',
    group: 'atendimento',
    type: 'number',
    min: 1,
    description: 'Fila usada junto com o atendente de contingência.',
  },
  {
    key: 'CHATBOT_DRIVE_ROOT_FOLDER_ID',
    label: 'Pasta raiz no Google Drive',
    group: 'integracoes',
    type: 'text',
    placeholder: 'ID da pasta "01 - VENDAS E PROJETOS"',
    description: 'Onde nascem as pastas dos clientes (ano / mês / ANDAMENTO).',
  },
  {
    key: 'CHATBOT_CRM_ENABLED',
    label: 'Funil comercial (CMSYS)',
    group: 'integracoes',
    type: 'boolean',
    sensitive: true,
    description:
      'Ao encaminhar o cliente, registra o lead no funil do CMSYS (sem duplicar), define o consultor pelo rodízio e anota o resumo da triagem. Também libera as etapas “Funil” nos fluxos.',
  },
  {
    key: 'CRM_API_URL',
    label: 'Endereço da API do funil (CMSYS)',
    group: 'integracoes',
    type: 'text',
    placeholder: 'https://orcamentos.servidorcm.cloud',
    description:
      'Homologação e produção têm endereços e chaves diferentes. Sem barra no final.',
  },
  {
    key: 'CRM_API_KEY',
    label: 'Chave da API do funil (CMSYS)',
    group: 'integracoes',
    type: 'secret',
    placeholder: 'chave de 48 caracteres',
    description:
      'Guardada criptografada. Nunca é exibida de novo. Peça uma chave própria ao administrador do CMSYS.',
  },
  {
    key: 'CHATBOT_CRM_FLUXO',
    label: 'Fluxo padrão do lead no funil',
    group: 'integracoes',
    type: 'text',
    placeholder: '2.2',
    description:
      'Usado quando o cliente não escolheu “já tenho o projeto” (esse vai sempre para o fluxo 1). 2.1 = imóvel na planta; 2.2 = já com as chaves. O consultor confirma na Qualificação.',
  },
];

const BY_KEY = new Map(CONFIG_FIELDS.map((f) => [f.key, f]));
const CATEGORY = 'chatbot';

export interface ConfigView extends ConfigField {
  /** Valor efetivo agora (segredos nunca vêm: só `configured`). */
  value: string | number | boolean | null;
  configured?: boolean;
  source: 'tela' | 'ambiente' | 'padrão';
}

@Injectable()
export class ChatbotRuntimeConfigService implements OnModuleInit {
  private readonly logger = new Logger(ChatbotRuntimeConfigService.name);

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly settings: SettingsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
  }

  /** Outras instâncias do backend enxergam a mudança em até 30 s. */
  @Interval(30_000)
  async reload(): Promise<void> {
    try {
      const all = await this.settings.getAllDecrypted();
      const map: Record<string, string> = {};
      for (const s of all)
        if (s.category === CATEGORY && BY_KEY.has(s.key)) map[s.key] = s.value;
      this.appConfig.setRuntimeOverrides(map);
    } catch (error) {
      this.logger.warn(
        `Não foi possível carregar os ajustes da IA: ${(error as Error).message}`,
      );
    }
  }

  private effective(key: string): string | number | boolean | null {
    const c = this.appConfig.chatbot;
    const o = this.appConfig.openai;
    switch (key) {
      case 'CHATBOT_ENABLED':
        return c.enabled;
      case 'CHATBOT_AI_ENABLED':
        return c.aiEnabled;
      case 'CHATBOT_TEST_MODE':
        return c.testMode;
      case 'CHATBOT_TEST_NUMBERS':
        return c.testNumbers || null;
      case 'CHATBOT_HUMANIZE':
        return c.humanize;
      case 'CHATBOT_TYPING_DELAY':
        return c.typingDelay;
      case 'CHATBOT_DEBOUNCE_MS':
        return c.debounceMs;
      case 'CHATBOT_MAX_INVALID':
        return c.maxInvalid;
      case 'CHATBOT_MAX_OFF_TOPIC':
        return c.maxOffTopic;
      case 'CHATBOT_AI_DAILY_LIMIT':
        return c.aiDailyLimit;
      case 'CHATBOT_WRITER_DAILY_LIMIT':
        return c.writerDailyLimit;
      case 'CHATBOT_HUMAN_IDLE_MINUTES':
        return c.humanIdleMinutes;
      case 'CHATBOT_FALLBACK_GOSAC_USER_ID':
        return c.fallbackGosacUserId ?? null;
      case 'CHATBOT_FALLBACK_GOSAC_QUEUE_ID':
        return c.fallbackGosacQueueId ?? null;
      case 'CHATBOT_DRIVE_ROOT_FOLDER_ID':
        return c.driveRootFolderId ?? null;
      case 'CHATBOT_CRM_ENABLED':
        return this.appConfig.crm.enabled;
      case 'CRM_API_URL':
        return this.appConfig.crm.baseUrl || null;
      case 'CHATBOT_CRM_FLUXO':
        return this.appConfig.crm.fluxo;
      case 'CRM_API_KEY':
        return null;
      case 'OPENAI_MODEL':
        return o.model;
      case 'OPENAI_API_KEY':
        return null;
      default:
        if (key.startsWith('OPENAI_MODEL_')) {
          return (
            this.appConfig.runtimeOverrides()[key] ??
            process.env[key]?.trim() ??
            null
          );
        }
        return null;
    }
  }

  describe(): ConfigView[] {
    const overrides = this.appConfig.runtimeOverrides();
    return CONFIG_FIELDS.map((f) => {
      const fromScreen =
        overrides[f.key] !== undefined && overrides[f.key] !== '';
      const fromEnv =
        process.env[f.key] !== undefined && process.env[f.key] !== '';
      const view: ConfigView = {
        ...f,
        value: this.effective(f.key),
        source: fromScreen ? 'tela' : fromEnv ? 'ambiente' : 'padrão',
      };
      if (f.type === 'secret') {
        view.value = null;
        view.configured =
          f.key === 'CRM_API_KEY'
            ? !!this.appConfig.crm.apiKey
            : !!this.appConfig.openai.apiKey;
      }
      return view;
    });
  }

  /** Valida e converte para o texto guardado. Lança 400 com a mensagem para o usuário. */
  private normalize(field: ConfigField, raw: unknown): string {
    switch (field.type) {
      case 'boolean':
        if (typeof raw !== 'boolean')
          throw new BadRequestException(
            `"${field.label}" deve ser ligado ou desligado.`,
          );
        return String(raw);
      case 'number': {
        const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
        if (!Number.isInteger(n))
          throw new BadRequestException(
            `"${field.label}" deve ser um número inteiro.`,
          );
        if (field.min !== undefined && n < field.min)
          throw new BadRequestException(
            `"${field.label}" deve ser pelo menos ${field.min}.`,
          );
        if (field.max !== undefined && n > field.max)
          throw new BadRequestException(
            `"${field.label}" deve ser no máximo ${field.max}.`,
          );
        return String(n);
      }
      case 'list': {
        const lista = Array.isArray(raw) ? raw : String(raw ?? '').split(/[\n,;]+/);
        const itens = lista.map((x) => String(x).trim()).filter(Boolean);
        const numeros: string[] = [];
        for (const item of itens) {
          const n = canonicalNumber(item);
          if (!n)
            throw new BadRequestException(
              `"${item}" não parece um telefone com DDD (ex.: 92 99123-4567).`,
            );
          if (!numeros.includes(n)) numeros.push(n);
        }
        if (numeros.length > 50)
          throw new BadRequestException('No máximo 50 números no modo teste.');
        return numeros.join(',');
      }
      case 'secret': {
        const v = String(raw ?? '').trim();
        if (field.key === 'CRM_API_KEY') {
          if (!/^[A-Za-z0-9_\-]{20,200}$/.test(v))
            throw new BadRequestException(
              'A chave da API do funil parece inválida (só letras e números, de 20 a 200 caracteres).',
            );
          return v;
        }
        if (!/^sk-[A-Za-z0-9_\-]{20,200}$/.test(v))
          throw new BadRequestException(
            'A chave da OpenAI parece inválida (deve começar com "sk-").',
          );
        return v;
      }
      default: {
        const v = String(raw ?? '').trim();
        if (v.length > 120)
          throw new BadRequestException(`"${field.label}" é longo demais.`);
        if (
          field.key.startsWith('OPENAI_MODEL') &&
          !/^[A-Za-z0-9._:\-]{2,80}$/.test(v)
        ) {
          throw new BadRequestException(
            `"${field.label}" tem caracteres inválidos.`,
          );
        }
        if (field.key === 'CRM_API_URL') {
          let url: URL | null = null;
          try {
            url = new URL(v);
          } catch {
            url = null;
          }
          const local = url?.hostname === 'localhost' || url?.hostname === '127.0.0.1';
          if (
            !url ||
            url.username ||
            url.password ||
            (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
          )
            throw new BadRequestException(
              'O endereço da API do funil deve começar com https:// e não pode ter usuário ou senha.',
            );
          return v.replace(/\/+$/, '');
        }
        if (field.key === 'CHATBOT_CRM_FLUXO' && !['1', '2.1', '2.2'].includes(v))
          throw new BadRequestException(
            'O fluxo padrão do funil deve ser 1, 2.1 ou 2.2.',
          );
        if (
          field.key === 'CHATBOT_DRIVE_ROOT_FOLDER_ID' &&
          !/^[A-Za-z0-9_\-]{10,80}$/.test(v)
        ) {
          throw new BadRequestException(
            'O ID da pasta do Drive parece inválido.',
          );
        }
        return v;
      }
    }
  }

  /** Pré-requisitos para ligar o chatbot de verdade (evita ligar e quebrar). */
  private assertCanEnable(next: Record<string, string>): void {
    const get = (k: string, fallback: unknown) =>
      next[k] !== undefined ? next[k] : String(fallback ?? '');
    const testeLigado =
      get('CHATBOT_TEST_MODE', this.appConfig.chatbot.testMode) === 'true';
    if (
      testeLigado &&
      !parseNumberList(
        get('CHATBOT_TEST_NUMBERS', this.appConfig.chatbot.testNumbers),
      ).length
    )
      throw new BadRequestException(
        'Para ligar o modo teste, adicione ao menos um número (senão o chatbot não atenderia ninguém).',
      );
    const crmLigado =
      get('CHATBOT_CRM_ENABLED', this.appConfig.crm.enabled) === 'true';
    if (
      crmLigado &&
      (!get('CRM_API_URL', this.appConfig.crm.baseUrl) ||
        !(next['CRM_API_KEY'] || this.appConfig.crm.apiKey))
    )
      throw new BadRequestException(
        'Para ligar o funil comercial, informe o endereço e a chave da API do CMSYS.',
      );
    const enabled =
      get('CHATBOT_ENABLED', this.appConfig.chatbot.enabled) === 'true';
    if (!enabled) return;
    const gosac = this.appConfig.gosacApi;
    if (!gosac.baseUrl || !gosac.apiKey)
      throw new BadRequestException(
        'Para ligar o chatbot, configure GOSAC_BASE_URL e GOSAC_API_KEY no servidor.',
      );
    const aiOn =
      get('CHATBOT_AI_ENABLED', this.appConfig.chatbot.aiEnabled) === 'true';
    const hasKey = !!(next['OPENAI_API_KEY'] || this.appConfig.openai.apiKey);
    if (aiOn && !hasKey)
      throw new BadRequestException(
        'Para usar a IA, informe a chave da OpenAI (ou desligue "Usar IA").',
      );
    if (this.appConfig.isProduction && !this.appConfig.gosacWebhookSecret) {
      throw new BadRequestException(
        'Em produção é preciso definir GOSAC_WEBHOOK_SECRET no servidor antes de ligar o chatbot.',
      );
    }
  }

  /**
   * Aplica alterações. `null` remove o ajuste da tela (volta para o ambiente/padrão).
   * Tudo é validado antes de gravar qualquer coisa.
   */
  async save(values: Record<string, unknown>): Promise<ConfigView[]> {
    if (!values || typeof values !== 'object' || Array.isArray(values))
      throw new BadRequestException('Corpo inválido.');
    const toSet: Record<string, string> = {};
    const toClear: string[] = [];

    for (const [key, raw] of Object.entries(values)) {
      const field = BY_KEY.get(key);
      if (!field) throw new BadRequestException(`Ajuste desconhecido: ${key}`);
      if (raw === null || raw === '') toClear.push(key);
      else toSet[key] = this.normalize(field, raw);
    }
    this.assertCanEnable(toSet);

    for (const [key, value] of Object.entries(toSet)) {
      await this.settings.upsert(key, value, CATEGORY, BY_KEY.get(key)!.label);
    }
    for (const key of toClear)
      await this.settings.delete(key).catch(() => undefined);

    await this.reload();
    this.logger.log(
      `Ajustes da IA alterados: ${[...Object.keys(toSet), ...toClear].join(', ')}`,
    );
    return this.describe();
  }
}
