import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { AppConfigService } from '../../infrastructure/config/app-config.service';

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

  constructor(private readonly appConfig: AppConfigService) {}

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
    if (!this.enabled || this.breakerOpen || this.inflight >= this.maxInflight)
      return null;

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
            { role: 'system', content: call.system },
            { role: 'user', content: call.user },
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
      if (!args) return null;
      return JSON.parse(args) as T;
    } catch (error) {
      this.recordFailure();
      this.logger.warn(
        `agent=${call.agent} falhou (${(error as any)?.status ?? 'rede'}): ${(error as Error).message?.slice(0, 120)}`,
      );
      return null;
    } finally {
      this.inflight--;
    }
  }
}
