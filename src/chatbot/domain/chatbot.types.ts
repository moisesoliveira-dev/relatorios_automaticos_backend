import type { CustomState } from './custom-flow';

export type Trilha = 'projeto' | 'planta' | 'semNada' | 'boleto' | 'loja';

export type Step =
  | 'MENU'
  | 'NOME'
  | 'CONFIRMA_NOME'
  | 'ENVIO_ARQUIVOS'
  | 'CATEGORIAS'
  | 'CASA_AP'
  | 'PLANTA_ACHOU'
  | 'AGENDAR'
  | 'HORARIO'
  | 'VISITA'
  | 'RECONHECIMENTO'
  | 'CUSTOM'
  | 'HUMANO';

export interface SlotOption {
  /** Início em UTC (ISO). */
  startUtc: string;
  endUtc: string;
  /** Texto exibido ao cliente, ex.: "04/07/2025 07:00 - 09:00" (horário de Manaus). */
  label: string;
}

/** Parte do estado da conversa que o motor de regras lê e altera. */
export interface FlowState {
  step: Step;
  trilha: Trilha | null;
  nome: string | null;
  nomePendente: string | null;
  local: 'casa' | 'ap' | null;
  categorias: number[];
  arquivos: number;
  invalidCount: number;
  slots: SlotOption[] | null;
  /** Reincidências de fora de escopo. Fica fora do INITIAL: recomeçar a conversa não zera as advertências. */
  offTopicCount?: number;
  /** Fluxo personalizado em andamento (step === 'CUSTOM'). */
  custom?: CustomState | null;
}

export const INITIAL_FLOW_STATE: FlowState = {
  step: 'MENU',
  trilha: null,
  nome: null,
  nomePendente: null,
  local: null,
  categorias: [],
  arquivos: 0,
  invalidCount: 0,
  slots: null,
  custom: null,
};

/** Entrada já interpretada (por regra determinística ou pela IA). */
export type FlowInput =
  | { kind: 'back' }
  | { kind: 'restart' }
  | { kind: 'ok' }
  | { kind: 'option'; value: number }
  | { kind: 'nome'; nome: string }
  | { kind: 'categorias'; ids: number[] }
  | { kind: 'file' }
  | { kind: 'humano' }
  | { kind: 'duvida'; resposta: string }
  | { kind: 'fora_escopo'; severidade: 'leve' | 'grave' }
  | { kind: 'invalid' };

export type HandoffMessage =
  'redirecionando' | 'redirecionando_com_nome' | 'agendado';

/** Ações com efeito externo que o serviço executa depois de aplicar o novo estado. */
export type Effect =
  | { type: 'criar_pasta' }
  | { type: 'salvar_preferencias' }
  | { type: 'oferecer_horarios' }
  | { type: 'agendar'; slotIndex: number }
  | {
      type: 'salvar_respostas';
      titulo: string;
      itens: Array<{ rotulo: string; valor: string }>;
    }
  | {
      type: 'handoff';
      mensagem: HandoffMessage;
      reutilizarAtendente?: boolean;
      /** Texto próprio de um fluxo personalizado, no lugar da mensagem padrão de encaminhamento. */
      texto?: string;
      flowId?: string;
    };

export interface Decision {
  patch: Partial<FlowState>;
  /** Textos fixos a enviar, na ordem. */
  replies: string[];
  effects: Effect[];
  /** Fluxo personalizado de onde vêm os textos (define o jeito de falar na hora de enviar). */
  flowId?: string;
}
