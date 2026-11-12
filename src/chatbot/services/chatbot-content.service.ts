import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
import { SettingsService } from '../../settings/settings.service';
import { ChatbotHumanizerService } from './chatbot-humanizer.service';
import {
  DEFAULT_KB,
  KbEntry,
  KNOWLEDGE_BASE,
  strip,
} from '../domain/knowledge-base';
import { setExtraAllowedNumbers } from '../domain/free-reply.guard';
import {
  ConteudoEmUso,
  runtimeContent,
  TONES,
  ToneKey,
} from '../domain/content-runtime';
import {
  ContentDoc,
  FlowDoc,
  FlowNode,
  FlowState,
  LIMITS,
  NodeSpec,
  NodeType,
  SystemMessageKey,
  SystemMessages,
} from '../engine/flow.types';
import { checkDoc, checkFlow } from '../engine/flow.validate';
import { DEFAULT_SYSTEM, SYSTEM_LABELS, seedFlows } from '../engine/flow.seed';
import { convertLegacyDoc, isLegacyDoc } from '../engine/legacy';
import {
  parseText,
  promptOf,
  resumeTool,
  startFlow,
  stepFlow,
} from '../engine/flow.engine';
import { slug } from '../engine/text';
import { ToolRegistry } from '../tools/tool.registry';
import { emTeste } from './ai-usage.service';

const CATEGORY = 'chatbot_content';
const K_PUBLISHED = 'CHATBOT_CONTENT_PUBLISHED';
const K_DRAFT = 'CHATBOT_CONTENT_DRAFT';
const K_PREVIOUS = 'CHATBOT_CONTENT_PREVIOUS';

interface Stored {
  doc: ContentDoc;
  at: string;
  by: string | null;
}

export const emptyDoc = (): ContentDoc => ({
  versao: 2,
  fluxos: seedFlows(),
  guidance: { tone: 'padrao', instructions: '' },
  kb: null,
  sistema: {},
});

/** Tipos de etapa que a tela oferece (o motor sabe executá-los). */
export const NODE_TYPES_INFO: Array<{
  tipo: NodeType;
  grupo: string;
  label: string;
  ajuda: string;
  regra: string;
}> = [
  {
    tipo: 'mensagem',
    grupo: 'Falar',
    label: 'Mensagem',
    ajuda: 'Informa algo e segue sozinha.',
    regra: 'Sem requisitos. Segue sozinha para a próxima etapa.',
  },
  {
    tipo: 'confirmacao',
    grupo: 'Falar',
    label: 'Confirmação',
    ajuda: 'Pergunta com Sim ou Não.',
    regra: 'Sempre duas respostas, Sim e Não, cada uma com o seu caminho.',
  },
  {
    tipo: 'opcoes',
    grupo: 'Receber do cliente',
    label: 'Escolha',
    ajuda: 'Menu numerado, cada opção segue um caminho.',
    regra:
      'De 2 a 9 opções, cada uma com o seu caminho. Palavras-chave ajudam a entender texto livre.',
  },
  {
    tipo: 'multipla',
    grupo: 'Receber do cliente',
    label: 'Lista de itens',
    ajuda: 'O cliente marca vários itens (ex.: ambientes) e confirma com OK.',
    regra: 'Até 12 itens; a resposta fica na variável como lista.',
  },
  {
    tipo: 'pergunta',
    grupo: 'Receber do cliente',
    label: 'Pergunta',
    ajuda: 'Espera uma resposta escrita e guarda.',
    regra: 'Dê um nome à resposta. Use “nome” para o nome do cliente.',
  },
  {
    tipo: 'arquivos',
    grupo: 'Receber do cliente',
    label: 'Arquivos',
    ajuda:
      'Pede arquivos; vão para a pasta do cliente no Drive, se ela existir.',
    regra:
      'Para guardar no Drive, crie a pasta antes com a ferramenta “Drive: criar a pasta do cliente”.',
  },
  {
    tipo: 'ferramenta',
    grupo: 'Fazer',
    label: 'Ferramenta',
    ajuda: 'Faz algo sozinho: Drive, agenda, guardar valor.',
    regra:
      'Cada ferramenta diz o que precisa antes (ex.: nome do cliente, pasta criada).',
  },
  {
    tipo: 'condicao',
    grupo: 'Fazer',
    label: 'Condição',
    ajuda: 'Decide o caminho pelo que o cliente respondeu.',
    regra:
      'Compara variáveis já respondidas. A primeira regra que valer decide; senão, segue o caminho padrão.',
  },
  {
    tipo: 'ir_para',
    grupo: 'Terminar',
    label: 'Ir para outro fluxo',
    ajuda: 'Continua em outro fluxo (ex.: do menu para “Já tenho projeto”).',
    regra:
      'O outro fluxo precisa estar ativo. As respostas já dadas continuam disponíveis.',
  },
  {
    tipo: 'encaminhar',
    grupo: 'Terminar',
    label: 'Encaminhar',
    ajuda: 'Passa a um atendente e termina.',
    regra: 'Termina o fluxo: nada pode vir depois.',
  },
  {
    tipo: 'fim',
    grupo: 'Terminar',
    label: 'Encerrar',
    ajuda: 'Termina e volta ao início.',
    regra: 'Termina o fluxo: o cliente volta ao fluxo de início.',
  },
];

const asText = (v: unknown): string =>
  v === null || v === undefined
    ? ''
    : typeof v === 'object'
      ? ''
      : String(v as string | number | boolean);
const str = (v: unknown, max: number) =>
  asText(v).replace(/\r/g, '').trim().slice(0, max);
const optStr = (v: unknown, max: number) =>
  v === undefined || v === null || v === '' ? undefined : str(v, max);
const idOf = (v: unknown, fallback: string) =>
  (str(v, 40).replace(/[^A-Za-z0-9_-]/g, '') || fallback).slice(0, 40);
const nullableId = (v: unknown) => (v ? idOf(v, '') || null : null);

@Injectable()
export class ChatbotContentService implements OnModuleInit {
  private readonly logger = new Logger(ChatbotContentService.name);
  private appliedJson = '';

  constructor(
    private readonly settings: SettingsService,
    private readonly tools: ToolRegistry,
    private readonly humanizer: ChatbotHumanizerService,
    private readonly appConfig: AppConfigService,
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
    return {
      published: published?.doc ?? emptyDoc(),
      publishedAt: published?.at ?? null,
      publishedBy: published?.by ?? null,
      draft: draft?.doc ?? null,
      draftAt: draft?.at ?? null,
      hasPrevious: !!previous,
      problemas: draft ? this.problemsOf(draft.doc) : [],
      ferramentas: this.tools.describe(),
      tipos: NODE_TYPES_INFO,
      tones: Object.entries(TONES).map(([key, t]) => ({ key, label: t.label })),
      sistema: { padrao: DEFAULT_SYSTEM, rotulos: SYSTEM_LABELS },
      defaults: { kb: DEFAULT_KB },
      limites: {
        fluxos: LIMITS.fluxos,
        nos: LIMITS.nos,
        opcoes: LIMITS.opcoes,
        itens: LIMITS.itens,
        texto: LIMITS.texto,
      },
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
    const doc = this.validate(draft.doc, true); // revalida: o código pode ter mudado desde o rascunho
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
  problemsOf(doc: ContentDoc): string[] {
    try {
      this.validate(doc, true);
      return [];
    } catch (e) {
      const m = (e as BadRequestException).getResponse() as {
        message?: string | string[];
      };
      return Array.isArray(m?.message) ? m.message : [String(m?.message ?? '')];
    }
  }

  /** `strict=false` (rascunho) aceita fluxos incompletos; publicar exige tudo válido. */
  validate(input: unknown, strict: boolean): ContentDoc {
    if (!input || typeof input !== 'object')
      throw new BadRequestException('Conteúdo inválido.');
    const raw = input as Partial<ContentDoc>;
    const errors: string[] = [];

    if (!Array.isArray(raw.fluxos)) errors.push('Fluxos inválidos.');
    const lista = Array.isArray(raw.fluxos) ? raw.fluxos : [];
    if (lista.length > LIMITS.fluxos)
      errors.push(`São permitidos no máximo ${LIMITS.fluxos} fluxos.`);
    const ids = new Set<string>();
    const fluxos: FlowDoc[] = lista.slice(0, LIMITS.fluxos).map((f, i) => {
      const nome = str(f?.nome, 40).replace(/\s+/g, ' ');
      const label = nome || `Fluxo ${i + 1}`;
      if (nome.length < 2)
        errors.push(`${label}: o nome precisa ter de 2 a 40 caracteres.`);
      let id = slug(String(f?.id ?? nome)).slice(0, 30) || `fluxo_${i + 1}`;
      while (ids.has(id)) id = `${id}_x`.slice(0, 30);
      ids.add(id);
      const g = f?.guidance;
      const papel = f?.papel;
      return {
        id,
        nome,
        descricao: optStr(f?.descricao, 200),
        ativo: f?.ativo !== false,
        papel: papel === 'entrada' || papel === 'reconhecimento' ? papel : null,
        nos: this.normalizeNodes(f?.nos, errors, label),
        reescrever: f?.reescrever === true,
        guidance: g
          ? this.validateGuidance(g, errors, `${label} — jeito de falar`)
          : undefined,
        kb: f?.kb
          ? this.validateKb(f.kb, errors, `${label} — o que ela sabe`)
          : [],
      };
    });

    if (strict) {
      for (const f of fluxos)
        for (const p of checkFlow(f, this.tools, fluxos))
          errors.push(`${f.nome}: ${p}`);
      errors.push(...checkDoc(fluxos));
    }

    const sistema: Partial<SystemMessages> = {};
    for (const [k, v] of Object.entries(raw.sistema ?? {})) {
      if (!(k in DEFAULT_SYSTEM)) {
        errors.push(`Mensagem do sistema desconhecida: ${k}.`);
        continue;
      }
      const text = str(v, LIMITS.texto);
      if (!text || text === DEFAULT_SYSTEM[k as SystemMessageKey]) continue;
      if (k === 'redirecionando_com_nome' && !text.includes('{nome}')) {
        errors.push(
          '“Encaminhando ao atendente (com nome)” precisa conter {nome}.',
        );
        continue;
      }
      sistema[k as SystemMessageKey] = text;
    }

    const doc: ContentDoc = {
      versao: 2,
      fluxos,
      guidance: this.validateGuidance(
        raw.guidance ?? { tone: 'padrao', instructions: '' },
        errors,
        'Jeito de falar',
      ),
      kb:
        raw.kb === null || raw.kb === undefined
          ? null
          : this.validateKb(raw.kb, errors, 'Base'),
      sistema,
    };
    if (errors.length) throw new BadRequestException([...new Set(errors)]);
    return doc;
  }

  private normalizeNodes(
    input: unknown,
    errors: string[],
    label: string,
  ): FlowNode[] {
    if (!Array.isArray(input)) return [];
    if (input.length > LIMITS.nos)
      errors.push(`${label}: o fluxo aceita no máximo ${LIMITS.nos} etapas.`);
    return input.slice(0, LIMITS.nos).map((raw, i): FlowNode => {
      const n = raw as Record<string, unknown>;
      const base = {
        id: idOf(n['id'], `n${i + 1}`),
        titulo: str(n['titulo'], 60),
      };
      const spec = this.normalizeSpec(n['spec']);
      const texto = str(n['texto'], LIMITS.texto);
      const proximo = nullableId(n['proximo']);
      const opcoes = Array.isArray(n['opcoes'])
        ? (n['opcoes'] as Array<Record<string, unknown>>)
            .slice(0, LIMITS.opcoes)
            .map((o) => ({
              rotulo: str(o?.['rotulo'], LIMITS.rotulo),
              proximo: nullableId(o?.['proximo']),
              valor: optStr(o?.['valor'], 60),
              palavras: Array.isArray(o?.['palavras'])
                ? (o['palavras'] as unknown[])
                    .map((p) => str(p, 40))
                    .filter(Boolean)
                    .slice(0, 10)
                : undefined,
            }))
        : [];
      const variavel = optStr(n['variavel'], 30);
      switch (n['tipo'] as NodeType) {
        case 'mensagem':
          return { ...base, tipo: 'mensagem', texto, proximo, spec };
        case 'pergunta':
          return {
            ...base,
            tipo: 'pergunta',
            texto,
            variavel: variavel ?? '',
            validacao: [
              'nome',
              'texto',
              'numero',
              'telefone',
              'email',
            ].includes(String(n['validacao']))
              ? (n['validacao'] as 'nome')
              : undefined,
            proximo,
            spec,
          };
        case 'opcoes':
          return { ...base, tipo: 'opcoes', texto, variavel, opcoes, spec };
        case 'confirmacao':
          return {
            ...base,
            tipo: 'confirmacao',
            texto,
            variavel,
            opcoes: [
              { ...(opcoes[0] ?? { proximo: null }), rotulo: 'Sim' },
              { ...(opcoes[1] ?? { proximo: null }), rotulo: 'Não' },
            ],
            spec,
          };
        case 'multipla':
          return {
            ...base,
            tipo: 'multipla',
            texto,
            variavel: variavel ?? '',
            itens: Array.isArray(n['itens'])
              ? (n['itens'] as Array<Record<string, unknown>>)
                  .slice(0, LIMITS.itens)
                  .map((it) => ({ rotulo: str(it?.['rotulo'], LIMITS.rotulo) }))
              : [],
            nenhum: optStr(n['nenhum'], LIMITS.rotulo),
            textoApos: optStr(n['textoApos'], LIMITS.texto),
            proximo,
            spec,
          };
        case 'arquivos':
          return {
            ...base,
            tipo: 'arquivos',
            texto,
            textoApos: optStr(n['textoApos'], LIMITS.texto),
            minimo:
              n['minimo'] === undefined ? undefined : Number(n['minimo']) || 0,
            proximo,
            spec,
          };
        case 'ferramenta': {
          const params: Record<string, string | number | boolean | null> = {};
          for (const [k, v] of Object.entries(
            (n['params'] as Record<string, unknown>) ?? {},
          )) {
            if (typeof v === 'boolean' || typeof v === 'number')
              params[k.slice(0, 40)] = v;
            else if (v === null) params[k.slice(0, 40)] = null;
            else params[k.slice(0, 40)] = str(v, LIMITS.texto);
          }
          return {
            ...base,
            tipo: 'ferramenta',
            ferramenta: str(n['ferramenta'], 60),
            params,
            variavel,
            proximo,
            falha: nullableId(n['falha']),
            semOpcoes: nullableId(n['semOpcoes']),
            spec,
          };
        }
        case 'condicao':
          return {
            ...base,
            tipo: 'condicao',
            regras: Array.isArray(n['regras'])
              ? (n['regras'] as Array<Record<string, unknown>>)
                  .slice(0, 10)
                  .map((r) => ({
                    variavel: str(r?.['variavel'], 30),
                    op: [
                      'igual',
                      'diferente',
                      'contem',
                      'vazio',
                      'nao_vazio',
                    ].includes(String(r?.['op']))
                      ? (r['op'] as 'igual')
                      : 'igual',
                    valor: optStr(r?.['valor'], 120),
                    proximo: nullableId(r?.['proximo']),
                  }))
              : [],
            senao: nullableId(n['senao']),
          };
        case 'ir_para':
          return {
            ...base,
            tipo: 'ir_para',
            fluxo: slug(asText(n['fluxo'])).slice(0, 30),
          };
        case 'encaminhar':
          return {
            ...base,
            tipo: 'encaminhar',
            texto: optStr(n['texto'], LIMITS.texto),
            reutilizarAtendente: n['reutilizarAtendente'] === true,
            spec,
          };
        case 'fim':
          return {
            ...base,
            tipo: 'fim',
            texto: optStr(n['texto'], LIMITS.texto),
            spec,
          };
        default:
          errors.push(
            `${label}: a etapa “${base.titulo || base.id}” tem um tipo desconhecido.`,
          );
          return { ...base, tipo: 'mensagem', texto, proximo };
      }
    });
  }

  private normalizeSpec(raw: unknown): NodeSpec | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const s = raw as Record<string, unknown>;
    const pontos = Array.isArray(s['pontos'])
      ? (s['pontos'] as unknown[])
          .map((p) =>
            Array.isArray(p) ? p.map((x) => str(x, 40)).filter(Boolean) : [],
          )
          .filter((p) => p.length)
      : undefined;
    const modo = s['modo'];
    const out: NodeSpec = {
      modo: modo === 'obrigatorio' || modo === 'instrucao' ? modo : undefined,
      objetivo: optStr(s['objetivo'], 600),
      pontos,
      saudacao: s['saudacao'] === true || undefined,
      usaNome: s['usaNome'] === true || undefined,
      maxChars: typeof s['maxChars'] === 'number' ? s['maxChars'] : undefined,
    };
    return Object.values(out).some((v) => v !== undefined) ? out : undefined;
  }

  private validateKb(
    input: unknown,
    errors: string[],
    label: string,
  ): KbEntry[] {
    if (!Array.isArray(input)) {
      errors.push(`${label}: lista inválida.`);
      return [];
    }
    if (input.length > LIMITS.kb) {
      errors.push(`${label}: no máximo ${LIMITS.kb} assuntos.`);
      return [];
    }
    const ids = new Set<string>();
    const kb: KbEntry[] = [];
    (input as Array<Partial<KbEntry>>).forEach((e, i) => {
      const text = String(e?.text ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      if (text.length < 10 || text.length > 600) {
        errors.push(
          `${label}, assunto ${i + 1}: o texto precisa ter de 10 a 600 caracteres.`,
        );
        return;
      }
      let id =
        strip(String(e?.id ?? ''))
          .replace(/[^a-z0-9_-]/g, '')
          .slice(0, 40) || `item-${i + 1}`;
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
          `${label}, assunto ${i + 1}: informe ao menos uma palavra-chave.`,
        );
      else kb.push({ id, keywords, text });
    });
    return kb;
  }

  private validateGuidance(
    g: { tone?: string; instructions?: string },
    errors: string[],
    label: string,
  ): { tone: ToneKey; instructions: string } {
    const tone = (g?.tone ?? 'padrao') as ToneKey;
    if (!(tone in TONES)) errors.push(`${label}: tom desconhecido.`);
    const instructions = String(g?.instructions ?? '').trim();
    if (instructions.length > 1500)
      errors.push(`${label}: as instruções passam de 1500 caracteres.`);
    return { tone: tone in TONES ? tone : 'padrao', instructions };
  }

  // ───────────────────────── prévia de um fluxo em rascunho ─────────────────────────

  /** Roda um fluxo do rascunho sem enviar nada: devolve o que o bot diria e o novo estado. */
  async previewFlow(input: {
    fluxos: unknown;
    fluxoId: string;
    estado: FlowState | null;
    texto?: string;
    /** Passa as mensagens pela IA, com o tom e a reescrita do rascunho (como o cliente receberia). */
    usarIA?: boolean;
    conversa?: Array<{ role: 'cliente' | 'bot'; text: string }>;
  }) {
    const doc = this.validate(
      { ...emptyDoc(), fluxos: input.fluxos, kb: null, sistema: {} },
      false,
    );
    const alvo =
      doc.fluxos.find(
        (f) => f.id === slug(String(input.fluxoId ?? '')).slice(0, 30),
      ) ?? doc.fluxos[0];
    if (!alvo) throw new BadRequestException('Fluxo não encontrado.');
    const problemas = checkFlow(alvo, this.tools, doc.fluxos);
    if (problemas.length) throw new BadRequestException(problemas);
    const published = {
      fluxos: doc.fluxos.map((f) => ({ ...f, ativo: true })),
      sistema: { ...DEFAULT_SYSTEM },
    };
    const efeitos: string[] = [];
    let r =
      input.estado && input.estado.flowId === alvo.id
        ? stepFlow(
            published,
            input.estado,
            this.parsePreview(published, input.estado, input.texto ?? ''),
            { maxInvalid: 3 },
          )
        : startFlow(published, alvo.id, {});
    // ferramentas rodam em modo simulado até a próxima etapa de espera
    for (let guard = 0; guard < 20 && r.state; guard++) {
      const eff = r.effects.find((e) => e.type === 'ferramenta');
      if (!eff || eff.type !== 'ferramenta') break;
      const tool = this.tools.get(eff.ferramenta);
      efeitos.push(tool ? tool.label : eff.ferramenta);
      const result = tool
        ? tool.simular({
            conv: {
              contactId: 0,
              ticketId: 0,
              nome: r.state.vars['nome'] ?? null,
              numero: null,
              driveFolderId: null,
              crmLeadId: null,
            },
            state: r.state,
            params: eff.params,
            flowNome: alvo.nome,
            rotulos: {},
          })
        : { ok: false as const, motivo: 'desconhecida' };
      const next = resumeTool(published, r.state, result);
      r = {
        ...next,
        replies: [...r.replies, ...next.replies],
        effects: next.effects,
        nome: next.nome ?? r.nome,
      };
    }
    for (const e of r.effects)
      if (e.type === 'handoff') efeitos.push('Encaminhar a um atendente');

    const originais = r.replies.map((x) => x.texto);
    let mensagens = originais;
    let aviso: string | null = null;
    const conversa = [...(input.conversa ?? [])];
    if (input.texto?.trim())
      conversa.push({
        role: 'cliente',
        text: input.texto.trim().slice(0, 600),
      });
    if (input.usarIA && r.replies.length) {
      if (!this.humanizer.enabled) {
        aviso = !this.appConfig.chatbot.humanize
          ? 'A opção "Mensagens com voz natural" está desligada em Ajustes > Comunicação: nenhuma mensagem é reescrita, nem no atendimento real.'
          : 'A IA está desligada, sem chave da OpenAI ou pausada por falhas: o teste mostra os textos exatos das etapas.';
      } else {
        // Fluxo que está falando agora (pode ser outro, depois de um "ir para").
        const falando =
          doc.fluxos.find((f) => f.id === (r.flowId ?? alvo.id)) ?? alvo;
        mensagens = await emTeste(() =>
          this.humanizer.compose(
            {
              contactId: -1,
              nome: r.nome ?? r.state?.vars['nome'] ?? null,
              history: conversa,
              pendente: r.state ? promptOf(published, r.state) : null,
              dados: r.state?.vars ?? {},
            },
            r.replies,
            falando.id,
            falando,
          ),
        );
      }
    }
    conversa.push({ role: 'bot', text: mensagens.join(' ').slice(0, 600) });
    return {
      estado: r.state,
      mensagens,
      reescrita: mensagens.join('\n') !== originais.join('\n'),
      aviso,
      conversa: conversa.slice(-16),
      efeitos,
      saiu: r.saiu,
    };
  }

  private parsePreview(
    published: { fluxos: FlowDoc[]; sistema: SystemMessages },
    state: FlowState,
    texto: string,
  ) {
    return (
      parseText(published, state, texto, false) ?? {
        kind: 'valor' as const,
        valor: texto,
      }
    );
  }

  /**
   * Conteúdo para testar: o que veio da tela (mesmo sem salvar) ou o rascunho salvo, já normalizado
   * como na publicação. Devolve também o que ainda impediria de publicar.
   */
  async conteudoParaTeste(raw?: unknown): Promise<{
    conteudo: ConteudoEmUso;
    problemas: string[];
  }> {
    let entrada: unknown = raw;
    if (!entrada) {
      const draft = await this.read(K_DRAFT);
      if (!draft) throw new BadRequestException('Não há rascunho para testar.');
      entrada = draft.doc;
    }
    const doc = this.validate(entrada, false);
    const kb = (doc.kb ?? DEFAULT_KB).map((e) => ({
      ...e,
      keywords: [...e.keywords],
    }));
    return {
      problemas: this.problemsOf(doc),
      conteudo: {
        kb,
        guidance: {
          tone: doc.guidance.tone as ToneKey,
          instructions: doc.guidance.instructions,
        },
        published: {
          fluxos: JSON.parse(JSON.stringify(doc.fluxos)) as FlowDoc[],
          sistema: { ...DEFAULT_SYSTEM, ...doc.sistema },
        },
      },
    };
  }

  // ───────────────────────── aplicação em memória ─────────────────────────

  apply(doc: ContentDoc): void {
    const json = JSON.stringify(doc);
    if (json === this.appliedJson) return;
    this.appliedJson = json;

    const kb = (doc.kb ?? DEFAULT_KB).map((e) => ({
      ...e,
      keywords: [...e.keywords],
    }));
    KNOWLEDGE_BASE.splice(0, KNOWLEDGE_BASE.length, ...kb);
    setExtraAllowedNumbers([
      ...kb.map((e) => e.text),
      ...doc.fluxos.flatMap((f) => (f.kb ?? []).map((e) => e.text)),
    ]);

    runtimeContent.guidance = {
      tone: doc.guidance.tone as ToneKey,
      instructions: doc.guidance.instructions,
    };
    runtimeContent.published = {
      fluxos: JSON.parse(JSON.stringify(doc.fluxos)) as FlowDoc[],
      sistema: { ...DEFAULT_SYSTEM, ...doc.sistema },
    };
  }

  // ───────────────────────── armazenamento ─────────────────────────

  private async read(key: string): Promise<Stored | null> {
    const all = await this.settings.getAllDecrypted();
    const row = all.find((s) => s.category === CATEGORY && s.key === key);
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.value) as Stored;
      if (!parsed?.doc) return null;
      if (isLegacyDoc(parsed.doc)) {
        // conteúdo gravado pela versão anterior da tela: converte na leitura (e ao publicar, grava já convertido)
        return { ...parsed, doc: convertLegacyDoc(parsed.doc) };
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private async write(key: string, stored: Stored): Promise<void> {
    await this.settings.upsert(
      key,
      JSON.stringify(stored),
      CATEGORY,
      'Conteúdo do chatbot (fluxos, mensagens do sistema, base, jeito de falar)',
    );
  }
}
