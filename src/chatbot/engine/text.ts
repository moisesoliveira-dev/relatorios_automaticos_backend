/**
 * Utilidades de texto do motor de fluxos: normalização do que o cliente escreve, validações de
 * resposta (nome, número, telefone, e-mail) e preenchimento de {variáveis} nos textos.
 * Tudo puro, sem NestJS.
 */

import { prefilter } from '../domain/scope.prefilter';

/** Remove formatação do WhatsApp (*negrito*, _itálico_) e espaços repetidos. */
export function normalizeText(raw: string | null | undefined): string {
  return (raw ?? '')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export const strip = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const slug = (s: string): string =>
  strip(s)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

export const OK_RE =
  /^(ok|okay|okk+|oks|t[áa] ok|blz|beleza|certo|feito|pronto|enviei|j[áa] enviei|finalizei|finalizado|👍)[.!]*$/i;

const NOT_A_NAME = new Set([
  'sim',
  'nao',
  'não',
  'oi',
  'ola',
  'olá',
  'ok',
  'bom dia',
  'boa tarde',
  'boa noite',
  'quero',
  'tenho',
  'preciso',
  'orcamento',
  'entendi',
  'prefiro',
  'dizer',
  'informar',
  'talvez',
  'depois',
  'quanto',
  'custa',
  'tempo',
  'pronto',
  'voces',
  'vocês',
  'demoram',
  'responder',
  'minuto',
  'obrigado',
  'obrigada',
  'onde',
  'como',
  'qual',
  'quando',
  'porque',
  'ajuda',
  'orçamento',
  'projeto',
  'planta',
  'casa',
  'apartamento',
  'voltar',
  'menu',
  'ajuda',
  'obrigado',
  'obrigada',
]);

const NAME_PREFIX_RE =
  /^(meu nome (é|e)|me chamo|eu me chamo|sou (o|a)?|aqui (é|e) (o|a)?|nome:?|pode me chamar de|é|e)\s+/i;

/**
 * Valida e limpa um nome informado pelo cliente. Devolve null quando não parece um nome
 * (frases, números, links, e-mails...). Isso também limita o que vai para a pasta do Drive e para o funil comercial.
 */
export function validarNome(raw: string | null | undefined): string | null {
  let text = normalizeText(raw);
  text = text
    .replace(NAME_PREFIX_RE, '')
    .replace(/[.!,]+$/g, '')
    .trim();
  if (text.length < 2 || text.length > 60) return null;
  if (NOT_A_NAME.has(text.toLowerCase())) return null;
  // Frase de manipulação não é nome (o nome vai para o Drive, o funil e as mensagens do bot)
  if (prefilter(text).blocked) return null;
  if (!/^[\p{L}][\p{L}\p{M}'’.\- ]*$/u.test(text)) return null;
  const words = text.split(' ').filter(Boolean);
  if (words.length > 6) return null;
  // Letras aleatórias ("asdkjh"): nenhum nome tem 5 consoantes seguidas ou palavra sem vogal.
  if (words.some((w) => /[bcdfghjklmnpqrstvwxz]{5}/i.test(strip(w))))
    return null;
  if (words.some((w) => w.length > 2 && !/[aeiouy]/i.test(strip(w))))
    return null;
  if (
    words.some(
      (w) =>
        NOT_A_NAME.has(w.toLowerCase()) && words.length > 1 && w.length > 3,
    )
  )
    return null;
  return words
    .map((w) => (w.length > 2 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export function validarNumero(raw: string): string | null {
  const t = normalizeText(raw).replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return t;
}

export function validarTelefone(raw: string): string | null {
  const digits = normalizeText(raw).replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 13) return null;
  return digits;
}

export function validarEmail(raw: string): string | null {
  const t = normalizeText(raw).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t) && t.length <= 120 ? t : null;
}

export type Validacao = 'texto' | 'nome' | 'numero' | 'telefone' | 'email';

/** Aplica a validação escolhida na etapa. null = não serve como resposta. */
export function validarResposta(
  validacao: Validacao | undefined,
  raw: string,
): string | null {
  switch (validacao) {
    case 'nome':
      return validarNome(raw);
    case 'numero':
      return validarNumero(raw);
    case 'telefone':
      return validarTelefone(raw);
    case 'email':
      return validarEmail(raw);
    default: {
      const t = normalizeText(raw);
      return t ? t.slice(0, 300) : null;
    }
  }
}

/** Extrai "2 1 3", "2,1,3", "2 e 1" etc. Devolve null se houver qualquer coisa que não seja número/separador. */
export function parseNumberList(text: string): number[] | null {
  const cleaned = text
    .replace(/\be\b/gi, ' ')
    .replace(/[,;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || !/^\d+( \d+)*$/.test(cleaned)) return null;
  return cleaned.split(' ').map((n) => parseInt(n, 10));
}

/** Preenche {variavel}; variável sem resposta vira texto vazio. */
export const render = (t: string, vars: Record<string, string>): string =>
  t.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');

/** Variáveis citadas num texto ({nome}, {bairro}...). */
export const placeholdersOf = (t: string): string[] => [
  ...new Set([...(t ?? '').matchAll(/\{(\w+)\}/g)].map((m) => m[1])),
];
