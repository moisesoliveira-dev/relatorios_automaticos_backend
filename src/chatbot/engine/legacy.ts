import {
  DEFAULT_CATEGORIAS,
  DEFAULT_MESSAGES,
  MessageKey,
} from '../domain/chatbot.messages';
import { ContentDoc, FlowDoc, FlowNode, SystemMessages } from './flow.types';
import {
  head,
  LEGACY_MESSAGE_MAP,
  LEGACY_SYSTEM_MAP,
  seedFlows,
} from './flow.seed';
import { slug } from './text';

/**
 * Converte o conteúdo publicado pela versão anterior da tela (mensagens editadas, ambientes
 * renomeados, opções do menu desativadas e fluxos próprios) para o modelo de fluxos.
 * Nada do que estava publicado se perde: cada texto alterado cai na etapa correspondente do seed.
 */

interface LegacyNode {
  id: string;
  tipo: string;
  titulo: string;
  texto?: string;
  proximo?: string | null;
  opcoes?: Array<{ rotulo: string; proximo: string | null }>;
  variavel?: string;
  validacao?: 'nome' | 'texto';
  minimo?: number;
  acao?: string;
  armazenar?: 'drive';
  pasta?: 'criar' | 'existente';
}

interface LegacyFlow {
  id: string;
  nome: string;
  descricao?: string;
  ativo: boolean;
  menuOpcao: number | null;
  nos: LegacyNode[];
  guidance?: { tone: string; instructions: string };
  reescrever?: boolean;
  kb?: Array<{ id: string; keywords: string[]; text: string }>;
}

export interface LegacyDoc {
  messages?: Record<string, string>;
  kb?: Array<{ id: string; keywords: string[]; text: string }> | null;
  categorias?: Record<string, string>;
  guidance?: { tone: string; instructions: string };
  menuDesativado?: number[];
  fluxos?: LegacyFlow[];
}

export const isLegacyDoc = (raw: unknown): raw is LegacyDoc =>
  !!raw && typeof raw === 'object' && (raw as { versao?: number }).versao !== 2;

const LEGACY_TOOL: Record<string, string> = {
  drive_criar_pasta: 'drive.criar_pasta',
  drive_salvar_respostas: 'drive.salvar_respostas',
};

export function convertLegacyFlow(f: LegacyFlow): FlowDoc {
  const nos: FlowNode[] = [];
  const redirect = new Map<string, string>(); // etapa de arquivos com Drive → ferramenta inserida antes
  for (const n of f.nos)
    if (n.tipo === 'arquivos' && n.armazenar === 'drive')
      redirect.set(n.id, `${n.id}_pasta`);
  const to = (id: string | null | undefined) =>
    id ? (redirect.get(id) ?? id) : null;
  for (const n of f.nos) {
    const base = { id: n.id, titulo: n.titulo };
    if (redirect.has(n.id))
      nos.push({
        id: redirect.get(n.id)!,
        tipo: 'ferramenta',
        titulo: 'Criar a pasta no Drive',
        ferramenta: 'drive.criar_pasta',
        params: { modo: n.pasta === 'existente' ? 'existente' : 'criar' },
        proximo: n.id,
        falha: n.id,
      });
    switch (n.tipo) {
      case 'mensagem':
        nos.push({
          ...base,
          tipo: 'mensagem',
          texto: n.texto ?? '',
          proximo: to(n.proximo),
        });
        break;
      case 'pergunta':
        nos.push({
          ...base,
          tipo: 'pergunta',
          texto: n.texto ?? '',
          variavel: n.variavel ?? '',
          validacao: n.validacao,
          proximo: to(n.proximo),
        });
        break;
      case 'opcoes':
        nos.push({
          ...base,
          tipo: 'opcoes',
          texto: n.texto ?? '',
          variavel: n.variavel,
          opcoes: (n.opcoes ?? []).map((o) => ({
            rotulo: o.rotulo,
            proximo: to(o.proximo),
          })),
        });
        break;
      case 'confirmacao': {
        const [a, b] = n.opcoes ?? [];
        nos.push({
          ...base,
          tipo: 'confirmacao',
          texto: n.texto ?? '',
          variavel: n.variavel,
          opcoes: [
            { rotulo: 'Sim', proximo: to(a?.proximo) },
            { rotulo: 'Não', proximo: to(b?.proximo) },
          ],
        });
        break;
      }
      case 'arquivos':
        nos.push({
          ...base,
          tipo: 'arquivos',
          texto: n.texto ?? '',
          minimo: n.minimo,
          proximo: to(n.proximo),
        });
        break;
      case 'acao':
        nos.push({
          ...base,
          tipo: 'ferramenta',
          ferramenta: LEGACY_TOOL[n.acao ?? ''] ?? n.acao ?? '',
          params: {},
          proximo: to(n.proximo),
          falha: to(n.proximo),
        });
        break;
      case 'encaminhar':
        nos.push({ ...base, tipo: 'encaminhar', texto: n.texto });
        break;
      case 'fim':
        nos.push({ ...base, tipo: 'fim', texto: n.texto });
        break;
    }
  }
  return {
    id: f.id,
    nome: f.nome,
    descricao: f.descricao,
    ativo: f.ativo,
    nos,
    guidance: f.guidance,
    reescrever: f.reescrever,
    kb: f.kb,
  };
}

/** Monta o documento v2 a partir do antigo. */
export function convertLegacyDoc(old: LegacyDoc): ContentDoc {
  const fluxos = seedFlows();
  const byId = (id: string) => fluxos.find((f) => f.id === id)!;

  // 1) textos editados caem nas etapas correspondentes
  for (const [key, value] of Object.entries(old.messages ?? {})) {
    if (!value || value === DEFAULT_MESSAGES[key as MessageKey]) continue;
    const targets = LEGACY_MESSAGE_MAP[key as MessageKey];
    if (!targets) continue;
    for (const t of targets) {
      const node:
        | (FlowNode & { texto?: string; textoApos?: string })
        | undefined = byId(t.flow)?.nos.find((n) => n.id === t.node);
      if (!node) continue;
      if (t.campo === 'textoApos')
        (node as { textoApos?: string }).textoApos = head(value);
      else node.texto = key === 'endereco_loja' ? value : head(value);
    }
  }

  // 2) ambientes renomeados
  for (const [n, nome] of Object.entries(old.categorias ?? {})) {
    const idx = Number(n) - 1;
    if (!(Number(n) in DEFAULT_CATEGORIAS) || !nome) continue;
    for (const fid of ['planta', 'sem_nada']) {
      const node = byId(fid).nos.find((x) => x.id === 'ambientes');
      if (node?.tipo === 'multipla' && node.itens[idx])
        node.itens[idx] = { rotulo: nome };
    }
  }

  // 3) opções 4/5 do menu desativadas
  const menu = byId('vera').nos.find((n) => n.id === 'menu');
  if (menu?.tipo === 'opcoes') {
    for (const n of old.menuDesativado ?? []) {
      const valor = n === 4 ? 'boleto' : n === 5 ? 'loja' : null;
      if (!valor) continue;
      menu.opcoes = menu.opcoes.filter((o) => o.valor !== valor);
      const vera = byId('vera');
      vera.nos = vera.nos.filter(
        (n) => n.tipo !== 'ir_para' || n.fluxo !== valor,
      );
      const alvo = byId(valor);
      if (alvo) alvo.ativo = false;
    }
  }

  // 4) fluxos próprios: viram fluxos do motor e entram no menu
  for (const f of old.fluxos ?? []) {
    const conv = convertLegacyFlow(f);
    let id = conv.id;
    while (fluxos.some((x) => x.id === id)) id = `${id}_x`;
    conv.id = id;
    fluxos.push(conv);
    if (f.ativo && f.menuOpcao && menu?.tipo === 'opcoes') {
      const irId = `ir_${slug(id)}`;
      byId('vera').nos.push({
        id: irId,
        tipo: 'ir_para',
        titulo: f.nome,
        fluxo: id,
      });
      menu.opcoes.push({ rotulo: f.nome, valor: slug(id), proximo: irId });
    }
  }

  // 5) mensagens do sistema editadas
  const sistema: Partial<SystemMessages> = {};
  for (const [key, value] of Object.entries(old.messages ?? {})) {
    const sk = LEGACY_SYSTEM_MAP[key as MessageKey];
    if (sk && value) sistema[sk] = value;
  }

  const g = old.guidance ?? { tone: 'padrao', instructions: '' };
  return {
    versao: 2,
    fluxos,
    guidance: { tone: g.tone, instructions: g.instructions ?? '' },
    kb: old.kb ?? null,
    sistema,
  };
}
