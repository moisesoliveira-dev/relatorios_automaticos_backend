import { MessageSpec } from './message-specs';

const strip = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export interface WriterOutput {
  abertura: string;
  fechamento: string | null;
}

export interface WriterCheck {
  spec: MessageSpec;
  /** Texto original (referência) e bloco fixo: definem o que é permitido citar. */
  reference: string;
  block: string;
  nome?: string | null;
  /** Últimas mensagens que o bot enviou (evita repetir). */
  recentBot: string[];
}

export type WriterVerdict =
  | { ok: true; abertura: string; fechamento: string | null }
  | { ok: false; motivo: string };

const EMOJI_RE = /\p{Extended_Pictographic}/gu;

/**
 * Revisor determinístico da comunicação. Nada que a IA escreve chega ao cliente sem passar aqui:
 * todos os pontos essenciais presentes, nada de números/valores/links inventados, bloco fixo não copiado.
 */
export function validateWriterOutput(
  raw: WriterOutput | null,
  c: WriterCheck,
): WriterVerdict {
  if (!raw || typeof raw.abertura !== 'string')
    return { ok: false, motivo: 'saida_invalida' };
  const abertura = raw.abertura.replace(/\r/g, '').trim();
  const fechamento =
    typeof raw.fechamento === 'string' && raw.fechamento.trim()
      ? raw.fechamento.replace(/\r/g, '').trim()
      : null;
  if (abertura.length < 3) return { ok: false, motivo: 'vazio' };

  const written = [abertura, fechamento].filter(Boolean).join('\n\n');
  const max = c.spec.maxChars ?? 400;
  if (written.length > max * 1.25) return { ok: false, motivo: 'muito_longo' };
  if (!c.block && fechamento)
    return { ok: false, motivo: 'fechamento_sem_bloco' };

  // Conteúdo proibido (preço, desconto, link, e-mail...) — reaproveita o filtro das respostas livres
  if (/r\$\s*\d|\d+\s?%|https?:\/\/|www\.|@[a-z0-9]/i.test(written))
    return { ok: false, motivo: 'conteudo_proibido' };
  if (/<\/?[a-z][^>]*>|```|^#{1,6}\s/m.test(written))
    return { ok: false, motivo: 'formatacao_invalida' };

  // Números: só os que já existem no original/bloco (opções, 0, 10, 60...)
  const allowed = new Set(
    (`${c.reference} ${c.block}`.match(/\d+/g) ?? []).map(String),
  );
  for (const n of written.match(/\d+/g) ?? [])
    if (!allowed.has(n)) return { ok: false, motivo: 'numero_inventado' };

  // Não pode copiar as opções (o código anexa o bloco)
  if (c.block && /^\s*\*?\d{1,2}\*?\s*[-–]\s*\S/m.test(written))
    return { ok: false, motivo: 'copiou_opcoes' };

  // Pontos essenciais
  const haystack = strip(`${written}\n${c.block}`);
  const wordHay = ` ${haystack.replace(/[^a-z0-9]+/g, ' ')} `;
  for (const point of c.spec.pontos) {
    const found = point.anyOf.some((k) => {
      const key = strip(k);
      return key.length <= 3
        ? wordHay.includes(` ${key.replace(/[^a-z0-9 ]+/g, ' ').trim()} `)
        : haystack.includes(key);
    });
    if (!found) return { ok: false, motivo: `ponto_ausente:${point.anyOf[0]}` };
  }

  if (
    c.spec.nomeObrigatorio &&
    c.nome &&
    !strip(written).includes(strip(c.nome))
  )
    return { ok: false, motivo: 'nome_ausente' };

  // Sem exagero de emojis
  if ((written.match(EMOJI_RE) ?? []).length > 3)
    return { ok: false, motivo: 'emojis_demais' };

  // Variedade: não repetir exatamente uma mensagem recente
  const norm = (s: string) => strip(s).replace(/\s+/g, ' ').trim();
  if (c.recentBot.some((m) => norm(m) === norm(written)))
    return { ok: false, motivo: 'repetida' };

  // O bot nunca fala de preço, desconto, garantia ou prazo de entrega — quem informa é o atendente
  if (
    /\b(pre[çc]o|pre[çc]os|desconto|promo[çc][ãa]o|gr[áa]tis|garantia|prazo de entrega|entregamos em)\b/i.test(
      written,
    )
  ) {
    return { ok: false, motivo: 'promessa_comercial' };
  }

  return { ok: true, abertura, fechamento };
}

/** Bloco só com comandos de navegação ("0 - Voltar", "10 - Recomeçar"): vai junto do texto, não numa bolha solta. */
const isCommandOnly = (block: string) =>
  block
    .split('\n')
    .filter((l) => l.trim())
    .every((l) => /^\s*(0|10)\s*[-–]/.test(l));

/** Monta as bolhas do WhatsApp: texto da IA primeiro, depois o bloco fixo (com o fechamento, se houver). */
export function assembleBubbles(
  out: { abertura: string; fechamento: string | null },
  block: string,
): string[] {
  if (!block)
    return [[out.abertura, out.fechamento].filter(Boolean).join('\n\n')];
  if (isCommandOnly(block))
    return [[out.abertura, block, out.fechamento].filter(Boolean).join('\n\n')];
  return [out.abertura, [block, out.fechamento].filter(Boolean).join('\n\n')];
}
