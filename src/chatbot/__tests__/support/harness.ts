/**
 * Mundo simulado das jornadas: o ChatbotService real com os fluxos reais publicados (seed), o motor,
 * o orquestrador de agentes, o encaminhamento e as ferramentas. Só o mundo externo é simulado:
 * GOSAC, Drive, funil do CMSYS e rodízio. A OpenAI é um "modelo de mentira" por palavras-chave,
 * ou a OpenAI de verdade quando `build({ live: { apiKey } })`.
 */
import { ChatbotService, Inbound } from '../../services/chatbot.service';
import { ChatbotHandoffService } from '../../services/chatbot-handoff.service';
import { AgentOrchestrator } from '../../agents/agent-orchestrator.service';
import { ScopeAgent } from '../../agents/scope.agent';
import { InterpreterAgent } from '../../agents/interpreter.agent';
import { FaqAgent } from '../../agents/faq.agent';
import { VerifierAgent } from '../../agents/verifier.agent';
import { ToolRegistry } from '../../tools/tool.registry';
import { CrmError } from '../../services/crm-funil.service';
import { runtimeContent } from '../../domain/content-runtime';
import { DEFAULT_SYSTEM, seedFlows } from '../../engine/flow.seed';
import { OpenAiService } from '../../services/openai.service';
import { ChatbotHumanizerService } from '../../services/chatbot-humanizer.service';
import { WriterAgent } from '../../agents/writer.agent';
import { AttendantAgent } from '../../agents/attendant.agent';
import { FakeInbox, FakeLock } from './fakes';

// ───────────────────────── mundo simulado ─────────────────────────

export const MEDIA = 'https://gosac.exemplo.com/media/planta.png';

/** "Modelo de mentira": decide por palavras-chave, no formato que cada agente espera. */
function pretendModel(call: { agent: string; user: string }): unknown {
  const msg = (
    /<mensagem_cliente>\n([\s\S]*?)\n<\/mensagem_cliente>/.exec(
      call.user,
    )?.[1] ?? ''
  ).toLowerCase();
  switch (call.agent) {
    case 'scope':
      if (/idiota|burro|porra/.test(msg))
        return { categoria: 'ofensivo', confianca: 'alta' };
      if (/futebol|politica|presidente|bitcoin/.test(msg))
        return { categoria: 'fora', confianca: 'alta' };
      return { categoria: 'dentro', confianca: 'alta' };
    case 'interpreter': {
      const labels = (/Opções: (.*)/.exec(call.user)?.[1] ?? '')
        .split('; ')
        .map((s) => s.replace(/^\d+=/, '').toLowerCase())
        .filter(Boolean);
      const nodeHint = call.user.split('\n')[0].toLowerCase();
      if (/n[aã]o entendi|como assim/.test(msg))
        return { acao: 'esclarecer', opcao: null, valor: null, itens: null };
      if (/obrigad|bom dia|tudo bem|minuto|n[aã]o sei|depois/.test(msg))
        return { acao: 'conversa', opcao: null, valor: null, itens: null };
      if (/atendente|humano|pessoa/.test(msg))
        return { acao: 'pedir_humano', opcao: null, valor: null, itens: null };
      if (/\?|onde fica|quanto|horario de funcionamento/.test(msg))
        return { acao: 'duvida', opcao: null, valor: null, itens: null };
      if (/um ou mais itens/.test(nodeHint)) {
        const itens = labels
          .map((l, i) =>
            msg.includes(l.split(' ')[0].replace(/[^a-zà-ú]/g, '')) ? i + 1 : 0,
          )
          .filter(Boolean);
        return itens.length
          ? { acao: 'itens', opcao: null, valor: null, itens }
          : { acao: 'ininteligivel', opcao: null, valor: null, itens: null };
      }
      if (/o nome do cliente/.test(nodeHint))
        return {
          acao: 'valor',
          opcao: null,
          valor: msg.replace(/^(meu nome é|me chamo|sou o|sou a)\s+/, ''),
          itens: null,
        };
      const idx = labels.findIndex((l) =>
        l
          .split(/\W+/)
          .filter((w) => w.length >= 5)
          .some((w) => msg.includes(w)),
      );
      if (idx >= 0)
        return { acao: 'opcao', opcao: idx + 1, valor: null, itens: null };
      return { acao: 'ininteligivel', opcao: null, valor: null, itens: null };
    }
    case 'faq': {
      if (/quanto custa|preço|preco|valor|desconto/.test(msg))
        return { respondivel: false, resposta: null, fontes: null };
      const m = /^\[([^\]]+)\] (.*)$/m.exec(call.user);
      return m
        ? { respondivel: true, resposta: m[2].slice(0, 140), fontes: [m[1]] }
        : { respondivel: false, resposta: null, fontes: null };
    }
    case 'verifier':
      return { aprovado: true, motivo: 'ok' };
    default:
      return null;
  }
}

export interface World {
  svc: ChatbotService;
  convs: Map<number, any>;
  sent: Array<{ ticketId: number; texts: string[] }>;
  tickets: Array<{ ticketId: number; patch: any }>;
  crm: { calls: Array<[string, ...any[]]>; fail?: Record<string, CrmError> };
  drive: {
    folders: string[];
    files: string[];
    answers: any[];
    available: boolean;
  };
  cfg: any;
  ai: { enabled: boolean; breakerOpen: boolean; calls: number };
  rotation: { picks: any[]; i: number };
  say(
    contactId: number,
    text: string,
    opts?: Partial<Inbound> & { ticketId?: number },
  ): Promise<string[]>;
  last(contactId: number): string;
  conv(contactId: number): any;
}

let seq = 0;
export const nextSeq = () => ++seq;

export function build(
  over: {
    cfg?: any;
    rotation?: any[];
    live?: { apiKey: string; writer?: boolean; atendente?: boolean };
  } = {},
): World {
  runtimeContent.published = {
    fluxos: seedFlows(),
    sistema: { ...DEFAULT_SYSTEM },
  };
  const cfg = {
    chatbot: {
      enabled: true,
      aiEnabled: true,
      debounceMs: 0,
      maxInvalid: 3,
      maxOffTopic: 3,
      humanIdleMinutes: 60,
      testMode: false,
      testNumbers: '',
      humanize: false,
      typingDelay: false,
      aiDailyLimit: 40,
      fallbackGosacUserId: 99,
      fallbackGosacQueueId: 9,
      ...over.cfg,
    },
    gosacApi: { baseUrl: 'https://gosac.exemplo.com', apiKey: 'k' },
    crm: { enabled: true, baseUrl: 'https://crm', apiKey: 'k', fluxo: '2.2' },
  };

  const convs = new Map<number, any>();
  const repo = {
    findOne: async ({ where }: any) => convs.get(where.contactId) ?? null,
    create: (x: any) => ({ aiCallsDay: 0, ...x }),
    save: async (c: any) => (convs.set(c.contactId, c), c),
    count: async () => convs.size,
    delete: async () => ({ affected: 0 }),
  };

  const sent: World['sent'] = [];
  const tickets: World['tickets'] = [];
  const messenger = {
    sendTexts: async (ticketId: number, texts: string[]) =>
      void sent.push({ ticketId, texts }),
    updateTicket: async (ticketId: number, patch: any) =>
      void tickets.push({ ticketId, patch }),
    downloadMedia: async () => ({
      filename: 'planta.png',
      contentType: 'image/png',
      data: Buffer.from('x'),
    }),
  };

  const drive = {
    folders: [] as string[],
    files: [] as string[],
    answers: [] as any[],
    available: true,
  };
  const driveSvc = {
    get enabled() {
      return drive.available;
    },
    ensureClientFolder: async (ticket: number, nome: string) => {
      if (!drive.available) return null;
      drive.folders.push(`${ticket} - ${nome}`);
      return `pasta-${ticket}`;
    },
    saveFile: async (_f: string, nome: string, file: string) =>
      void drive.files.push(`${nome}/${file}`),
    saveAnswers: async (_f: string, nome: string, _t: string, itens: any[]) =>
      void drive.answers.push({ nome, itens }),
    savePreferences: async () => undefined,
  };

  const crm: World['crm'] = { calls: [] };
  const crmSvc = {
    enabled: true,
    indisponivelPorque: '',
    ...Object.fromEntries(
      ['registrar', 'editar', 'nota', 'checklist', 'avancar', 'perder'].map(
        (m) => [
          m,
          async (...a: any[]) => {
            crm.calls.push([m, ...a]);
            if (crm.fail?.[m]) throw crm.fail[m];
            return m === 'registrar'
              ? {
                  acao: 'criado',
                  id: 'lead-1',
                  consultor: '',
                  status: 'ativo',
                  etapa: 'novo',
                }
              : undefined;
          },
        ],
      ),
    ),
  };

  const rotation = {
    picks: over.rotation ?? [
      {
        rotationId: 'r1',
        name: 'Ana Projetista',
        gosacUserId: 11,
        gosacQueueId: 1,
      },
      {
        rotationId: 'r2',
        name: 'Bia Projetista',
        gosacUserId: 12,
        gosacQueueId: 1,
      },
    ],
    i: 0,
  };
  const rotationSvc = {
    next: async () =>
      rotation.picks.length
        ? rotation.picks[rotation.i++ % rotation.picks.length]
        : null,
  };

  const ai = { enabled: true, breakerOpen: false, calls: 0 };
  const liveCfg = over.live
    ? {
        ...cfg,
        openai: {
          apiKey: over.live.apiKey,
          model: 'gpt-4o-mini',
          temperature: 0,
          timeoutMs: 20000,
        },
        modelFor: (a: string) =>
          (a === 'writer' && process.env.MODELO_ATENDENTE) || 'gpt-4o-mini',
      }
    : null;
  const liveAi = liveCfg ? new OpenAiService(liveCfg as never) : null;
  const openai: any = liveAi ?? {
    get enabled() {
      return ai.enabled;
    },
    get breakerOpen() {
      return ai.breakerOpen;
    },
    callTool: async (call: any) => (ai.calls++, pretendModel(call)),
  };
  if (liveAi) {
    const original = liveAi.callTool.bind(liveAi);
    liveAi.callTool = (async (call: any) => (
      ai.calls++,
      original(call)
    )) as never;
  }
  const agents = new AgentOrchestrator(
    openai as never,
    new ScopeAgent(openai as never),
    new InterpreterAgent(openai as never),
    new FaqAgent(openai as never),
    new VerifierAgent(openai as never),
  );
  const fakeHumanizer = {
    compose: async (_c: any, replies: any[]) => replies.map((r) => r.texto),
  };
  const humanizer: any =
    liveAi && over.live?.writer
      ? new ChatbotHumanizerService(
          {
            ...liveCfg,
            chatbot: {
              ...cfg.chatbot,
              humanize: true,
              writerDailyLimit: 500,
              atendente: !!over.live?.atendente,
            },
          } as never,
          liveAi,
          new WriterAgent(liveAi),
          new AttendantAgent(liveAi),
        )
      : fakeHumanizer;
  const handoff = new ChatbotHandoffService(
    cfg as never,
    messenger as never,
    rotationSvc as never,
    crmSvc as never,
    humanizer as never,
  );
  const tools = new ToolRegistry(
    driveSvc as never,
    crmSvc as never,
    cfg as never,
  );

  const svc = new ChatbotService(
    cfg as never,
    repo as never,
    messenger as never,
    openai as never,
    agents,
    humanizer as never,
    handoff,
    driveSvc as never,
    new FakeInbox() as never,
    new FakeLock() as never,
    tools,
  );

  const world: World = {
    svc,
    convs,
    sent,
    tickets,
    crm,
    drive,
    cfg,
    ai,
    rotation,
    async say(contactId, text, opts = {}) {
      const before = sent.length;
      const msg: Inbound = {
        messageId: `m${++seq}`,
        contactId,
        ticketId:
          opts.ticketId ?? convs.get(contactId)?.ticketId ?? contactId * 10,
        body: text,
        fromMe: false,
        isGroup: false,
        numero: `5592${String(contactId).padStart(9, '9')}`,
        contactName: 'Contato',
        ticketCreatedAt: new Date(),
        ...opts,
      };
      const batch = (svc as any).toBatch([
        { id: String(seq), msg, receivedAt: new Date() },
      ]);
      await svc.process(batch);
      return sent
        .slice(before)
        .filter((s) => s.ticketId === msg.ticketId)
        .flatMap((s) => s.texts);
    },
    last: (c) =>
      sent
        .filter((s) => s.ticketId === (convs.get(c)?.ticketId ?? c * 10))
        .flatMap((s) => s.texts)
        .slice(-1)[0] ?? '',
    conv: (c) => convs.get(c),
  };
  return world;
}

export const file = { mediaType: 'image', mediaPath: MEDIA, body: '' };
export const joined = (t: string[]) => t.join('\n');

/** Leva um cliente novo até o fim de uma trilha, devolvendo o que o bot disse em cada passo. */
export async function percorrer(
  w: World,
  c: number,
  passos: Array<string | [string, Partial<Inbound>]>,
) {
  const out: string[][] = [];
  for (const p of passos) {
    const [txt, o] = Array.isArray(p) ? p : [p, {}];
    out.push(await w.say(c, txt, o));
  }
  return out;
}
