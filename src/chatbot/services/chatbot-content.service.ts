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

  constructor(private readonly settings: SettingsService) {}

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
      defaults: {
        messages: { ...DEFAULT_MESSAGES },
        kb: DEFAULT_KB,
        categorias: { ...DEFAULT_CATEGORIAS },
      },
      specs,
      tones: Object.entries(TONES).map(([key, t]) => ({
        key,
        label: t.label,
      })),
    };
  }

  // ───────────────────────── escrita ─────────────────────────

  async saveDraft(input: unknown, by: string | null) {
    const doc = this.validate(input);
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

  validate(input: unknown): ContentDoc {
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
