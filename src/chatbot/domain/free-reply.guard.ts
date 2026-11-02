/**
 * Filtro de segurança para respostas livres geradas pela IA ("dúvidas" do cliente).
 * A IA só pode repetir fatos da base de conhecimento; qualquer coisa com valor, prazo, link
 * ou número desconhecido é descartada e o cliente cai no fluxo normal (ou em um humano).
 */
export const KNOWLEDGE_BASE = {
  empresa: 'Cinthia Moreira Modulados — móveis planejados',
  loja: 'Av. Djalma Batista, 1334 — CM Modulados, Loja Djalma (Manaus)',
  telefone: '(92) 99455-1471',
  pagamento:
    'É possível adquirir o ambiente planejado com ou sem entrada e iniciar o pagamento em até 60 dias (boleto bancário).',
  medicao:
    'As medições são agendadas pela equipe em horários de 2 horas, de segunda a sexta.',
} as const;

const ALLOWED_NUMBER_TOKENS = new Set(['1334', '99455', '1471', '60', '92']);

const FORBIDDEN_PATTERNS: RegExp[] = [
  /r\$\s*\d/i,
  /\d+\s?%/,
  /\b(pre[çc]o|or[çc]amento de|desconto|promo[çc][ãa]o|gr[áa]tis|garantia de \d)/i,
  /\b(prazo de entrega|entregamos em|ficar[áa] pronto em)\b/i,
  /https?:\/\//i,
  /www\./i,
  /@[a-z0-9]/i,
];

export function sanitizeFreeReply(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  let text = raw
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length < 3 || text.length > 400) return null;

  if (FORBIDDEN_PATTERNS.some((re) => re.test(text))) return null;

  const numbers = text.match(/\d{3,}/g) ?? [];
  if (numbers.some((n) => !ALLOWED_NUMBER_TOKENS.has(n))) return null;

  // Nunca deixa a resposta "instruir" o cliente a digitar comandos do fluxo por conta própria.
  text = text
    .replace(/\n?(digite|envie|responda)\s+(0|10|ok)\b.*$/i, '')
    .trim();
  return text.length >= 3 ? text : null;
}
