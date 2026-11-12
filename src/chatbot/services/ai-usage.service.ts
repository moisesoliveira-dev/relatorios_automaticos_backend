import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DataSource } from 'typeorm';
import { SettingsService } from '../../settings/settings.service';
import {
  COTACAO_PADRAO,
  custoUsd,
  Preco,
  precoDoModelo,
  PRECOS_PADRAO,
} from '../domain/ai-pricing';

export type OrigemUso = 'cliente' | 'teste';

const origem = new AsyncLocalStorage<OrigemUso>();

/** Tudo que a OpenAI gastar dentro de `fn` conta como teste (simulador e prévia), não como cliente. */
export const emTeste = <T>(fn: () => Promise<T>): Promise<T> =>
  origem.run('teste', fn);

const K_PRECOS = 'CHATBOT_AI_PRECOS';
const K_COTACAO = 'CHATBOT_AI_COTACAO';
const CATEGORY = 'chatbot_usage';

/** Dia no fuso de Manaus (UTC-4), como o resto do chatbot. */
export const diaManaus = (t = Date.now()): string =>
  new Date(t - 4 * 3600_000).toISOString().slice(0, 10);

interface Linha {
  dia: string;
  agente: string;
  modelo: string;
  chamadas: number;
  falhas: number;
  entrada: number;
  cache: number;
  saida: number;
  ms: number;
}

const num = (v: unknown) => Number(v ?? 0) || 0;

const soma = () => ({
  usd: 0,
  chamadas: 0,
  falhas: 0,
  entrada: 0,
  cache: 0,
  saida: 0,
  ms: 0,
});
type Soma = ReturnType<typeof soma>;

@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);
  private tabela: {
    em: number;
    precos: Record<string, Preco>;
    cotacao: number;
  } | null = null;

  constructor(
    private readonly db: DataSource,
    private readonly settings: SettingsService,
  ) {}

  /** Registra uma chamada. Nunca lança: medir gasto não pode derrubar o atendimento. */
  registrar(c: {
    agente: string;
    modelo: string;
    entrada: number;
    cache: number;
    saida: number;
    ms: number;
    ok: boolean;
  }): void {
    const o = origem.getStore() ?? 'cliente';
    this.db
      .query(
        `INSERT INTO chatbot_ai_usage_daily
           (dia, agente, modelo, origem, chamadas, falhas, tokens_entrada, tokens_cache, tokens_saida, latencia_ms)
         VALUES ($1,$2,$3,$4,1,$5,$6,$7,$8,$9)
         ON CONFLICT (dia, agente, modelo, origem) DO UPDATE SET
           chamadas = chatbot_ai_usage_daily.chamadas + 1,
           falhas = chatbot_ai_usage_daily.falhas + $5,
           tokens_entrada = chatbot_ai_usage_daily.tokens_entrada + $6,
           tokens_cache = chatbot_ai_usage_daily.tokens_cache + $7,
           tokens_saida = chatbot_ai_usage_daily.tokens_saida + $8,
           latencia_ms = chatbot_ai_usage_daily.latencia_ms + $9`,
        [
          diaManaus(),
          c.agente.slice(0, 40),
          c.modelo.slice(0, 80),
          o,
          c.ok ? 0 : 1,
          Math.max(0, Math.round(c.entrada)),
          Math.max(0, Math.round(c.cache)),
          Math.max(0, Math.round(c.saida)),
          Math.max(0, Math.round(c.ms)),
        ],
      )
      .catch((e: Error) =>
        this.logger.warn(`Não consegui registrar o uso da IA: ${e.message}`),
      );
  }

  // ───────────────────────── preços e cotação ─────────────────────────

  private async carregarTabela() {
    if (this.tabela && Date.now() - this.tabela.em < 30_000) return this.tabela;
    let extras: Record<string, Preco> = {};
    let cotacao = COTACAO_PADRAO;
    try {
      const raw = await this.settings.findByKey(K_PRECOS);
      if (raw) extras = this.limparPrecos(JSON.parse(raw));
      const c = Number(await this.settings.findByKey(K_COTACAO));
      if (c > 0 && c < 100) cotacao = c;
    } catch {
      // preço salvo ilegível: volta ao padrão
    }
    this.tabela = {
      em: Date.now(),
      precos: { ...PRECOS_PADRAO, ...extras },
      cotacao,
    };
    return this.tabela;
  }

  private limparPrecos(raw: unknown): Record<string, Preco> {
    const out: Record<string, Preco> = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [modelo, v] of Object.entries(raw as Record<string, Preco>)) {
      const nome = modelo.trim().toLowerCase().slice(0, 80);
      const entrada = Number(v?.entrada);
      const saida = Number(v?.saida);
      if (!nome || !(entrada >= 0) || !(saida >= 0)) continue;
      const cache = Number(v?.cache);
      out[nome] = { entrada, saida, cache: cache >= 0 ? cache : entrada };
    }
    return out;
  }

  /** Salva os preços (por modelo) e a cotação. Só o que difere do padrão é guardado. */
  async salvarPrecos(input: {
    cotacao?: number;
    precos?: Record<string, Preco>;
  }): Promise<void> {
    if (input.cotacao !== undefined) {
      const c = Number(input.cotacao);
      if (!(c > 0 && c < 100))
        throw new BadRequestException('Cotação do dólar inválida.');
      await this.settings.upsert(K_COTACAO, String(c), CATEGORY);
    }
    if (input.precos) {
      const limpos = this.limparPrecos(input.precos);
      const extras: Record<string, Preco> = {};
      for (const [m, p] of Object.entries(limpos)) {
        const d = PRECOS_PADRAO[m];
        if (
          !d ||
          d.entrada !== p.entrada ||
          d.cache !== p.cache ||
          d.saida !== p.saida
        )
          extras[m] = p;
      }
      await this.settings.upsert(K_PRECOS, JSON.stringify(extras), CATEGORY);
    }
    this.tabela = null;
  }

  // ───────────────────────── consulta ─────────────────────────

  async resumo(dias: number, filtro: OrigemUso | 'todas' = 'cliente') {
    const n = Math.min(Math.max(Math.round(dias) || 30, 1), 365);
    const inicio = diaManaus(Date.now() - (n - 1) * 86400_000);
    const { precos, cotacao } = await this.carregarTabela();

    const rows: Array<Record<string, unknown>> = await this.db.query(
      `SELECT to_char(dia,'YYYY-MM-DD') AS dia, agente, modelo, chamadas, falhas,
              tokens_entrada, tokens_cache, tokens_saida, latencia_ms
         FROM chatbot_ai_usage_daily
        WHERE dia >= $1::date AND ($2 = 'todas' OR origem = $2)
        ORDER BY dia`,
      [inicio, filtro],
    );
    const linhas: Linha[] = rows.map((r) => ({
      dia: String(r.dia),
      agente: String(r.agente),
      modelo: String(r.modelo),
      chamadas: num(r.chamadas),
      falhas: num(r.falhas),
      entrada: num(r.tokens_entrada),
      cache: num(r.tokens_cache),
      saida: num(r.tokens_saida),
      ms: num(r.latencia_ms),
    }));

    const semPreco = new Set<string>();
    const custoDe = (l: Linha): number => {
      const p = precoDoModelo(l.modelo, precos);
      if (!p) {
        semPreco.add(l.modelo);
        return 0;
      }
      return custoUsd(l, p.preco);
    };
    const add = (s: Soma, l: Linha, c: number) => {
      s.usd += c;
      s.chamadas += l.chamadas;
      s.falhas += l.falhas;
      s.entrada += l.entrada;
      s.cache += l.cache;
      s.saida += l.saida;
      s.ms += l.ms;
    };

    const total = soma();
    const porDia = new Map<string, Soma>();
    const porAgente = new Map<string, Soma>();
    const porModelo = new Map<string, Soma>();
    for (const l of linhas) {
      const c = custoDe(l);
      add(total, l, c);
      for (const [mapa, chave] of [
        [porDia, l.dia],
        [porAgente, l.agente],
        [porModelo, l.modelo],
      ] as const) {
        if (!mapa.has(chave)) mapa.set(chave, soma());
        add(mapa.get(chave)!, l, c);
      }
    }

    // todos os dias do período, inclusive os sem uso
    const dias_: Array<{
      dia: string;
      usd: number;
      brl: number;
      chamadas: number;
    }> = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = diaManaus(Date.now() - i * 86400_000);
      const s = porDia.get(d);
      dias_.push({
        dia: d,
        usd: s?.usd ?? 0,
        brl: (s?.usd ?? 0) * cotacao,
        chamadas: s?.chamadas ?? 0,
      });
    }

    const conv: Array<{ n: string }> = await this.db.query(
      `SELECT count(*)::text AS n FROM chatbot_conversations WHERE created_at >= $1::date`,
      [inicio],
    );
    const conversas = num(conv[0]?.n);

    const fmt = (s: Soma) => ({
      usd: s.usd,
      brl: s.usd * cotacao,
      chamadas: s.chamadas,
      falhas: s.falhas,
      tokensEntrada: s.entrada,
      tokensCache: s.cache,
      tokensSaida: s.saida,
      latenciaMediaMs: s.chamadas ? Math.round(s.ms / s.chamadas) : 0,
    });
    const porAgenteLista = [...porAgente.entries()]
      .map(([agente, s]) => ({ agente, ...fmt(s) }))
      .sort((a, b) => b.usd - a.usd || b.chamadas - a.chamadas);
    const porModeloLista = [...porModelo.entries()]
      .map(([modelo, s]) => ({
        modelo,
        precificado: !!precoDoModelo(modelo, precos),
        ...fmt(s),
      }))
      .sort((a, b) => b.usd - a.usd || b.chamadas - a.chamadas);

    // Projeção do mês corrente: média dos dias já vividos × dias do mês.
    const hoje = diaManaus();
    const mes = hoje.slice(0, 7);
    const gastoMes = dias_
      .filter((d) => d.dia.startsWith(mes))
      .reduce((a, d) => a + d.usd, 0);
    const diaDoMes = Number(hoje.slice(8, 10));
    const diasNoMes = new Date(
      Number(hoje.slice(0, 4)),
      Number(hoje.slice(5, 7)),
      0,
    ).getDate();
    const previsaoUsd = diaDoMes ? (gastoMes / diaDoMes) * diasNoMes : 0;

    return {
      periodo: { dias: n, inicio, fim: hoje },
      origem: filtro,
      cotacao,
      totais: fmt(total),
      conversas,
      custoPorConversaUsd: conversas ? total.usd / conversas : 0,
      custoPorConversaBrl: conversas ? (total.usd / conversas) * cotacao : 0,
      mes: {
        gastoUsd: gastoMes,
        gastoBrl: gastoMes * cotacao,
        previsaoUsd,
        previsaoBrl: previsaoUsd * cotacao,
      },
      porDia: dias_,
      porAgente: porAgenteLista,
      porModelo: porModeloLista,
      semPreco: [...semPreco],
      precos: Object.entries(precos)
        .map(([modelo, p]) => {
          const d = PRECOS_PADRAO[modelo];
          return {
            modelo,
            ...p,
            padrao:
              !!d &&
              d.entrada === p.entrada &&
              d.cache === p.cache &&
              d.saida === p.saida,
          };
        })
        .sort((a, b) => a.modelo.localeCompare(b.modelo)),
    };
  }
}
