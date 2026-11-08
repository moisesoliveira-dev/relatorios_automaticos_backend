/**
 * Primeira barreira, SEM IA: barata, instantânea e imune a "convencer" o modelo.
 * Pega os ataques mais comuns de manipulação de prompt (PT/EN) e conteúdo claramente fora do contexto.
 */
export type PrefilterResult =
  | { blocked: false }
  | { blocked: true; severidade: 'leve' | 'grave'; motivo: string };

const strip = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const INJECTION: RegExp[] = [
  /\b(ignore|ignora|ignorar|esqueca|esquece|desconsidere|desconsidera)\b.{0,40}\b(instruc|regra|prompt|anterior|acima|tudo)/,
  /\b(ignore|disregard|forget)\b.{0,40}\b(instruction|rule|prompt|previous|above|everything)/,
  /\b(system prompt|prompt do sistema|prompt inicial|suas instrucoes|your instructions|seu prompt)\b/,
  /\b(jailbreak|modo desenvolvedor|developer mode|sem restric)/,
  /\b(voce agora e|a partir de agora voce|finja (ser|que)|aja como|haja como|atue como|act as|pretend (to be|you))\b/,
  /\b(revele|mostre|repita|exiba|diga)\b.{0,30}\b(instruc|prompt|regras internas|configurac)/,
  /<\/?(system|assistant|mensagem_cliente|tool|function)[^>]*>/,
  /\b(repeat|repita)\b.{0,30}\b(above|acima)\b/,
  /\b(dados|lista|telefones?|cpfs?)\b.{0,25}\b(d[oa]s? )?(ultimo |outros? )?clientes?\b/,
  /\b(liste|listar)\b.{0,20}\bclientes\b/,
  /\bcontato pessoal\b/,
  /\b(role|papel)\s*[:=]\s*(system|assistant)/,
];

const OFF_TOPIC_HARD: RegExp[] = [
  /```/,
  /\b(escreva|crie|gere|faca)\b.{0,30}\b(codigo|script|programa|poema|poesia|redacao|musica|historia|piada|receita)\b/,
  /\b(write|generate)\b.{0,30}\b(code|script|poem|essay|joke|recipe)\b/,
  /\b(piada|receita de|horoscopo|previsao do tempo|quem ganhou|resultado do jogo|bitcoin|criptomoeda)\b/,
];

export function prefilter(message: string): PrefilterResult {
  const text = strip(message);
  if (INJECTION.some((re) => re.test(text)))
    return {
      blocked: true,
      severidade: 'grave',
      motivo: 'tentativa_de_manipulacao',
    };
  if (OFF_TOPIC_HARD.some((re) => re.test(text)))
    return { blocked: true, severidade: 'leve', motivo: 'fora_do_escopo' };
  return { blocked: false };
}
