import { CATEGORIAS_AMBIENTE, MESSAGES } from './chatbot.messages';
import { runtimeContent } from './content-runtime';
import {
  Decision,
  Effect,
  FlowInput,
  FlowState,
  INITIAL_FLOW_STATE,
  Step,
} from './chatbot.types';

/**
 * Motor de regras do chatbot. Função PURA: recebe o estado e uma entrada já interpretada
 * e devolve o novo estado, os textos fixos a enviar e os efeitos externos a executar.
 * A IA nunca decide transições — ela só traduz o que o cliente escreveu para um FlowInput.
 */

/** Opções numéricas válidas em cada passo (usadas pelo parser e para validar a saída da IA). */
export function validOptions(state: FlowState): number[] {
  switch (state.step) {
    case 'MENU':
      return [
        ...[1, 2, 3, 4, 5].filter(
          (n) => !runtimeContent.menuDesativado.includes(n),
        ),
        ...runtimeContent.fluxos
          .filter((f) => f.ativo && f.menuOpcao)
          .map((f) => f.menuOpcao as number),
      ];
    case 'CONFIRMA_NOME':
    case 'CASA_AP':
    case 'PLANTA_ACHOU':
    case 'AGENDAR':
    case 'VISITA':
    case 'RECONHECIMENTO':
      return [1, 2];
    case 'CATEGORIAS':
      return [9];
    case 'HORARIO': {
      const n = Math.min(state.slots?.length ?? 0, 8);
      return [...Array.from({ length: n }, (_, i) => i + 1), 9];
    }
    default:
      return [];
  }
}

/** Textos fixos que (re)apresentam um passo ao cliente. */
export function promptFor(state: FlowState): string[] {
  switch (state.step) {
    case 'MENU':
      return [MESSAGES.menu_inicial];
    case 'NOME':
      return [MESSAGES.pedir_nome];
    case 'CONFIRMA_NOME':
      return [
        fill(MESSAGES.confirmar_nome, { nome: state.nomePendente ?? '' }),
      ];
    case 'ENVIO_ARQUIVOS':
      return [MESSAGES.pedir_projeto];
    case 'CATEGORIAS':
      return [MESSAGES.ambientes_categorias];
    case 'CASA_AP':
      return [MESSAGES.casa_ou_ap];
    case 'PLANTA_ACHOU':
      return [MESSAGES.planta_instrucoes, MESSAGES.planta_achou_ou_nao];
    case 'AGENDAR':
      return [MESSAGES.agendar_medicao_pergunta];
    case 'VISITA':
      return [
        state.trilha === 'loja'
          ? MESSAGES.pergunta_visita_loja
          : MESSAGES.pergunta_visita_boleto,
      ];
    case 'RECONHECIMENTO':
      return [MESSAGES.reconhecimento];
    case 'HORARIO': // dinâmico: exige consultar a agenda (efeito oferecer_horarios)
    case 'HUMANO':
    default:
      return [];
  }
}

export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');
}

/** Passo para onde o `0` ("voltar uma etapa") leva. */
export function previousStep(state: FlowState): Step | null {
  switch (state.step) {
    case 'NOME':
    case 'VISITA':
      return 'MENU';
    case 'CONFIRMA_NOME':
    case 'ENVIO_ARQUIVOS':
    case 'CASA_AP':
      return 'NOME';
    case 'CATEGORIAS':
      return state.trilha === 'planta' ? 'ENVIO_ARQUIVOS' : 'PLANTA_ACHOU';
    case 'PLANTA_ACHOU':
      return 'CASA_AP';
    case 'AGENDAR':
      return state.local === 'casa' ? 'CASA_AP' : 'PLANTA_ACHOU';
    case 'HORARIO':
      return 'AGENDAR';
    default:
      return null; // MENU, RECONHECIMENTO, HUMANO: nada para voltar
  }
}

function invalidMessage(step: Step): string {
  switch (step) {
    case 'NOME':
      return MESSAGES.invalida_nome;
    case 'ENVIO_ARQUIVOS':
      return MESSAGES.invalida_arquivos;
    case 'CATEGORIAS':
      return MESSAGES.invalida_ambientes;
    case 'HORARIO':
      return MESSAGES.invalida_horario;
    default:
      return MESSAGES.invalida_generica;
  }
}

const stay = (
  patch: Partial<FlowState> = {},
  replies: string[] = [],
  effects: Effect[] = [],
): Decision => ({
  patch,
  replies,
  effects,
});

export function restartDecision(): Decision {
  return {
    patch: { ...INITIAL_FLOW_STATE, categorias: [] },
    replies: [MESSAGES.menu_inicial],
    effects: [],
  };
}

export interface DecideOptions {
  maxInvalid: number;
  /** false = sem agenda (Pontta desligado): quem quer agendar a medição é passado a um atendente humano. */
  scheduling: boolean;
  /** Quantas advertências de fora de escopo até o bot parar de responder a esse tipo de mensagem. */
  maxOffTopic?: number;
}

export function decide(
  state: FlowState,
  input: FlowInput,
  opts: DecideOptions,
): Decision {
  if (state.step === 'HUMANO') return stay();

  switch (input.kind) {
    case 'restart':
      return restartDecision();

    case 'back': {
      const prev = previousStep(state);
      if (!prev) return decideInvalid(state, opts);
      const next: FlowState = { ...state, step: prev };
      if (prev === 'MENU')
        return {
          patch: { ...INITIAL_FLOW_STATE, categorias: [] },
          replies: [MESSAGES.menu_inicial],
          effects: [],
        };
      return {
        patch: { step: prev, invalidCount: 0 },
        replies: promptFor(next),
        effects: [],
      };
    }

    case 'humano':
      return stay(
        {},
        [],
        [
          {
            type: 'handoff',
            mensagem: state.nome ? 'redirecionando_com_nome' : 'redirecionando',
          },
        ],
      );

    case 'duvida':
      // Responde e retoma o passo atual sem contar como erro.
      if (state.step === 'HORARIO') {
        return stay({}, [input.resposta], [{ type: 'oferecer_horarios' }]);
      }
      return stay({}, [input.resposta, ...promptFor(state)]);

    case 'fora_escopo': {
      const max = opts.maxOffTopic ?? 3;
      const strikes =
        (state.offTopicCount ?? 0) + (input.severidade === 'grave' ? 2 : 1);
      // Já passou do limite: não gasta resposta nem entra em conversa paralela.
      if ((state.offTopicCount ?? 0) >= max)
        return stay({ offTopicCount: strikes });
      if (strikes >= max)
        return stay({ offTopicCount: strikes }, [MESSAGES.fora_escopo_limite]);
      const reprompt = state.step === 'HORARIO' ? [] : promptFor(state);
      const effects: Effect[] =
        state.step === 'HORARIO' ? [{ type: 'oferecer_horarios' }] : [];
      return stay(
        { offTopicCount: strikes },
        [MESSAGES.fora_escopo, ...reprompt],
        effects,
      );
    }

    case 'invalid':
      return decideInvalid(state, opts);

    default:
      break;
  }

  const result = decideForStep(state, input, opts);
  return result ?? decideInvalid(state, opts);
}

/** Primeira mensagem inválida avisa; as seguintes ficam em silêncio; ao atingir o limite, passa para humano. */
function decideInvalid(state: FlowState, opts: DecideOptions): Decision {
  const count = state.invalidCount + 1;
  if (count >= opts.maxInvalid) {
    return stay(
      { invalidCount: count },
      [],
      [
        {
          type: 'handoff',
          mensagem: state.nome ? 'redirecionando_com_nome' : 'redirecionando',
        },
      ],
    );
  }
  return stay(
    { invalidCount: count },
    count === 1 ? [invalidMessage(state.step)] : [],
  );
}

const handoff = (
  mensagem: 'redirecionando' | 'redirecionando_com_nome' | 'agendado',
  extra: Partial<Effect> = {},
): Effect => ({ type: 'handoff', mensagem, ...extra }) as Effect;

function decideForStep(
  state: FlowState,
  input: FlowInput,
  opts: DecideOptions,
): Decision | null {
  const reset = { invalidCount: 0 };

  switch (state.step) {
    case 'MENU': {
      if (input.kind !== 'option') return input.kind === 'file' ? stay() : null;
      if (runtimeContent.menuDesativado.includes(input.value)) return null;
      switch (input.value) {
        case 1:
          return stay({ ...reset, step: 'NOME', trilha: 'projeto' }, [
            MESSAGES.pedir_nome,
          ]);
        case 2:
          return stay({ ...reset, step: 'NOME', trilha: 'planta' }, [
            MESSAGES.pedir_nome,
          ]);
        case 3:
          return stay({ ...reset, step: 'NOME', trilha: 'semNada' }, [
            MESSAGES.pedir_nome,
          ]);
        case 4:
          return stay({ ...reset, step: 'VISITA', trilha: 'boleto' }, [
            MESSAGES.info_boleto,
            MESSAGES.pergunta_visita_boleto,
          ]);
        case 5:
          return stay({ ...reset, step: 'VISITA', trilha: 'loja' }, [
            MESSAGES.endereco_loja,
            MESSAGES.pergunta_visita_loja,
          ]);
        default:
          return null;
      }
    }

    case 'NOME':
      if (input.kind !== 'nome') return null;
      return stay(
        { ...reset, step: 'CONFIRMA_NOME', nomePendente: input.nome },
        [fill(MESSAGES.confirmar_nome, { nome: input.nome })],
      );

    case 'CONFIRMA_NOME': {
      if (input.kind !== 'option') return null;
      if (input.value === 2)
        return stay({ ...reset, step: 'NOME', nomePendente: null }, [
          MESSAGES.pedir_nome,
        ]);
      if (input.value !== 1) return null;
      const nome = state.nomePendente;
      if (state.trilha === 'semNada') {
        return stay(
          { ...reset, nome, step: 'CASA_AP' },
          [MESSAGES.casa_ou_ap],
          [{ type: 'criar_pasta' }],
        );
      }
      return stay(
        { ...reset, nome, step: 'ENVIO_ARQUIVOS' },
        [MESSAGES.pedir_projeto],
        [{ type: 'criar_pasta' }],
      );
    }

    case 'ENVIO_ARQUIVOS': {
      if (input.kind === 'file') {
        const aviso =
          state.trilha === 'projeto'
            ? MESSAGES.aguardar_ok_atendente
            : MESSAGES.aguardar_ok_continuar;
        return stay({ ...reset, arquivos: state.arquivos + 1 }, [aviso]);
      }
      if (input.kind !== 'ok' || state.arquivos === 0) return null;
      if (state.trilha === 'projeto')
        return stay(reset, [], [handoff('redirecionando_com_nome')]);
      return stay({ ...reset, step: 'CATEGORIAS' }, [
        MESSAGES.ambientes_categorias,
      ]);
    }

    case 'CATEGORIAS': {
      if (input.kind === 'categorias') {
        const ids = Array.from(
          new Set([...state.categorias, ...input.ids]),
        ).filter((id) => CATEGORIAS_AMBIENTE[id]);
        return stay({ ...reset, categorias: ids }, [MESSAGES.referencias_ok]);
      }
      const finish =
        input.kind === 'ok' || (input.kind === 'option' && input.value === 9);
      if (!finish) return null;
      const effects: Effect[] = state.categorias.length
        ? [{ type: 'salvar_preferencias' }]
        : [];
      if (state.trilha === 'planta') {
        return stay(
          reset,
          [],
          [...effects, handoff('redirecionando_com_nome')],
        );
      }
      return stay(
        { ...reset, step: 'AGENDAR' },
        [MESSAGES.agendar_medicao_pergunta],
        effects,
      );
    }

    case 'CASA_AP': {
      if (input.kind !== 'option') return input.kind === 'file' ? stay() : null;
      if (input.value === 1) {
        return stay({ ...reset, local: 'casa', step: 'AGENDAR' }, [
          MESSAGES.agendar_medicao_pergunta,
        ]);
      }
      if (input.value === 2) {
        return stay({ ...reset, local: 'ap', step: 'PLANTA_ACHOU' }, [
          MESSAGES.planta_instrucoes,
          MESSAGES.planta_achou_ou_nao,
        ]);
      }
      return null;
    }

    case 'PLANTA_ACHOU': {
      // A planta enviada como imagem é guardada pelo serviço; aqui só contamos.
      if (input.kind === 'file') return stay({ arquivos: state.arquivos + 1 });
      if (input.kind !== 'option') return null;
      if (input.value === 1)
        return stay({ ...reset, step: 'CATEGORIAS' }, [
          MESSAGES.ambientes_categorias,
        ]);
      if (input.value === 2)
        return stay({ ...reset, step: 'AGENDAR' }, [
          MESSAGES.agendar_medicao_pergunta,
        ]);
      return null;
    }

    case 'AGENDAR': {
      if (input.kind !== 'option') return null;
      if (input.value === 1) {
        // Sem agenda disponível, o atendente humano combina o horário da medição.
        if (!opts.scheduling)
          return stay(
            reset,
            [],
            [
              handoff(
                state.nome ? 'redirecionando_com_nome' : 'redirecionando',
              ),
            ],
          );
        return stay(
          { ...reset, step: 'HORARIO' },
          [],
          [{ type: 'oferecer_horarios' }],
        );
      }
      if (input.value === 2)
        return stay(
          reset,
          [],
          [handoff(state.nome ? 'redirecionando_com_nome' : 'redirecionando')],
        );
      return null;
    }

    case 'HORARIO': {
      if (input.kind !== 'option') return null;
      const available = Math.min(state.slots?.length ?? 0, 8);
      if (input.value === 9)
        return stay(
          reset,
          [],
          [handoff(state.nome ? 'redirecionando_com_nome' : 'redirecionando')],
        );
      if (input.value >= 1 && input.value <= available) {
        return stay(
          reset,
          [],
          [{ type: 'agendar', slotIndex: input.value - 1 }],
        );
      }
      return null;
    }

    case 'VISITA': {
      if (input.kind !== 'option') return null;
      if (input.value === 1)
        return stay(
          reset,
          [],
          [handoff(state.nome ? 'redirecionando_com_nome' : 'redirecionando')],
        );
      if (input.value === 2) {
        return {
          patch: { ...INITIAL_FLOW_STATE, categorias: [] },
          replies: [MESSAGES.menu_reapresentado],
          effects: [],
        };
      }
      return null;
    }

    case 'RECONHECIMENTO': {
      if (input.kind !== 'option') return null;
      if (input.value === 1) return restartDecision();
      if (input.value === 2)
        return stay(
          reset,
          [],
          [
            {
              type: 'handoff',
              mensagem: 'redirecionando',
              reutilizarAtendente: true,
            },
          ],
        );
      return null;
    }

    default:
      return null;
  }
}
