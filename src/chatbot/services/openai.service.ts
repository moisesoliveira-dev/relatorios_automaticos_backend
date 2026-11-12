import { Injectable, Logger, Optional } from '@nestjs/common';
import OpenAI from 'openai';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
import { AiUsageService } from './ai-usage.service';

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema (modo strict: todas as propriedades em `required`, additionalProperties=false). */
  parameters: Record<string, unknown>;
}

export interface AgentCall {
  /** Nome do agente (métricas e override de modelo via OPENAI_MODEL_<NOME>). */
  agent: string;
  system: string;
  user: string;
  tool: ToolSpec;
  maxTokens?: number;
  /** Teto de tempo desta chamada (sobrepõe o padrão do cliente). */
  timeoutMs?: number;
}

/**
 * Tira meio-emoji (surrogate sem par), que surge ao cortar um texto no meio de um emoji: a API
 * recusa o JSON inteiro por causa dele.
 */
export const textoValido = (s: string): string =>
  s.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    '',
  );

/**
 * Cliente fino da OpenAI usado por todos os agentes: timeout, limite de concorrência,
 * disjuntor (circuit breaker) e saída SEMPRE estruturada via chamada de função forçada.
 * Nunca registra o texto do cliente nos logs.
 */
@Injectable()
export class OpenAiService {
  private readonly logger = new Logger(OpenAiService.name);
  private client?: OpenAI;
  private clientKey?: string;
  private inflight = 0;
  private readonly maxInflight = 8;
  private failures: number[] = [];
  private openUntil = 0;

  constructor(
    private readonly appConfig: AppConfigService,
    @Optional() private readonly usage?: AiUsageService,
  ) {}

  get enabled(): boolean {
    return this.appConfig.chatbot.aiEnabled && !!this.appConfig.openai.apiKey;
  }

  get breakerOpen(): boolean {
    return Date.now() < this.openUntil;
  }

  private getClient(): OpenAI {
    const { apiKey, timeoutMs } = this.appConfig.openai;
    // A chave pode ser trocada pela tela da IA: recria o cliente quando ela muda.
    if (
      !this.client ||
      (this.clientKey !== undefined && this.clientKey !== apiKey)
    ) {
      this.client = new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 1 });
      this.clientKey = apiKey;
    }
    return this.client;
  }

  /** Para testes: injeta um cliente falso. */
  setClientForTests(client: OpenAI): void {
    this.client = client;
    this.clientKey = undefined; // cliente falso: nunca recriar
  }

  private recordFailure(): void {
    const now = Date.now();
    this.failures = [...this.failures.filter((t) => now - t < 60_000), now];
    if (this.failures.length >= 3) {
      this.openUntil = now + 60_000;
      this.logger.warn(
        'OpenAI com falhas seguidas — IA pausada por 60s (o bot segue com regras fixas)',
      );
    }
  }

  private modelFor(agent: string): string {
    return this.appConfig.modelFor(agent);
  }

  /** Executa um agente e devolve os argumentos brutos da função (ainda NÃO confiáveis), ou null. */
  async callTool<T = unknown>(call: AgentCall): Promise<T | null> {
    if (!this.enabled || this.breakerOpen) return null;
    // Pico de clientes: espera uma vaga em vez de responder "opção inválida" a quem falou algo válido.
    const limite = Date.now() + 4000;
    while (this.inflight >= this.maxInflight) {
      if (Date.now() > limite) return null;
      await new Promise((r) => setTimeout(r, 50));
    }

    const { temperature } = this.appConfig.openai;
    const model = this.modelFor(call.agent);
    this.inflight++;
    const started = Date.now();
    try {
      const completion = await this.getClient().chat.completions.create(
        {
          model,
          ...(temperature !== undefined ? { temperature } : {}),
          max_completion_tokens: call.maxTokens ?? 250,
          messages: [
            { role: 'system', content: textoValido(call.system) },
            { role: 'user', content: textoValido(call.user) },
          ],
          tools: [
            {
              type: 'function',
              function: {
                name: call.tool.name,
                description: call.tool.description,
                strict: true,
                parameters: call.tool.parameters,
              },
            },
          ],
          tool_choice: { type: 'function', function: { name: call.tool.name } },
        },
        call.timeoutMs ? { timeout: call.timeoutMs, maxRetries: 0 } : undefined,
      );

      const toolCall = completion.choices?.[0]?.message?.tool_calls?.find(
        (c) => c.type === 'function',
      );
      const args =
        toolCall && toolCall.type === 'function'
          ? toolCall.function.arguments
          : null;
      this.logger.log(
        `agent=${call.agent} model=${model} ${Date.now() - started}ms tokens=${completion.usage?.total_tokens ?? '?'}`,
      );
      this.usage?.registrar({
        agente: call.agent,
        modelo: completion.model || model,
        entrada: completion.usage?.prompt_tokens ?? 0,
        cache: completion.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        saida: completion.usage?.completion_tokens ?? 0,
        ms: Date.now() - started,
        ok: !!args,
      });
      if (!args) return null;
      return JSON.parse(args) as T;
    } catch (error) {
      // Pedido recusado por ele mesmo (400/404/422) não é a OpenAI fora do ar: não pausa a IA de todos.
      const status = (error as { status?: number })?.status;
      if (!status || status >= 500 || [401, 403, 408, 429].includes(status))
        this.recordFailure();
      this.usage?.registrar({
        agente: call.agent,
        modelo: model,
        entrada: 0,
        cache: 0,
        saida: 0,
        ms: Date.now() - started,
        ok: false,
      });
      this.logger.warn(
        `agent=${call.agent} falhou (${status ?? 'rede'}): ${(error as Error).message?.slice(0, 120)}`,
      );
      return null;
    } finally {
      this.inflight--;
    }
  }
}
