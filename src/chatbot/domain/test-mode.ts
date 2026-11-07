/**
 * Modo teste: o chatbot só atende os números da lista. Os números são do Brasil; comparamos por
 * DDD + os 8 últimos dígitos, então "92 99123-4567", "5592991234567" e "+55 92 9123-4567" são o mesmo.
 */

/** Dígitos do número sem o 55 do país (quando vier). Null se não parecer um telefone brasileiro (DDD + 8 ou 9 dígitos). */
export function nationalDigits(raw: unknown): string | null {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  return d.length === 10 || d.length === 11 ? d : null;
}

/** Chave de comparação: DDD + 8 últimos dígitos (ignora o 9º dígito). */
export function numberKey(raw: unknown): string | null {
  const d = nationalDigits(raw);
  return d ? d.slice(0, 2) + d.slice(-8) : null;
}

/** Forma guardada: 55 + DDD + número. */
export function canonicalNumber(raw: unknown): string | null {
  const d = nationalDigits(raw);
  return d ? `55${d}` : null;
}

/** Lista guardada ("5592991234567,5592988887777") → números. */
export function parseNumberList(raw: unknown): string[] {
  return String(raw ?? '')
    .split(/[\s,;]+/)
    .map((s) => canonicalNumber(s))
    .filter((n): n is string => !!n);
}

/** O número está na lista? Sem número conhecido, não está. */
export function isAllowedNumber(raw: unknown, allowed: string[]): boolean {
  const key = numberKey(raw);
  return !!key && allowed.some((n) => numberKey(n) === key);
}
