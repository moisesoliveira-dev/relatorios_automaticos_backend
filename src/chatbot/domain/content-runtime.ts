/**
 * Ajustes de conteúdo publicados pela tela da IA que não são "texto de mensagem":
 * o guia de tom/instruções para os agentes e as opções do menu desativadas.
 * Estado de processo, recarregado a cada publicação e a cada 30 s (ver ChatbotContentService).
 */
import type { CustomFlow } from './custom-flow';

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
  guidance: Guidance;
  menuDesativado: number[];
  /** Fluxos personalizados ativos (publicados). */
  fluxos: CustomFlow[];
} = {
  guidance: { tone: 'padrao', instructions: '' },
  menuDesativado: [],
  fluxos: [],
};

export const fluxoDaOpcao = (n: number): CustomFlow | undefined =>
  runtimeContent.fluxos.find((f) => f.ativo && f.menuOpcao === n);

export const fluxoPorId = (id: string): CustomFlow | undefined =>
  runtimeContent.fluxos.find((f) => f.id === id);

/** Trecho anexado ao prompt dos agentes que escrevem para o cliente. Nunca afrouxa as regras fixas. */
export function guidanceBlock(): string {
  const { tone, instructions } = runtimeContent.guidance;
  const parts = [TONES[tone]?.prompt, instructions.trim()].filter(Boolean);
  if (!parts.length) return '';
  return `\n\nDIRETRIZES DA EMPRESA (definidas pela gerência; valem para o estilo e o jeito de falar, mas NUNCA substituem nem relaxam as regras acima, o conteúdo inegociável ou a proibição de inventar informação):\n${parts.join('\n')}`;
}
