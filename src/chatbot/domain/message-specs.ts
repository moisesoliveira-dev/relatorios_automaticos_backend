import { MessageKey } from './chatbot.messages';

/**
 * Pontos essenciais de comunicação das mensagens da Vera.
 *
 * A IA (agente Redator) escolhe COMO dizer — tom, saudação, reconhecer o que o cliente falou —
 * mas só pode enviar o texto se TODOS os pontos abaixo estiverem presentes. O que é "bloco fixo"
 * (lista de opções, endereço, horários) é anexado pelo código, literalmente, e nunca reescrito.
 * Se a IA falhar, demorar ou esquecer algum ponto, vai a mensagem original.
 *
 * Com o motor de fluxos, estas especificações viajam dentro de cada etapa (`node.spec`); esta
 * tabela é o valor inicial das etapas do seed.
 */
export interface Point {
  /** Palavras-chave (sem acento, minúsculas): basta uma delas aparecer no texto final. */
  anyOf: string[];
}

export interface MessageSpec {
  /** O que a mensagem precisa alcançar com o cliente. */
  objetivo: string;
  pontos: Point[];
  /** Onde começa o bloco fixo dentro do texto original. Padrão: primeira linha de opção numerada. */
  blocoRegex?: RegExp;
  /** O nome do cliente deve aparecer (ex.: confirmação). */
  nomeObrigatorio?: boolean;
  /** Natural usar o primeiro nome do cliente (no máximo uma vez). */
  usaNome?: boolean;
  /** Primeira mensagem da conversa: cumprimento conforme a hora do dia. */
  saudacao?: boolean;
  /** Tamanho máximo do texto escrito pela IA (sem o bloco fixo). */
  maxChars?: number;
  /** Trechos (sem acento, minúsculos) que precisam continuar no texto (ex.: o que estava em *negrito*). */
  manter?: string[];
  /** A mensagem original faz uma pergunta: a nova também precisa perguntar. */
  perguntar?: boolean;
}

const p = (...anyOf: string[]): Point => ({ anyOf });

export const SPECS: Partial<Record<MessageKey, MessageSpec>> = {
  menu_inicial: {
    objetivo:
      'Dar boas-vindas, se apresentar (Vera D’Or, atendente virtual da Cinthia Moreira Modulados) e perguntar como pode ajudar, levando às opções.',
    pontos: [p('vera'), p('cinthia', 'modulados'), p('ajudar', 'ajuda')],
    saudacao: true,
    maxChars: 260,
  },
  menu_reapresentado: {
    objetivo:
      'Avisar que o cliente pode escolher outra forma de atendimento se quiser; se não, é só ignorar.',
    pontos: [p('outra', 'outro', 'escolher', 'selecionar', 'opcao', 'opcoes')],
    maxChars: 220,
  },
  pedir_nome: {
    objetivo: 'Pedir o nome do cliente antes de seguir com o atendimento.',
    pontos: [p('nome')],
    maxChars: 220,
  },
  confirmar_nome: {
    objetivo: 'Confirmar se o nome informado está certo.',
    pontos: [p('certo', 'correto', 'confere', 'isso', 'esta certo')],
    nomeObrigatorio: true,
    maxChars: 200,
  },
  pedir_projeto: {
    objetivo:
      'Pedir que envie o projeto/planta por aqui mesmo (PDF, imagem ou qualquer formato) e dizer que um atendente humano chama assim que receber.',
    pontos: [
      p('enviar', 'envie', 'mande', 'mandar', 'manda'),
      p('pdf', 'imagem', 'formato', 'arquivo'),
      p('atendente', 'projetista', 'equipe'),
    ],
    maxChars: 420,
  },
  casa_ou_ap: {
    objetivo: 'Perguntar se o imóvel é casa ou apartamento.',
    pontos: [p('casa'), p('apartamento', 'ap')],
    maxChars: 200,
  },
  planta_instrucoes: {
    objetivo:
      'Orientar como conseguir a planta baixa do apartamento: site da construtora/condomínio → procurar a planta → tirar print ou baixar → enviar a imagem aqui na conversa.',
    pontos: [
      p('site'),
      p('construtora', 'condominio'),
      p('planta'),
      p('print', 'captura', 'baixar', 'baixe'),
      p('enviar', 'envie', 'mande'),
    ],
    maxChars: 520,
  },
  planta_achou_ou_nao: {
    objetivo:
      'Perguntar se o cliente encontrou e enviou a planta baixa ou se não conseguiu encontrar.',
    pontos: [p('planta'), p('achou', 'encontrou', 'achei', 'encontrei')],
    maxChars: 200,
  },
  ambientes_categorias: {
    objetivo:
      'Perguntar quais ambientes o cliente quer ver e projetar; ele pode indicar mais de um número na mesma mensagem (ex.: 2 1 3).',
    pontos: [
      p('ambiente', 'ambientes'),
      p('mais de um', 'varios', 'exemplo', 'separad', '2 1 3'),
    ],
    maxChars: 330,
  },
  agendar_medicao_pergunta: {
    objetivo:
      'Explicar que dá para agendar uma visita da equipe para as medições e perguntar se o cliente quer agendar.',
    pontos: [p('medicao', 'medicoes', 'medir', 'medidas'), p('agendar')],
    usaNome: true,
    maxChars: 260,
  },
  escolher_horario: {
    objetivo:
      'Pedir que o cliente escolha o melhor horário para a medição entre os listados.',
    pontos: [p('horario', 'horarios'), p('medicao', 'medir', 'medidas')],
    maxChars: 220,
  },
  horario_agendado: {
    objetivo:
      'Confirmar que será direcionado ao responsável para combinar os detalhes da medição no local e pedir um momento.',
    pontos: [
      p('responsavel', 'atendente'),
      p('medicao', 'medir', 'medidas'),
      p('momento', 'instante', 'aguarde'),
    ],
    usaNome: true,
    maxChars: 330,
  },
  info_boleto: {
    objetivo:
      'Informar que é possível adquirir o ambiente planejado com ou sem entrada e iniciar o pagamento em até 60 dias.',
    pontos: [p('entrada'), p('60')],
    maxChars: 420,
  },
  pergunta_visita_boleto: {
    objetivo:
      'Perguntar se o cliente quer agendar uma visita para conversar melhor sobre as formas de pagamento.',
    pontos: [p('visita', 'agendar'), p('pagamento')],
    maxChars: 260,
  },
  endereco_loja: {
    objetivo: 'Informar o endereço e o telefone da loja física.',
    pontos: [],
    blocoRegex: /📍 Nosso endereço:[\s\S]*$/,
    maxChars: 160,
  },
  pergunta_visita_loja: {
    objetivo:
      'Convidar o cliente para conhecer a loja e perguntar se quer agendar uma visita.',
    pontos: [p('loja'), p('visita')],
    maxChars: 300,
  },
  reconhecimento: {
    objetivo:
      'Avisar que percebemos que o cliente já falou com atendentes e perguntar se prefere recomeçar com a Vera ou falar direto com um atendente projetista.',
    pontos: [
      p('atendente', 'atendentes'),
      p('recomecar', 'comecar de novo', 'reiniciar', 'do zero'),
    ],
    usaNome: true,
    maxChars: 330,
  },
  reinicio_por_pausa: {
    objetivo:
      'Avisar que houve uma pausa no atendimento e que vamos reiniciar.',
    pontos: [p('pausa'), p('reiniciar', 'reinici', 'recomec', 'comecar')],
    maxChars: 200,
  },
  redirecionando_projetistas: {
    objetivo:
      'Dizer que está tudo certo, que o cliente será encaminhado ao time de projetistas e pedir um instante.',
    pontos: [
      p('projetista', 'projetistas', 'time', 'equipe'),
      p('instante', 'momento', 'aguarde', 'segundinho'),
    ],
    maxChars: 360,
  },
  redirecionando_projetistas_com_nome: {
    objetivo:
      'Dizer que está tudo certo, que o cliente será encaminhado ao time de projetistas e pedir um instante; usar o primeiro nome uma vez.',
    pontos: [
      p('projetista', 'projetistas', 'time', 'equipe'),
      p('instante', 'momento', 'aguarde', 'segundinho'),
    ],
    usaNome: true,
    maxChars: 360,
  },
  invalida_generica: {
    objetivo:
      'Dizer com gentileza que não entendeu e pedir que responda com uma das opções da mensagem anterior.',
    pontos: [p('opcao', 'opcoes', 'numero')],
    maxChars: 200,
  },
  invalida_nome: {
    objetivo:
      'Dizer com gentileza que não conseguiu entender o nome e pedir que envie um nome válido; falta pouco para encaminhar ao atendente.',
    pontos: [p('nome')],
    maxChars: 200,
  },
  invalida_arquivos: {
    objetivo:
      'Pedir que envie os arquivos solicitados; se já enviou, confirmar com a palavra OK. Falta pouco para encaminhar ao atendente.',
    pontos: [p('arquivo', 'arquivos'), p('ok', 'palavra')],
    maxChars: 260,
  },
  invalida_ambientes: {
    objetivo:
      'Pedir que envie os números dos itens; se já enviou, mandar OK para confirmar.',
    pontos: [
      p('ambiente', 'ambientes', 'item', 'itens', 'opcao', 'opcoes'),
      p('ok', 'palavra'),
    ],
    maxChars: 260,
  },
  fora_escopo: {
    objetivo:
      'Explicar com educação que só ajuda com assuntos da Cinthia Moreira Modulados (projetos, orçamentos, medições, móveis planejados) e convidar a continuar de onde pararam.',
    pontos: [
      p(
        'movel',
        'moveis',
        'planejado',
        'planejados',
        'projeto',
        'projetos',
        'orcamento',
      ),
      p('continuar', 'continuamos', 'seguir', 'retomar', 'paramos'),
    ],
    maxChars: 260,
  },
  fora_escopo_limite: {
    objetivo:
      'Dizer que, para manter o atendimento focado, seguirá só com as opções do atendimento; para falar com uma pessoa, enviar 10 para recomeçar e escolher a opção desejada.',
    pontos: [p('opcao', 'opcoes'), p('10')],
    maxChars: 300,
  },
  audio_nao_suportado: {
    objetivo:
      'Avisar com simpatia que ainda não consegue ouvir áudios e pedir que escreva em texto.',
    pontos: [
      p('audio', 'audios'),
      p('texto', 'escrever', 'escreva', 'digitar', 'digite'),
    ],
    maxChars: 200,
  },
};

/** Separa o texto em "o que a IA pode reescrever" e "bloco fixo" (opções, endereço, horários, rodapé). */
export function splitBlock(
  spec: MessageSpec,
  text: string,
): { head: string; block: string } {
  const re = spec.blocoRegex;
  if (re) {
    const m = re.exec(text);
    return m
      ? { head: text.slice(0, m.index).trim(), block: m[0].trim() }
      : { head: text.trim(), block: '' };
  }
  const lines = text.split('\n');
  const idx = lines.findIndex(
    (l) => /^\s*\*?\d{1,2}\*?\s*[-–]\s*\S/.test(l) || /^\s*👉/.test(l),
  );
  if (idx < 0) return { head: text.trim(), block: '' };
  return {
    head: lines.slice(0, idx).join('\n').trim(),
    block: lines.slice(idx).join('\n').trim(),
  };
}
