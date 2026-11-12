/**
 * Preços de referência da OpenAI, em dólares por 1 milhão de tokens. São valores de partida: a tela
 * de Gastos permite corrigir qualquer um (o que for salvo vale no lugar destes) e acrescentar modelos.
 * Confira sempre na página de preços da OpenAI.
 */
export interface Preco {
  /** Tokens de entrada. */
  entrada: number;
  /** Tokens de entrada já em cache (mais baratos). */
  cache: number;
  saida: number;
}

export const PRECOS_PADRAO: Record<string, Preco> = {
  'gpt-4o-mini': { entrada: 0.15, cache: 0.075, saida: 0.6 },
  'gpt-4o': { entrada: 2.5, cache: 1.25, saida: 10 },
  'gpt-4.1-nano': { entrada: 0.1, cache: 0.025, saida: 0.4 },
  'gpt-4.1-mini': { entrada: 0.4, cache: 0.1, saida: 1.6 },
  'gpt-4.1': { entrada: 2, cache: 0.5, saida: 8 },
  'gpt-5-nano': { entrada: 0.05, cache: 0.005, saida: 0.4 },
  'gpt-5-mini': { entrada: 0.25, cache: 0.025, saida: 2 },
  'gpt-5': { entrada: 1.25, cache: 0.125, saida: 10 },
  'o4-mini': { entrada: 1.1, cache: 0.275, saida: 4.4 },
  o3: { entrada: 2, cache: 0.5, saida: 8 },
};

/** Cotação de partida do dólar em reais; editável na tela. */
export const COTACAO_PADRAO = 5.5;

/**
 * Preço de um modelo: o nome exato, ou o maior prefixo conhecido ("gpt-4o-mini-2024-07-18" usa
 * "gpt-4o-mini"). Sem correspondência devolve null (a tela mostra "sem preço").
 */
export function precoDoModelo(
  modelo: string,
  tabela: Record<string, Preco>,
): { chave: string; preco: Preco } | null {
  const m = modelo.trim().toLowerCase();
  let melhor: string | null = null;
  for (const k of Object.keys(tabela)) {
    const kk = k.toLowerCase();
    if (m === kk || m.startsWith(kk + '-') || m.startsWith(kk + ':')) {
      if (!melhor || kk.length > melhor.length) melhor = k;
    }
  }
  return melhor ? { chave: melhor, preco: tabela[melhor] } : null;
}

export interface Tokens {
  entrada: number;
  cache: number;
  saida: number;
}

/** Custo em dólares. `entrada` inclui os tokens em cache (como a OpenAI informa). */
export function custoUsd(t: Tokens, p: Preco): number {
  const normais = Math.max(0, t.entrada - t.cache);
  return (normais * p.entrada + t.cache * p.cache + t.saida * p.saida) / 1e6;
}
