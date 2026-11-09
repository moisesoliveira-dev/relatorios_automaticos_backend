import type { Validacao } from './text';

/**
 * Modelo do fluxo de atendimento (versão 2). TUDO que o bot faz é um fluxo feito de etapas:
 * o atendimento da Vera é um fluxo como qualquer outro, montado na tela e publicado.
 *
 * Regras herdadas do chatbot antigo e mantidas pelo motor (não pelo fluxo):
 *  - 0 volta uma etapa, 10 recomeça, "OK" confirma listas/arquivos;
 *  - resposta inválida: 1ª avisa, as seguintes ficam em silêncio e, no limite, passa a um atendente;
 *  - pedido explícito de atendente encaminha; fora de escopo soma advertências;
 *  - arquivos recebidos vão para a pasta do cliente no Drive quando ela existe.
 */

export type NodeType =
  | 'mensagem'
  | 'pergunta'
  | 'opcoes'
  | 'confirmacao'
  | 'multipla'
  | 'arquivos'
  | 'ferramenta'
  | 'condicao'
  | 'ir_para'
  | 'encaminhar'
  | 'fim';

/** O que a mensagem precisa comunicar: o Redator (IA) pode mudar o jeito de dizer, nunca o conteúdo. */
/**
 * Como a IA trata o texto da etapa:
 *  - ajustar: reescreve o texto com voz natural (padrão);
 *  - obrigatorio: o texto vai exatamente como está, a IA só escreve em volta;
 *  - instrucao: a IA escreve a partir do objetivo; o texto só é usado se ela estiver fora do ar.
 */
export type ModoMensagem = 'ajustar' | 'obrigatorio' | 'instrucao';

export interface NodeSpec {
  modo?: ModoMensagem;
  objetivo?: string;
  /** Cada item é uma lista de palavras alternativas; ao menos uma precisa aparecer no texto final. */
  pontos?: string[][];
  /** Primeira mensagem da conversa: cumprimenta conforme a hora do dia. */
  saudacao?: boolean;
  usaNome?: boolean;
  maxChars?: number;
}

export interface NodeBase {
  id: string;
  tipo: NodeType;
  /** Nome interno, só para quem monta o fluxo. */
  titulo: string;
  spec?: NodeSpec;
}

export interface Opcao {
  rotulo: string;
  proximo: string | null;
  /** Valor guardado na variável (padrão: o rótulo). */
  valor?: string;
  /** Palavras/frases que também escolhem esta opção (sem IA). */
  palavras?: string[];
}

export interface MensagemNode extends NodeBase {
  tipo: 'mensagem';
  texto: string;
  proximo: string | null;
}

export interface PerguntaNode extends NodeBase {
  tipo: 'pergunta';
  texto: string;
  variavel: string;
  validacao?: Validacao;
  proximo: string | null;
}

export interface OpcoesNode extends NodeBase {
  tipo: 'opcoes';
  texto: string;
  variavel?: string;
  opcoes: Opcao[];
}

/** Sempre duas opções, Sim e Não. */
export interface ConfirmacaoNode extends NodeBase {
  tipo: 'confirmacao';
  texto: string;
  variavel?: string;
  opcoes: [Opcao, Opcao];
}

/** O cliente escolhe vários itens numa mensagem ("2 1 3"); termina com OK ou com a opção "nenhum". */
export interface MultiplaNode extends NodeBase {
  tipo: 'multipla';
  texto: string;
  variavel: string;
  itens: Array<{ rotulo: string }>;
  /** Texto da opção extra "nenhum destes" (ex.: "Nenhum destes ambientes"). Vazio = sem essa opção. */
  nenhum?: string;
  /** Mensagem enviada quando o cliente manda itens e ainda pode mandar mais (até o OK). */
  textoApos?: string;
  proximo: string | null;
}

export interface ArquivosNode extends NodeBase {
  tipo: 'arquivos';
  texto: string;
  /** Mensagem enviada a cada arquivo recebido. */
  textoApos?: string;
  minimo?: number;
  proximo: string | null;
}

/** Executa uma ferramenta do catálogo (Drive, agenda, variáveis...). */
export interface FerramentaNode extends NodeBase {
  tipo: 'ferramenta';
  ferramenta: string;
  params?: Record<string, string | number | boolean | null>;
  /** Onde guardar o resultado (ferramentas que devolvem um valor ou uma escolha). */
  variavel?: string;
  proximo: string | null;
  /** Para onde ir se a ferramenta falhar (padrão: segue para "proximo"). */
  falha?: string | null;
  /** Ferramentas de escolha: para onde ir quando não há opções (padrão: "falha" ou "proximo"). */
  semOpcoes?: string | null;
}

export type CondOp = 'igual' | 'diferente' | 'contem' | 'vazio' | 'nao_vazio';

export interface CondicaoNode extends NodeBase {
  tipo: 'condicao';
  regras: Array<{
    variavel: string;
    op: CondOp;
    valor?: string;
    proximo: string | null;
  }>;
  senao: string | null;
}

export interface IrParaNode extends NodeBase {
  tipo: 'ir_para';
  fluxo: string;
}

export interface EncaminharNode extends NodeBase {
  tipo: 'encaminhar';
  texto?: string;
  /** Devolver ao mesmo atendente que já atendeu este cliente (quando houver). */
  reutilizarAtendente?: boolean;
}

export interface FimNode extends NodeBase {
  tipo: 'fim';
  texto?: string;
}

export type FlowNode =
  | MensagemNode
  | PerguntaNode
  | OpcoesNode
  | ConfirmacaoNode
  | MultiplaNode
  | ArquivosNode
  | FerramentaNode
  | CondicaoNode
  | IrParaNode
  | EncaminharNode
  | FimNode;

export interface FlowGuidance {
  tone: string;
  instructions: string;
}

export interface FlowKbEntry {
  id: string;
  keywords: string[];
  text: string;
}

export type FlowPapel = 'entrada' | 'reconhecimento';

export interface FlowDoc {
  id: string;
  nome: string;
  descricao?: string;
  ativo: boolean;
  /** entrada = começa quando um cliente novo chega; reconhecimento = cliente que já foi atendido voltou. */
  papel?: FlowPapel | null;
  /** O fluxo começa no primeiro bloco. */
  nos: FlowNode[];
  guidance?: FlowGuidance;
  /** A IA reescreve os textos das etapas no tom deste fluxo (revisados antes de enviar). */
  reescrever?: boolean;
  /** O que a IA pode responder quando o cliente faz uma pergunta dentro deste fluxo. */
  kb?: FlowKbEntry[];
}

/** Mensagens que o MOTOR envia (não pertencem a nenhum fluxo). */
export type SystemMessageKey =
  | 'invalida_generica'
  | 'invalida_nome'
  | 'invalida_arquivos'
  | 'invalida_lista'
  | 'duvida_sem_resposta'
  | 'dado_corrigido'
  | 'retomar_conversa'
  | 'esclarecer_etapa'
  | 'fora_escopo'
  | 'fora_escopo_limite'
  | 'audio_nao_suportado'
  | 'reinicio_por_pausa'
  | 'redirecionando'
  | 'redirecionando_com_nome'
  | 'rodape_navegacao'
  | 'rodape_escolha'
  | 'rodape_ok';

export type SystemMessages = Record<SystemMessageKey, string>;

/** Tudo que a tela publica. */
export interface ContentDoc {
  versao: 2;
  fluxos: FlowDoc[];
  /** Jeito de falar global (fluxos sem o próprio usam este). */
  guidance: FlowGuidance;
  /** Base de conhecimento global. null = padrão do código. */
  kb: FlowKbEntry[] | null;
  /** Só as mensagens do sistema alteradas. */
  sistema: Partial<SystemMessages>;
}

// ───────────────────────── estado em tempo de execução ─────────────────────────

export interface FlowState {
  flowId: string;
  nodeId: string;
  /** Etapas de espera já visitadas (para o "0 - voltar"). */
  historico: string[];
  vars: Record<string, string>;
  arquivos: number;
  invalidos: number;
  /** Desvios seguidos nesta etapa (conversa, "não entendi", dúvida sem resposta). */
  desvios?: number;
  /** Opções geradas por uma ferramenta de escolha (ex.: horários livres). */
  dinamicas?: Array<{ rotulo: string; valor: string }> | null;
  /** Itens já escolhidos numa etapa "multipla" (índices 1..n). */
  escolhidos?: number[] | null;
}

/** Entrada já interpretada (por regra determinística ou pela IA). */
export type FlowInput =
  | { kind: 'voltar' }
  | { kind: 'recomecar' }
  | { kind: 'ok' }
  /** nomeCitado: o cliente disse o próprio nome na mesma mensagem. */
  | { kind: 'opcao'; index: number; nomeCitado?: string }
  | { kind: 'valor'; valor: string }
  | { kind: 'itens'; indices: number[] }
  | { kind: 'arquivo' }
  | { kind: 'humano' }
  | { kind: 'duvida'; resposta: string }
  | { kind: 'fora_escopo'; severidade: 'leve' | 'grave' }
  /** A IA não soube responder à dúvida: avisa que o projetista confirma e retoma a etapa. */
  /** O cliente corrigiu um dado que já tinha dado (ex.: o nome), estando em outra etapa. */
  | { kind: 'corrigir'; variavel: 'nome'; valor: string }
  | { kind: 'duvida_sem_resposta' }
  /** Cumprimento, comentário ou "não entendi": acolhe e reapresenta a etapa. */
  | { kind: 'reapresentar'; motivo: 'conversa' | 'esclarecer' }
  /** falhaIa = a IA não respondeu (rede, teto, disjuntor), não que a resposta seja ruim. */
  | { kind: 'invalido'; falhaIa?: boolean };

/** Texto a enviar, com o que o Redator precisa saber para reescrevê-lo com segurança. */
export interface Reply {
  texto: string;
  /** Etapa de origem (os textos do sistema não têm). */
  nodeId?: string;
  spec?: NodeSpec;
  /** Chave da mensagem do sistema, quando for uma. */
  sistema?: SystemMessageKey;
  /** A etapa está sendo repetida (depois de um desvio): sem cumprimentar nem se apresentar de novo. */
  retomada?: boolean;
  /** A etapa em partes, para a atendente falar sem o menu numerado e sem o rodapé. */
  forma?: FormaDaEtapa;
  /** Aviso depois de receber um arquivo ou item: a atendente pode dizer com as palavras dela. */
  aviso?: 'arquivo' | 'itens';
  /** Texto da etapa como está no fluxo, antes de trocar as {variaveis}. */
  textoOriginal?: string;
}

export interface FormaDaEtapa {
  tipo: NodeType;
  corpo: string;
  opcoes: string[];
}

export type Effect =
  | {
      type: 'ferramenta';
      nodeId: string;
      ferramenta: string;
      params: Record<string, string | number | boolean | null>;
    }
  | {
      type: 'handoff';
      comNome: boolean;
      texto?: string;
      reutilizar?: boolean;
      /** A mensagem de encaminhamento já foi enviada pelo fluxo (texto próprio). */
      jaAvisou?: boolean;
      /** Respostas coletadas até aqui (resumo para o funil comercial). */
      vars?: Record<string, string>;
    };

export interface FlowResult {
  /** null = o cliente saiu do fluxo (veja `saiu`). */
  state: FlowState | null;
  replies: Reply[];
  effects: Effect[];
  /** Nome informado pelo cliente (grava no cadastro da conversa). */
  nome?: string;
  saiu: 'menu' | 'encaminhado' | null;
  /** O texto não serviu como resposta (e ainda não chegou ao limite): candidato a ser tratado como dúvida. */
  invalido?: boolean;
  /** Fluxo de onde vêm os textos (define o jeito de falar na hora de enviar). */
  flowId: string;
}

export const WAITING: NodeType[] = [
  'opcoes',
  'confirmacao',
  'pergunta',
  'multipla',
  'arquivos',
];

export const isWaiting = (n: FlowNode | undefined): boolean =>
  !!n && WAITING.includes(n.tipo);

export const LIMITS = {
  fluxos: 20,
  nos: 60,
  opcoes: 9,
  itens: 12,
  texto: 1600,
  rotulo: 80,
  variavel: /^[a-z][a-z0-9_]{0,29}$/,
  kb: 50,
} as const;
