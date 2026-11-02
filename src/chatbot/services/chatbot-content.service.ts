import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { SettingsService } from '../../settings/settings.service';
import {
  CATEGORIAS_AMBIENTE,
  DEFAULT_CATEGORIAS,
  DEFAULT_MESSAGES,
  MESSAGES,
  MessageKey,
} from '../domain/chatbot.messages';
import {
  DEFAULT_KB,
  KbEntry,
  KNOWLEDGE_BASE,
  strip,
} from '../domain/knowledge-base';
import { setExtraAllowedNumbers } from '../domain/free-reply.guard';
import { refreshMessageMatchers, SPECS } from '../domain/message-specs';
import { runtimeContent, TONES, ToneKey } from '../domain/content-runtime';
import {
  checkFlow,
  CustomFlow,
  CustomState,
  FlowNode,
  slug,
  startFlow,
  stepFlow,
  TOOLS,
} from '../domain/custom-flow';
import { AppConfigService } from '../../infrastructure/config/app-config.service';

const CATEGORY = 'chatbot_content';
const K_PUBLISHED = 'CHATBOT_CONTENT_PUBLISHED';
const K_DRAFT = 'CHATBOT_CONTENT_DRAFT';
const K_PREVIOUS = 'CHATBOT_CONTENT_PREVIOUS';

const MAX_MESSAGE = 1600;
const MAX_KB = 50;

/** Tudo que a tela pode personalizar. Ausente = padrão do código. */
export interface ContentDoc {
  /** Só as mensagens alteradas. */
  messages: Record<string, string>;
  /** null = base padrão do código. */
  kb: KbEntry[] | null;
  /** Só os ambientes renomeados (chaves 1–8). */
  categorias: Record<string, string>;
  guidance: { tone: ToneKey; instructions: string };
  /** Opções do menu inicial que não devem mais ser aceitas (4 e/ou 5). */
  menuDesativado: number[];
  /** Fluxos de atendimento criados pela tela (além do fluxo padrão). */
  fluxos: CustomFlow[];
}

interface Stored {
  doc: ContentDoc;
  at: string;
  by: string | null;
}

export const emptyDoc = (): ContentDoc => ({
  messages: {},
  kb: null,
  categorias: {},
  guidance: { tone: 'padrao', instructions: '' },
  menuDesativado: [],
  fluxos: [],
});

const placeholdersOf = (t: string) =>
  [...new Set([...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
const optionNumbersOf = (t: string) => [
  ...new Set([...t.matchAll(/\*(\d{1,2})\*/g)].map((m) => Number(m[1]))),
];

@Injectable()
export class ChatbotContentService implements OnModuleInit {
  private readonly logger = new Logger(ChatbotContentService.name);
  private appliedJson = '';

  constructor(
    private readonly settings: SettingsService,
    private readonly appConfig?: AppConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
  }

  /** Outras instâncias do backend enxergam uma publicação em até 30 s. */
  @Interval(30_000)
  async reload(): Promise<void> {
    try {
      const stored = await this.read(K_PUBLISHED);
      this.apply(stored?.doc ?? emptyDoc());
    } catch (error) {
      this.logger.warn(
        `Não foi possível carregar o conteúdo da IA: ${(error as Error).message}`,
      );
    }
  }

  // ───────────────────────── leitura ─────────────────────────

  async get() {
    const [published, draft, previous] = await Promise.all([
      this.read(K_PUBLISHED),
      this.read(K_DRAFT),
      this.read(K_PREVIOUS),
    ]);
    const specs: Record<string, unknown> = {};
    for (const key of Object.keys(DEFAULT_MESSAGES)) {
      const spec = SPECS[key as MessageKey];
      specs[key] = {
        objetivo: spec?.objetivo ?? null,
        pontos: (spec?.pontos ?? []).map((p) => p.anyOf[0]),
        placeholders: placeholdersOf(DEFAULT_MESSAGES[key as MessageKey]),
      };
    }
    return {
      published: published?.doc ?? emptyDoc(),
      publishedAt: published?.at ?? null,
      publishedBy: published?.by ?? null,
      draft: draft?.doc ?? null,
      draftAt: draft?.at ?? null,
      hasPrevious: !!previous,
      problemas: draft ? this.problemsOf(draft.doc) : [],
      defaults: {
        messages: { ...DEFAULT_MESSAGES },
        kb: DEFAULT_KB,
        categorias: { ...DEFAULT_CATEGORIAS },
      },
      specs,
      ferramentas: TOOLS.map((t) => ({
        ...t,
        disponivel: !!this.appConfig?.chatbot.driveRootFolderId,
      })),
      tones: Object.entries(TONES).map(([key, t]) => ({
        key,
        label: t.label,
      })),
    };
  }

  // ───────────────────────── escrita ─────────────────────────

  async saveDraft(input: unknown, by: string | null) {
    const doc = this.validate(input, false);
    await this.write(K_DRAFT, { doc, at: new Date().toISOString(), by });
    return this.get();
  }

  async discardDraft() {
    await this.settings.delete(K_DRAFT).catch(() => undefined);
    return this.get();
  }

  /** Publica o rascunho: passa a valer para os clientes, guardando a versão anterior para reverter. */
  async publish(by: string | null) {
    const draft = await this.read(K_DRAFT);
    if (!draft) throw new BadRequestException('Não há rascunho para publicar.');
    const doc = this.validate(draft.doc); // revalida: o código pode ter mudado desde o rascunho
    const current = await this.read(K_PUBLISHED);
    if (current) await this.write(K_PREVIOUS, current);
    await this.write(K_PUBLISHED, { doc, at: new Date().toISOString(), by });
    await this.settings.delete(K_DRAFT).catch(() => undefined);
    this.apply(doc);
    return this.get();
  }

  async rollback(by: string | null) {
    const previous = await this.read(K_PREVIOUS);
    if (!previous)
      throw new BadRequestException('Não há versão anterior para voltar.');
    const current = await this.read(K_PUBLISHED);
    await this.write(K_PUBLISHED, {
      doc: previous.doc,
      at: new Date().toISOString(),
      by,
    });
    if (current) await this.write(K_PREVIOUS, current);
    this.apply(previous.doc);
    return this.get();
  }

  // ───────────────────────── validação ─────────────────────────

  /** O que ainda impede de publicar este rascunho. */
  private problemsOf(doc: ContentDoc): string[] {
    try {
      this.validate(doc);
      return [];
    } catch (e) {
      const m = (e as BadRequestException).getResponse() as {
        message?: string | string[];
      };
      return Array.isArray(m?.message) ? m.message : [String(m?.message ?? '')];
    }
  }

  /** `strictFlows=false` (rascunho) aceita fluxos incompletos; publicar exige tudo válido. */
  validate(input: unknown, strictFlows = true): ContentDoc {
    if (!input || typeof input !== 'object')
      throw new BadRequestException('Conteúdo inválido.');
    const raw = input as Partial<ContentDoc>;
    const errors: string[] = [];
    const doc = emptyDoc();

    const desativado = Array.isArray(raw.menuDesativado)
      ? [...new Set(raw.menuDesativado.map(Number))]
      : [];
    if (desativado.some((n) => n !== 4 && n !== 5))
      errors.push('Só as opções 4 e 5 do menu podem ser desativadas.');
    doc.menuDesativado = desativado.filter((n) => n === 4 || n === 5);

    for (const [key, value] of Object.entries(raw.messages ?? {})) {
      if (!(key in DEFAULT_MESSAGES)) {
        errors.push(`Mensagem desconhecida: ${key}.`);
        continue;
      }
      if (typeof value !== 'string') {
        errors.push(`${key}: o texto precisa ser uma string.`);
        continue;
      }
      const text = value.replace(/\r/g, '').trim();
      if (text === DEFAULT_MESSAGES[key as MessageKey]) continue; // igual ao padrão: não é override
      const problem = this.checkMessage(
        key as MessageKey,
        text,
        doc.menuDesativado,
      );
      if (problem) errors.push(`${key}: ${problem}`);
      else doc.messages[key] = text;
    }

    for (const [n, name] of Object.entries(raw.categorias ?? {})) {
      if (!(Number(n) in DEFAULT_CATEGORIAS)) {
        errors.push(`Ambiente desconhecido: ${n}.`);
        continue;
      }
      const nome = String(name ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      if (nome.length < 2 || nome.length > 40)
        errors.push(`Ambiente ${n}: o nome precisa ter de 2 a 40 caracteres.`);
      else if (nome !== DEFAULT_CATEGORIAS[Number(n)]) doc.categorias[n] = nome;
    }

    if (raw.kb !== null && raw.kb !== undefined) {
      if (!Array.isArray(raw.kb)) errors.push('Base de conhecimento inválida.');
      else if (raw.kb.length > MAX_KB)
        errors.push(`A base aceita no máximo ${MAX_KB} entradas.`);
      else {
        const ids = new Set<string>();
        const kb: KbEntry[] = [];
        raw.kb.forEach((e, i) => {
          const text = String(e?.text ?? '')
            .replace(/\s+/g, ' ')
            .trim();
          if (text.length < 10 || text.length > 600) {
            errors.push(
              `Base, item ${i + 1}: o texto precisa ter de 10 a 600 caracteres.`,
            );
            return;
          }
          let id = strip(String(e?.id ?? ''))
            .replace(/[^a-z0-9_-]/g, '')
            .slice(0, 40);
          if (!id) id = `item-${i + 1}`;
          while (ids.has(id)) id = `${id}-x`;
          ids.add(id);
          let keywords = (Array.isArray(e?.keywords) ? e.keywords : [])
            .map((k) => strip(String(k)).replace(/[^a-z0-9]/g, ''))
            .filter((k) => k.length >= 2 && k.length <= 30);
          if (!keywords.length)
            keywords = strip(text)
              .split(/[^a-z0-9]+/)
              .filter((w) => w.length >= 4);
          keywords = [...new Set(keywords)].slice(0, 30);
          if (!keywords.length)
            errors.push(
              `Base, item ${i + 1}: informe ao menos uma palavra-chave.`,
            );
          else kb.push({ id, keywords, text });
        });
        doc.kb = kb;
      }
    }

    doc.fluxos = this.validateFlows(raw.fluxos, strictFlows ? errors : []);

    const g = raw.guidance;
    if (g) {
      const tone = (g.tone ?? 'padrao') as ToneKey;
      if (!(tone in TONES)) errors.push('Tom desconhecido.');
      const instructions = String(g.instructions ?? '').trim();
      if (instructions.length > 1500)
        errors.push('As instruções para a IA passam de 1500 caracteres.');
      doc.guidance = { tone, instructions };
    }

    if (errors.length) throw new BadRequestException(errors);
    return doc;
  }

  private validateFlows(input: unknown, errors: string[]): CustomFlow[] {
    if (input === undefined || input === null) return [];
    if (!Array.isArray(input)) {
      errors.push('Fluxos inválidos.');
      return [];
    }
    if (input.length > 10) errors.push('São permitidos no máximo 10 fluxos.');
    const ids = new Set<string>();
    const opcoes = new Set<number>();
    const out: CustomFlow[] = [];
    input.slice(0, 10).forEach((raw: Partial<CustomFlow>, i) => {
      const nome = String(raw?.nome ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      const label = nome || `Fluxo ${i + 1}`;
      if (nome.length < 2 || nome.length > 40)
        errors.push(`${label}: o nome precisa ter de 2 a 40 caracteres.`);
      let id = slug(String(raw?.id ?? nome)).slice(0, 30) || `fluxo_${i + 1}`;
      while (ids.has(id)) id = `${id}_x`.slice(0, 30);
      ids.add(id);
      const ativo = raw?.ativo !== false;
      const opcao = raw?.menuOpcao == null ? null : Number(raw.menuOpcao);
      if (ativo) {
        if (
          opcao === null ||
          !Number.isInteger(opcao) ||
          opcao < 6 ||
          opcao > 9
        )
          errors.push(
            `${label}: escolha a opção do menu (6 a 9) para ele aparecer ao cliente, ou deixe-o desativado.`,
          );
        else if (opcoes.has(opcao))
          errors.push(
            `${label}: a opção ${opcao} do menu já é usada por outro fluxo.`,
          );
        else opcoes.add(opcao);
      }
      const nos: FlowNode[] = (Array.isArray(raw?.nos) ? raw.nos : []).map(
        (n: FlowNode) => ({
          id: String(n?.id ?? '').slice(0, 30),
          tipo: n?.tipo,
          titulo: String(n?.titulo ?? '')
            .trim()
            .slice(0, 60),
          texto:
            n?.texto === undefined
              ? undefined
              : String(n.texto).replace(/\r/g, '').trim(),
          proximo: n?.proximo ?? null,
          opcoes: Array.isArray(n?.opcoes)
            ? n.opcoes.map((o) => ({
                rotulo: String(o?.rotulo ?? '').trim(),
                proximo: o?.proximo ?? null,
              }))
            : undefined,
          variavel: n?.variavel ? String(n.variavel) : undefined,
          validacao:
            n?.validacao === 'nome'
              ? 'nome'
              : n?.validacao === 'texto'
                ? 'texto'
                : undefined,
          minimo: n?.minimo === undefined ? undefined : Number(n.minimo) || 0,
          acao: n?.acao,
        }),
      );
      const flow: CustomFlow = {
        id,
        nome,
        descricao: raw?.descricao
          ? String(raw.descricao).trim().slice(0, 200)
          : undefined,
        ativo,
        menuOpcao: opcao,
        nos,
      };
      for (const p of checkFlow(flow)) errors.push(`${label}: ${p}`);
      out.push(flow);
    });
    return out;
  }

  /** Roda um fluxo (rascunho) sem enviar nada: devolve o que o bot diria e o novo estado. */
  previewFlow(input: {
    fluxo: unknown;
    estado: CustomState | null;
    texto?: string;
  }) {
    const errors: string[] = [];
    const [flow] = this.validateFlows(
      [{ ...(input.fluxo as object), ativo: false }],
      errors,
    );
    if (errors.length) throw new BadRequestException(errors);
    const r =
      input.estado && input.estado.flowId === flow.id
        ? stepFlow(
            flow,
            input.estado,
            { text: input.texto ?? '', hasFile: false },
            { maxInvalid: 3 },
          )
        : startFlow(flow, null);
    const rotulos: Record<string, string> = {
      criar_pasta: 'Drive: criar a pasta do cliente',
      salvar_respostas: 'Drive: salvar as respostas',
      handoff: 'Encaminhar a um atendente',
    };
    return {
      estado: r.state,
      mensagens: r.replies,
      efeitos: r.effects.map((e) => rotulos[e.type]),
      saiu: r.saiu,
    };
  }

  private checkMessage(
    key: MessageKey,
    text: string,
    menuDesativado: number[],
  ): string | null {
    if (!text)
      return 'o texto não pode ficar vazio (use "Restaurar padrão" para voltar ao original).';
    if (text.length > MAX_MESSAGE)
      return `o texto passa de ${MAX_MESSAGE} caracteres.`;
    const base = DEFAULT_MESSAGES[key];
    const want = placeholdersOf(base);
    const have = placeholdersOf(text);
    const missing = want.filter((p) => !have.includes(p));
    if (missing.length)
      return `falta ${missing.map((p) => `{${p}}`).join(', ')} — o sistema preenche isso na hora de enviar.`;
    const extra = have.filter((p) => !want.includes(p));
    if (extra.length)
      return `${extra.map((p) => `{${p}}`).join(', ')} não existe nesta mensagem.`;
    const isMenu = key === 'menu_inicial' || key === 'menu_reapresentado';
    const needNumbers = optionNumbersOf(base).filter(
      (n) => !(isMenu && menuDesativado.includes(n)),
    );
    const haveNumbers = optionNumbersOf(text);
    const lost = needNumbers.filter((n) => !haveNumbers.includes(n));
    if (lost.length)
      return `as opções ${lost.map((n) => `*${n}*`).join(', ')} precisam continuar no texto, porque o cliente responde com esses números.`;
    return null;
  }

  // ───────────────────────── aplicação em memória ─────────────────────────

  apply(doc: ContentDoc): void {
    const json = JSON.stringify(doc);
    if (json === this.appliedJson) return;
    this.appliedJson = json;

    const messages = MESSAGES as unknown as Record<string, string>;
    for (const key of Object.keys(DEFAULT_MESSAGES))
      messages[key] = doc.messages[key] ?? DEFAULT_MESSAGES[key as MessageKey];

    for (const n of Object.keys(DEFAULT_CATEGORIAS))
      CATEGORIAS_AMBIENTE[Number(n)] =
        doc.categorias[n] ?? DEFAULT_CATEGORIAS[Number(n)];

    const kb = (doc.kb ?? DEFAULT_KB).map((e) => ({
      ...e,
      keywords: [...e.keywords],
    }));
    KNOWLEDGE_BASE.splice(0, KNOWLEDGE_BASE.length, ...kb);
    setExtraAllowedNumbers(kb.map((e) => e.text));

    runtimeContent.guidance = { ...doc.guidance };
    runtimeContent.menuDesativado = [...doc.menuDesativado];
    runtimeContent.fluxos = doc.fluxos.map((f) =>
      JSON.parse(JSON.stringify(f)),
    );

    // Fluxos ativos aparecem no menu inicial, depois da última opção numerada.
    const extras = doc.fluxos
      .filter((f) => f.ativo && f.menuOpcao)
      .sort((a, b) => (a.menuOpcao ?? 0) - (b.menuOpcao ?? 0))
      .map((f) => `*${f.menuOpcao}* - ${f.nome}`);
    if (extras.length)
      for (const key of ['menu_inicial', 'menu_reapresentado'] as const) {
        const lines = messages[key].split('\n');
        let last = -1;
        lines.forEach((l, i) => {
          if (/^\*\d{1,2}\* - /.test(l)) last = i;
        });
        if (last >= 0) lines.splice(last + 1, 0, ...extras);
        else lines.push(...extras);
        messages[key] = lines.join('\n');
      }
    refreshMessageMatchers();
  }

  // ───────────────────────── armazenamento ─────────────────────────

  private async read(key: string): Promise<Stored | null> {
    const all = await this.settings.getAllDecrypted();
    const row = all.find((s) => s.category === CATEGORY && s.key === key);
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.value) as Stored;
      return parsed?.doc ? parsed : null;
    } catch {
      return null;
    }
  }

  private async write(key: string, stored: Stored): Promise<void> {
    await this.settings.upsert(
      key,
      JSON.stringify(stored),
      CATEGORY,
      'Conteúdo do chatbot (mensagens, base, ambientes, guia da IA)',
    );
  }
}
