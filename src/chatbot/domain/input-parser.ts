import { CATEGORIAS_AMBIENTE } from './chatbot.messages';
import { FlowInput, FlowState } from './chatbot.types';
import { validOptions } from './chatbot.flow';

/** Remove formatação do WhatsApp (*negrito*, _itálico_), emojis de borda e espaços repetidos. */
export function normalizeText(raw: string | null | undefined): string {
  return (raw ?? '')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const OK_RE =
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
 * (frases, números, links, e-mails...). Isso também limita o que vai para pasta do Drive e para o Pontta.
 */
export function validarNome(raw: string | null | undefined): string | null {
  let text = normalizeText(raw);
  text = text
    .replace(NAME_PREFIX_RE, '')
    .replace(/[.!,]+$/g, '')
    .trim();
  if (text.length < 2 || text.length > 60) return null;
  if (NOT_A_NAME.has(text.toLowerCase())) return null;
  if (!/^[\p{L}][\p{L}\p{M}'’.\- ]*$/u.test(text)) return null;
  const words = text.split(' ').filter(Boolean);
  if (words.length > 6) return null;
  if (
    words.some(
      (w) =>
        NOT_A_NAME.has(w.toLowerCase()) && words.length > 1 && w.length > 3,
    )
  )
    return null;
  return words
    .map((w) => (w.length > 3 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
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

/**
 * Interpretação sem IA. Devolve `null` quando a mensagem é texto livre e precisa de outro intérprete.
 * `hasFile` indica que o lote de mensagens continha arquivo (mídia).
 */
export function parseInput(
  state: FlowState,
  rawText: string | null | undefined,
  hasFile: boolean,
): FlowInput | null {
  const text = normalizeText(rawText);

  if (hasFile && !text) return { kind: 'file' };
  if (!text) return { kind: 'invalid' };

  if (text === '10') return { kind: 'restart' };
  if (text === '0') return { kind: 'back' };
  if (
    OK_RE.test(text) &&
    (state.step === 'ENVIO_ARQUIVOS' || state.step === 'CATEGORIAS')
  )
    return { kind: 'ok' };

  const single = /^(\d{1,2})[.)]?$/.exec(text);

  switch (state.step) {
    case 'NOME': {
      const nome = validarNome(text);
      return nome ? { kind: 'nome', nome } : null;
    }
    case 'CATEGORIAS': {
      const list = parseNumberList(text);
      if (!list) return null;
      if (list.length === 1 && list[0] === 9)
        return { kind: 'option', value: 9 };
      const ids = Array.from(new Set(list)).filter(
        (n) => CATEGORIAS_AMBIENTE[n],
      );
      return ids.length ? { kind: 'categorias', ids } : { kind: 'invalid' };
    }
    case 'ENVIO_ARQUIVOS':
      return hasFile ? { kind: 'file' } : null;
    default: {
      if (single) {
        const value = parseInt(single[1], 10);
        return validOptions(state).includes(value)
          ? { kind: 'option', value }
          : { kind: 'invalid' };
      }
      return null;
    }
  }
}
