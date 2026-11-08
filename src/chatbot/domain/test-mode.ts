/**
 * Modo teste: o chatbot só atende os números da lista. O número pode chegar do webhook em qualquer
 * formato ("5592991234567", "+55 (92) 99123-4567", "5592991234567@c.us"...): tiramos tudo que não
 * é dígito e comparamos só os 8 últimos, que identificam a linha com ou sem 55, DDD e 9º dígito.
 */

/** Só texto e número viram string; o resto conta como vazio. */
function texto(raw: unknown): string {
  return typeof raw === 'string' || typeof raw === 'number' ? String(raw) : '';
}

/** Dígitos do que veio, sem pontuação, espaços, "@c.us" ou outros textos. */
export function onlyDigits(raw: unknown): string {
  return texto(raw).replace(/@.*$/, '').replace(/\D/g, '');
}

/** Chave de comparação: os 8 últimos dígitos. Null se tiver menos de 8. */
export function numberKey(raw: unknown): string | null {
  const d = onlyDigits(raw);
  return d.length >= 8 ? d.slice(-8) : null;
}

/** Forma guardada na lista: só os dígitos (mínimo 8). */
export function canonicalNumber(raw: unknown): string | null {
  const d = onlyDigits(raw);
  return d.length >= 8 && d.length <= 15 ? d : null;
}

/** Lista guardada ("5592991234567,92988887777") → números. */
export function parseNumberList(raw: unknown): string[] {
  return texto(raw)
    .split(/[\s,;]+/)
    .map((s) => canonicalNumber(s))
    .filter((n): n is string => !!n);
}

/** O número está na lista? Sem número conhecido, não está. */
export function isAllowedNumber(raw: unknown, allowed: string[]): boolean {
  const key = numberKey(raw);
  return !!key && allowed.some((n) => numberKey(n) === key);
}
