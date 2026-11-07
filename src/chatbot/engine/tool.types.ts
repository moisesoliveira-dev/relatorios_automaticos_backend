import type { FlowState } from './flow.types';

/**
 * Ferramentas: o que um fluxo pode mandar o sistema FAZER (criar pasta no Drive, consultar a agenda,
 * guardar um valor...). Cada ferramenta é um arquivo em `tools/` que se descreve (nome, parâmetros,
 * pré-requisitos) e sabe se executar. Adicionar uma ferramenta nova = criar o arquivo e registrá-lo
 * no `ToolRegistry`; o motor, a validação, o simulador e a tela se adaptam sozinhos.
 */

export type ParamType =
  | 'texto'
  | 'numero'
  | 'booleano'
  | 'variavel'
  | 'escolha';

export interface ParamSpec {
  key: string;
  label: string;
  type: ParamType;
  /** Explica o parâmetro na tela. */
  ajuda?: string;
  obrigatorio?: boolean;
  /** type = escolha */
  opcoes?: Array<{ value: string; label: string }>;
  /** Valor sugerido ao inserir a etapa. */
  padrao?: string | number | boolean;
  /** Aceita {variaveis} no valor (texto). */
  template?: boolean;
  /** type = variavel: a ferramenta CRIA esta variável (vale para as etapas seguintes). */
  define?: boolean;
}

/** O que a ferramenta precisa que já tenha acontecido antes dela, em todos os caminhos. */
export interface ToolRequires {
  /** Variáveis que precisam estar respondidas. */
  vars?: string[];
  /** Precisa da pasta do cliente no Drive criada antes. */
  pasta?: boolean;
}

/** O que a ferramenta deixa pronto para as etapas seguintes. */
export interface ToolProduces {
  pasta?: boolean;
  /** Variáveis que passa a existir (além da `variavel` escolhida na etapa, se houver). */
  vars?: string[];
}

export interface ToolContext {
  conv: {
    contactId: number;
    ticketId: number;
    nome: string | null;
    numero: string | null;
    driveFolderId: string | null;
    /** Lead no funil comercial (CMSYS), quando já foi criado nesta conversa. */
    crmLeadId: string | null;
  };
  state: FlowState;
  /** Parâmetros já com {variaveis} preenchidas. */
  params: Record<string, string | number | boolean | null>;
  flowNome: string;
  /** Nome legível de cada variável do fluxo (título da etapa que a perguntou). */
  rotulos: Record<string, string>;
}

export type ToolResult =
  | {
      ok: true;
      /** Valor guardado na `variavel` da etapa (quando houver). */
      valor?: string;
      /** Variáveis extras a gravar. */
      vars?: Record<string, string>;
      /** Mudanças na conversa (ex.: pasta criada, lead criado). */
      conv?: {
        driveFolderId?: string | null;
        crmLeadId?: string | null;
      };
      /** Ferramentas de escolha: lista para o cliente escolher. Vazia = caminho "semOpcoes". */
      opcoes?: Array<{ rotulo: string; valor: string }>;
      /** Textos a enviar ao cliente antes de seguir. */
      replies?: string[];
    }
  | { ok: false; motivo: string; replies?: string[] };

export interface ToolDefinition {
  key: string;
  label: string;
  descricao: string;
  grupo: 'Drive' | 'Funil comercial' | 'Conversa' | 'Atendimento' | 'Outros';
  /** acao = faz algo e segue; escolha = devolve opções e a etapa espera a escolha do cliente. */
  modo: 'acao' | 'escolha';
  params: ParamSpec[];
  requer?: ToolRequires;
  produz?: ToolProduces;
  /** Ferramentas de escolha: texto padrão da pergunta (o dono do fluxo pode trocar no parâmetro `texto`). */
  disponivel(): boolean;
  /** Por que não está disponível (configuração faltando). */
  indisponivelPorque?(): string;
  executar(ctx: ToolContext): Promise<ToolResult>;
  /** Resultado fictício para o simulador e a prévia (sem efeitos externos). */
  simular(ctx: ToolContext): ToolResult;
}

/** Descrição da ferramenta para a tela (sem funções). */
export interface ToolInfo {
  key: string;
  label: string;
  descricao: string;
  grupo: ToolDefinition['grupo'];
  modo: ToolDefinition['modo'];
  params: ParamSpec[];
  requer: ToolRequires;
  produz: ToolProduces;
  disponivel: boolean;
  motivo?: string;
}

export function describeTool(t: ToolDefinition): ToolInfo {
  const disponivel = t.disponivel();
  return {
    key: t.key,
    label: t.label,
    descricao: t.descricao,
    grupo: t.grupo,
    modo: t.modo,
    params: t.params,
    requer: t.requer ?? {},
    produz: t.produz ?? {},
    disponivel,
    motivo:
      !disponivel && t.indisponivelPorque ? t.indisponivelPorque() : undefined,
  };
}

/** Mapa de ferramentas disponível para o motor e a validação (sem depender do NestJS). */
export interface ToolCatalog {
  get(key: string): ToolDefinition | undefined;
  list(): ToolDefinition[];
}
