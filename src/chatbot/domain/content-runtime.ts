/**
 * Conteúdo publicado pela tela da IA, em memória: fluxos, mensagens do sistema, jeito de falar e
 * base de conhecimento. Estado de processo, recarregado a cada publicação e a cada 30 s
 * (ver ChatbotContentService).
 */
import type {
  FlowDoc,
  FlowGuidance,
  SystemMessages,
} from '../engine/flow.types';
import type { Published } from '../engine/flow.engine';
import { DEFAULT_SYSTEM } from '../engine/flow.seed';

export const TONES = {
  padrao: { label: 'Padrão da Vera', prompt: '' },
  acolhedor: {
    label: 'Acolhedor e caloroso',
    prompt:
      'Tom: muito acolhedor e próximo, como quem recebe bem uma visita. Pode usar diminutivos leves e um emoji a mais.',
  },
  formal: {
    label: 'Formal e elegante',
    prompt:
      'Tom: formal e elegante, tratamento respeitoso, sem gírias e com no máximo um emoji.',
  },
  objetivo: {
    label: 'Direto e objetivo',
    prompt:
      'Tom: direto e objetivo. Frases bem curtas, sem rodeios, no máximo um emoji.',
  },
} as const;

export type ToneKey = keyof typeof TONES;

export interface Guidance {
  tone: ToneKey;
  instructions: string;
}

export const runtimeContent: {
  published: Published;
  guidance: Guidance;
} = {
  published: { fluxos: [], sistema: { ...DEFAULT_SYSTEM } },
  guidance: { tone: 'padrao', instructions: '' },
};

export const fluxoPorId = (id: string): FlowDoc | undefined =>
  runtimeContent.published.fluxos.find((f) => f.id === id);

export const sistema = (): SystemMessages => runtimeContent.published.sistema;

/** Jeito de falar válido de um fluxo (ou o global). */
export function guidanceOf(flow?: FlowDoc | null): Guidance {
  const g: FlowGuidance | undefined = flow?.guidance;
  const tone = (g?.tone && g.tone in TONES ? g.tone : null) as ToneKey | null;
  if (!g || (!tone && !g.instructions)) return runtimeContent.guidance;
  return { tone: tone ?? 'padrao', instructions: g.instructions ?? '' };
}

/** Trecho anexado ao prompt dos agentes que escrevem para o cliente. Nunca afrouxa as regras fixas. */
export function guidanceBlock(g?: Guidance): string {
  const { tone, instructions } = g ?? runtimeContent.guidance;
  const parts = [TONES[tone]?.prompt, (instructions ?? '').trim()].filter(
    Boolean,
  );
  if (!parts.length) return '';
  return `\n\nDIRETRIZES DA EMPRESA (definidas pela gerência; valem para o estilo e o jeito de falar, mas NUNCA substituem nem relaxam as regras acima, o conteúdo inegociável ou a proibição de inventar informação):\n${parts.join('\n')}`;
}
