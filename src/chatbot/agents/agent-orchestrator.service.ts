import { Injectable, Logger } from '@nestjs/common';
import { FlowInput } from '../engine/flow.types';
import { KbEntry, retrieveKb } from '../domain/knowledge-base';
import { Guidance } from '../domain/content-runtime';
import { prefilter } from '../domain/scope.prefilter';
import { OpenAiService } from '../services/openai.service';
import { AgentContext } from './agent.types';
import { FaqAgent } from './faq.agent';
import { InterpreterAgent } from './interpreter.agent';
import { ScopeAgent } from './scope.agent';
import { VerifierAgent } from './verifier.agent';

export type Decision =
  | 'prefilter_bloqueou'
  | 'ia_indisponivel'
  | 'fora_escopo'
  | 'fluxo'
  | 'duvida_respondida'
  | 'duvida_sem_base'
  | 'duvida_reprovada'
  | 'escopo_indisponivel'
  | 'sem_interpretacao';

const RESPONDE_ETAPA = new Set<FlowInput['kind']>([
  'opcao',
  'valor',
  'itens',
  'ok',
  'voltar',
  'recomecar',
  'humano',
  'corrigir',
]);

/**
 * Orquestrador determinístico dos agentes. Quem decide a ordem, o que é aceito e o que acontece
 * em caso de falha é CÓDIGO, não o modelo. Cada agente tem uma função, um schema estrito e sua
 * saída é validada antes de ser usada. Qualquer falha/dúvida resolve para o caminho mais seguro.
 *
 *  1. pré-filtro por regras (sem IA)
 *  2. Agente de Escopo ‖ Agente Intérprete (em paralelo: a latência é de uma chamada)
 *  3. fora de escopo → recusa; dúvida → Agente de FAQ (só com a base) → Agente Verificador
 *  4. o resultado vira um FlowInput para o motor de fluxos (única fonte de verdade)
 */
@Injectable()
export class AgentOrchestrator {
  private readonly logger = new Logger(AgentOrchestrator.name);
  readonly counters: Record<Decision, number> = {
    prefilter_bloqueou: 0,
    ia_indisponivel: 0,
    fora_escopo: 0,
    fluxo: 0,
    duvida_respondida: 0,
    duvida_sem_base: 0,
    duvida_reprovada: 0,
    escopo_indisponivel: 0,
    sem_interpretacao: 0,
  };

  constructor(
    private readonly openai: OpenAiService,
    private readonly scope: ScopeAgent,
    private readonly interpreter: InterpreterAgent,
    private readonly faq: FaqAgent,
    private readonly verifier: VerifierAgent,
  ) {}

  get available(): boolean {
    return this.openai.enabled && !this.openai.breakerOpen;
  }

  private done(decision: Decision, input: FlowInput): FlowInput {
    this.counters[decision]++;
    this.logger.log(`decisao=${decision} -> ${input.kind}`);
    return input;
  }

  /** Base de conhecimento do fluxo (quando tem) ou a global. */
  async resolve(
    ctx: AgentContext,
    kb?: KbEntry[],
    guidance?: Guidance,
  ): Promise<FlowInput> {
    // 1) Regras fixas: pega manipulação óbvia sem gastar IA e sem dar chance ao modelo de ser convencido.
    const pre = prefilter(ctx.message);
    if (pre.blocked)
      return this.done('prefilter_bloqueou', {
        kind: 'fora_escopo',
        severidade: pre.severidade,
      });

    if (!this.available)
      return this.done('ia_indisponivel', { kind: 'invalido', falhaIa: true });

    // 2) Escopo e interpretação em paralelo
    const [scope, interpretation] = await Promise.all([
      this.scope.run(ctx),
      this.interpreter.run(ctx),
    ]);

    if (scope && scope.categoria !== 'dentro') {
      const grave =
        scope.categoria === 'manipulacao' || scope.categoria === 'ofensivo';
      // Se a mensagem responde à etapa, ela vale: um nome ou "não achei a planta" não é "fora do assunto".
      // "fora" com baixa confiança em mensagem curta/ambígua também não é recusado (evita falso positivo).
      const respondeEtapa =
        interpretation?.kind === 'flow' &&
        RESPONDE_ETAPA.has(interpretation.input.kind);
      if (grave || (!respondeEtapa && scope.confianca !== 'baixa'))
        return this.done('fora_escopo', {
          kind: 'fora_escopo',
          severidade: grave ? 'grave' : 'leve',
        });
    }

    if (!interpretation)
      return this.done('sem_interpretacao', {
        kind: 'invalido',
        falhaIa: true,
      });
    if (interpretation.kind === 'flow')
      return this.done('fluxo', interpretation.input);

    // 3) Dúvida: só responde com escopo confirmado + base de conhecimento + verificação independente
    if (!scope)
      return this.done('escopo_indisponivel', { kind: 'duvida_sem_resposta' });

    const hits = kb ? retrieveKb(ctx.message, 3, kb) : retrieveKb(ctx.message);
    const answer = await this.faq.run(ctx.message, hits, guidance);
    if (!answer)
      return this.done('duvida_sem_base', { kind: 'duvida_sem_resposta' });

    const sources = hits.filter((k) => answer.fontes.includes(k.id));
    const approved = await this.verifier.run(
      ctx.message,
      answer.resposta,
      sources,
    );
    if (!approved)
      return this.done('duvida_reprovada', { kind: 'duvida_sem_resposta' });

    return this.done('duvida_respondida', {
      kind: 'duvida',
      resposta: answer.resposta,
    });
  }
}
