import {
  CATEGORIAS_AMBIENTE,
  MESSAGES,
  MessageKey,
} from '../domain/chatbot.messages';
import { SPECS } from '../domain/message-specs';
import { FlowDoc, FlowNode, NodeSpec, SystemMessages } from './flow.types';

/**
 * O atendimento da Vera D'Or como fluxos do motor. É o ponto de partida de quem nunca publicou nada
 * e a referência para converter conteúdo antigo. Depois de publicado, é editável como qualquer fluxo.
 *
 * Os textos vêm de `chatbot.messages.ts` (fonte: n8n), sem as linhas de opções e de rodapé,
 * que o motor passa a montar sozinho.
 */

const OPTION_LINE = /^\s*\*?\d{1,2}\*?\s*[-–]\s/;
const FOOTER_LINE =
  /^\s*(0|10)\s*[-–]\s|^\s*👉|^\s*\*?Responda com:?\*?\s*$|^\s*Por favor, responda com o \*número\*:?\s*$|^\s*As opções são:?\s*$/;

/** Texto de uma mensagem sem as opções numeradas e sem o rodapé de navegação. */
export function head(text: string): string {
  return text
    .split('\n')
    .filter((l) => !OPTION_LINE.test(l) && !FOOTER_LINE.test(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function specOf(key: MessageKey): NodeSpec | undefined {
  const s = SPECS[key];
  if (!s) return undefined;
  return {
    objetivo: s.objetivo,
    pontos: s.pontos.map((p) => [...p.anyOf]),
    saudacao: s.saudacao,
    usaNome: s.usaNome,
    maxChars: s.maxChars,
  };
}

/** Qual etapa do seed corresponde a cada mensagem antiga (para converter conteúdo já publicado). */
export const LEGACY_MESSAGE_MAP: Partial<
  Record<
    MessageKey,
    Array<{ flow: string; node: string; campo?: 'texto' | 'textoApos' }>
  >
> = {
  menu_inicial: [{ flow: 'vera', node: 'menu' }],
  menu_reapresentado: [
    { flow: 'boleto', node: 'fim' },
    { flow: 'loja', node: 'fim' },
  ],
  pedir_nome: [
    { flow: 'projeto', node: 'nome' },
    { flow: 'planta', node: 'nome' },
    { flow: 'sem_nada', node: 'nome' },
  ],
  confirmar_nome: [
    { flow: 'projeto', node: 'confirma' },
    { flow: 'planta', node: 'confirma' },
    { flow: 'sem_nada', node: 'confirma' },
  ],
  pedir_projeto: [
    { flow: 'projeto', node: 'arquivos' },
    { flow: 'planta', node: 'arquivos' },
  ],
  aguardar_ok_atendente: [
    { flow: 'projeto', node: 'arquivos', campo: 'textoApos' },
  ],
  aguardar_ok_continuar: [
    { flow: 'planta', node: 'arquivos', campo: 'textoApos' },
  ],
  ambientes_categorias: [
    { flow: 'planta', node: 'ambientes' },
    { flow: 'sem_nada', node: 'ambientes' },
  ],
  referencias_ok: [
    { flow: 'planta', node: 'ambientes', campo: 'textoApos' },
    { flow: 'sem_nada', node: 'ambientes', campo: 'textoApos' },
  ],
  casa_ou_ap: [{ flow: 'sem_nada', node: 'imovel' }],
  planta_instrucoes: [{ flow: 'sem_nada', node: 'planta_instrucoes' }],
  planta_achou_ou_nao: [{ flow: 'sem_nada', node: 'planta_achou' }],
  agendar_medicao_pergunta: [{ flow: 'sem_nada', node: 'agendar' }],
  horario_agendado: [{ flow: 'sem_nada', node: 'encaminhar_agendado' }],
  info_boleto: [{ flow: 'boleto', node: 'info' }],
  pergunta_visita_boleto: [{ flow: 'boleto', node: 'visita' }],
  endereco_loja: [{ flow: 'loja', node: 'endereco' }],
  pergunta_visita_loja: [{ flow: 'loja', node: 'visita' }],
  reconhecimento: [{ flow: 'reconhecimento', node: 'pergunta' }],
};

/** Mensagens que agora são do sistema (motor), com o nome novo. */
export const LEGACY_SYSTEM_MAP: Partial<
  Record<MessageKey, keyof SystemMessages>
> = {
  invalida_generica: 'invalida_generica',
  invalida_nome: 'invalida_nome',
  invalida_arquivos: 'invalida_arquivos',
  invalida_ambientes: 'invalida_lista',
  duvida_sem_resposta: 'duvida_sem_resposta',
  dado_corrigido: 'dado_corrigido',
  retomar_conversa: 'retomar_conversa',
  esclarecer_etapa: 'esclarecer_etapa',
  fora_escopo: 'fora_escopo',
  fora_escopo_limite: 'fora_escopo_limite',
  audio_nao_suportado: 'audio_nao_suportado',
  reinicio_por_pausa: 'reinicio_por_pausa',
  redirecionando_projetistas: 'redirecionando',
  redirecionando_projetistas_com_nome: 'redirecionando_com_nome',
};

export const DEFAULT_SYSTEM: SystemMessages = {
  invalida_generica: MESSAGES.invalida_generica,
  invalida_nome: MESSAGES.invalida_nome,
  invalida_arquivos: MESSAGES.invalida_arquivos,
  invalida_lista: MESSAGES.invalida_ambientes,
  duvida_sem_resposta: MESSAGES.duvida_sem_resposta,
  dado_corrigido: MESSAGES.dado_corrigido,
  retomar_conversa: MESSAGES.retomar_conversa,
  esclarecer_etapa: MESSAGES.esclarecer_etapa,
  fora_escopo: MESSAGES.fora_escopo,
  fora_escopo_limite: MESSAGES.fora_escopo_limite,
  audio_nao_suportado: MESSAGES.audio_nao_suportado,
  reinicio_por_pausa: MESSAGES.reinicio_por_pausa,
  redirecionando: MESSAGES.redirecionando_projetistas,
  redirecionando_com_nome: MESSAGES.redirecionando_projetistas_com_nome,
  rodape_navegacao: '0 - ↩️ Voltar uma etapa\n10 - 🔄 Recomeçar o atendimento',
  rodape_escolha: '👉 *Envie o número da opção desejada.*',
  rodape_ok: 'Quando terminar, envie a palavra *OK*.',
};

export const SYSTEM_LABELS: Record<keyof SystemMessages, string> = {
  invalida_generica: 'Resposta inválida (geral)',
  invalida_nome: 'Nome inválido',
  invalida_arquivos: 'Arquivo não enviado',
  invalida_lista: 'Itens inválidos (lista)',
  duvida_sem_resposta: 'Dúvida que o bot não sabe responder',
  dado_corrigido: 'Cliente corrigiu o nome',
  retomar_conversa: 'Cliente comentou algo: retomar',
  esclarecer_etapa: 'Cliente não entendeu: explicar de novo',
  fora_escopo: 'Assunto fora do atendimento',
  fora_escopo_limite: 'Limite de assuntos fora do atendimento',
  audio_nao_suportado: 'Áudio recebido',
  reinicio_por_pausa: 'Reinício após pausa',
  redirecionando: 'Encaminhando ao atendente',
  redirecionando_com_nome: 'Encaminhando ao atendente (com nome)',
  rodape_navegacao: 'Rodapé: voltar e recomeçar',
  rodape_escolha: 'Rodapé: envie o número',
  rodape_ok: 'Rodapé: envie OK',
};

// ───────────────────────── etapas reaproveitadas ─────────────────────────

const nomeEConfirma = (depois: string): FlowNode[] => [
  {
    id: 'nome',
    tipo: 'pergunta',
    titulo: 'Nome',
    texto: head(MESSAGES.pedir_nome),
    variavel: 'nome',
    validacao: 'nome',
    proximo: 'confirma',
    spec: specOf('pedir_nome'),
  },
  {
    id: 'confirma',
    tipo: 'confirmacao',
    titulo: 'Confirmar o nome',
    texto: head(MESSAGES.confirmar_nome),
    opcoes: [
      {
        rotulo: 'Sim',
        proximo: 'pasta',
        palavras: ['sim', 'isso', 'certo', 'correto'],
      },
      { rotulo: 'Não', proximo: 'nome', palavras: ['nao', 'errado'] },
    ],
    spec: specOf('confirmar_nome'),
  },
  {
    id: 'pasta',
    tipo: 'ferramenta',
    titulo: 'Criar a pasta no Drive',
    ferramenta: 'drive.criar_pasta',
    params: { modo: 'criar' },
    proximo: depois,
    falha: depois,
  },
];

const ambientes = (): FlowNode => ({
  id: 'ambientes',
  tipo: 'multipla',
  titulo: 'Ambientes de interesse',
  texto: head(MESSAGES.ambientes_categorias),
  variavel: 'ambientes',
  itens: Object.values(CATEGORIAS_AMBIENTE).map((rotulo) => ({ rotulo })),
  nenhum: '❌ Nenhum destes ambientes',
  textoApos: head(MESSAGES.referencias_ok),
  proximo: 'salvar',
  spec: specOf('ambientes_categorias'),
});

const salvarAmbientes = (depois: string): FlowNode => ({
  id: 'salvar',
  tipo: 'ferramenta',
  titulo: 'Guardar os ambientes no Drive',
  ferramenta: 'drive.salvar_respostas',
  params: { titulo: 'Preferências', somente: 'ambientes' },
  proximo: depois,
  falha: depois,
});

const encaminhar: FlowNode = {
  id: 'encaminhar',
  tipo: 'encaminhar',
  titulo: 'Encaminhar ao projetista',
};

// ───────────────────────── fluxos ─────────────────────────

export function seedFlows(): FlowDoc[] {
  const vera: FlowDoc = {
    id: 'vera',
    nome: 'Atendimento Vera',
    descricao:
      'Menu inicial: o cliente escolhe o que precisa e segue para o fluxo certo.',
    ativo: true,
    papel: 'entrada',
    nos: [
      {
        id: 'menu',
        tipo: 'opcoes',
        titulo: 'Menu inicial',
        texto: head(MESSAGES.menu_inicial),
        variavel: 'trilha',
        opcoes: [
          {
            rotulo: '📐 Já tenho o projeto e quero orçar.',
            valor: 'projeto',
            proximo: 'ir_projeto',
            palavras: ['projeto', 'orcar', 'orcamento'],
          },
          {
            rotulo: '📏 Só tenho a planta baixa e quero um projeto.',
            valor: 'planta',
            proximo: 'ir_planta',
            palavras: ['planta', 'planta baixa'],
          },
          {
            rotulo: '🚫 Não tenho nem o projeto e nem a planta baixa.',
            valor: 'semNada',
            proximo: 'ir_sem_nada',
            palavras: ['nenhum', 'nao tenho'],
          },
          {
            rotulo:
              '💳 Quero informações sobre forma de pagamento por boleto bancário.',
            valor: 'boleto',
            proximo: 'ir_boleto',
            palavras: ['boleto', 'pagamento'],
          },
          {
            rotulo: '📍 Qual endereço da loja física?',
            valor: 'loja',
            proximo: 'ir_loja',
            palavras: ['endereco', 'loja'],
          },
        ],
        spec: specOf('menu_inicial'),
      },
      {
        id: 'ir_projeto',
        tipo: 'ir_para',
        titulo: 'Já tenho o projeto',
        fluxo: 'projeto',
      },
      {
        id: 'ir_planta',
        tipo: 'ir_para',
        titulo: 'Só tenho a planta',
        fluxo: 'planta',
      },
      {
        id: 'ir_sem_nada',
        tipo: 'ir_para',
        titulo: 'Não tenho nada',
        fluxo: 'sem_nada',
      },
      { id: 'ir_boleto', tipo: 'ir_para', titulo: 'Boleto', fluxo: 'boleto' },
      {
        id: 'ir_loja',
        tipo: 'ir_para',
        titulo: 'Endereço da loja',
        fluxo: 'loja',
      },
    ],
  };

  const projeto: FlowDoc = {
    id: 'projeto',
    nome: 'Já tenho o projeto',
    descricao:
      'Pede o nome, cria a pasta no Drive, recebe o projeto e encaminha ao projetista.',
    ativo: true,
    nos: [
      ...nomeEConfirma('arquivos'),
      {
        id: 'arquivos',
        tipo: 'arquivos',
        titulo: 'Receber o projeto',
        texto: head(MESSAGES.pedir_projeto),
        textoApos: head(MESSAGES.aguardar_ok_atendente),
        minimo: 1,
        proximo: 'encaminhar',
        spec: specOf('pedir_projeto'),
      },
      encaminhar,
    ],
  };

  const planta: FlowDoc = {
    id: 'planta',
    nome: 'Só tenho a planta baixa',
    descricao:
      'Pede o nome, recebe a planta, pergunta os ambientes de interesse e encaminha.',
    ativo: true,
    nos: [
      ...nomeEConfirma('arquivos'),
      {
        id: 'arquivos',
        tipo: 'arquivos',
        titulo: 'Receber a planta',
        texto: head(MESSAGES.pedir_projeto),
        textoApos: head(MESSAGES.aguardar_ok_continuar),
        minimo: 1,
        proximo: 'ambientes',
        spec: specOf('pedir_projeto'),
      },
      ambientes(),
      salvarAmbientes('encaminhar'),
      encaminhar,
    ],
  };

  const semNada: FlowDoc = {
    id: 'sem_nada',
    nome: 'Não tenho projeto nem planta',
    descricao:
      'Casa ou apartamento, orientação para achar a planta, ambientes e agendamento da medição.',
    ativo: true,
    nos: [
      ...nomeEConfirma('imovel'),
      {
        id: 'imovel',
        tipo: 'opcoes',
        titulo: 'Casa ou apartamento',
        texto: head(MESSAGES.casa_ou_ap),
        variavel: 'imovel',
        opcoes: [
          { rotulo: 'Casa', proximo: 'agendar', palavras: ['casa'] },
          {
            rotulo: 'Apartamento',
            proximo: 'planta_instrucoes',
            palavras: ['apartamento', 'ap', 'apto'],
          },
        ],
        spec: specOf('casa_ou_ap'),
      },
      {
        id: 'planta_instrucoes',
        tipo: 'mensagem',
        titulo: 'Como achar a planta',
        texto: head(MESSAGES.planta_instrucoes),
        proximo: 'planta_achou',
        spec: specOf('planta_instrucoes'),
      },
      {
        id: 'planta_achou',
        tipo: 'opcoes',
        titulo: 'Achou a planta?',
        texto: head(MESSAGES.planta_achou_ou_nao),
        opcoes: [
          {
            rotulo: '✅ Achei e enviei a imagem da planta baixa.',
            proximo: 'ambientes',
            palavras: ['achei', 'enviei', 'sim'],
          },
          {
            rotulo: '❌ Não encontrei a minha planta baixa.',
            proximo: 'agendar',
            palavras: ['nao encontrei', 'nao achei', 'nao'],
          },
        ],
        spec: specOf('planta_achou_ou_nao'),
      },
      ambientes(),
      salvarAmbientes('agendar'),
      {
        id: 'agendar',
        tipo: 'opcoes',
        titulo: 'Quer agendar a medição?',
        texto: head(MESSAGES.agendar_medicao_pergunta),
        opcoes: [
          {
            rotulo: 'Quero agendar 📝',
            proximo: 'encaminhar_agendado',
            palavras: ['sim', 'quero', 'agendar'],
          },
          {
            rotulo: 'Não quero agendar ❌',
            proximo: 'encaminhar',
            palavras: ['nao', 'nao quero'],
          },
        ],
        spec: specOf('agendar_medicao_pergunta'),
      },
      {
        id: 'encaminhar_agendado',
        tipo: 'encaminhar',
        titulo: 'Encaminhar para combinar a medição',
        texto: head(MESSAGES.horario_agendado),
        spec: specOf('horario_agendado'),
      },
      encaminhar,
    ],
  };

  const boleto: FlowDoc = {
    id: 'boleto',
    nome: 'Pagamento por boleto',
    descricao:
      'Explica as condições e pergunta se o cliente quer agendar uma visita.',
    ativo: true,
    nos: [
      {
        id: 'info',
        tipo: 'mensagem',
        titulo: 'Condições de pagamento',
        texto: head(MESSAGES.info_boleto),
        proximo: 'visita',
        spec: specOf('info_boleto'),
      },
      {
        id: 'visita',
        tipo: 'opcoes',
        titulo: 'Quer agendar uma visita?',
        texto: head(MESSAGES.pergunta_visita_boleto),
        opcoes: [
          {
            rotulo: '🤝 Sim, quero agendar',
            proximo: 'encaminhar',
            palavras: ['sim', 'quero'],
          },
          {
            rotulo: '👋 Não, obrigado(a)',
            proximo: 'fim',
            palavras: ['nao', 'obrigado', 'obrigada'],
          },
        ],
        spec: specOf('pergunta_visita_boleto'),
      },
      encaminhar,
      {
        id: 'fim',
        tipo: 'fim',
        titulo: 'Voltar ao menu',
        texto: head(MESSAGES.menu_reapresentado),
        spec: specOf('menu_reapresentado'),
      },
    ],
  };

  const loja: FlowDoc = {
    id: 'loja',
    nome: 'Endereço da loja',
    descricao: 'Envia o endereço e convida para uma visita.',
    ativo: true,
    nos: [
      {
        id: 'endereco',
        tipo: 'mensagem',
        titulo: 'Endereço',
        texto: MESSAGES.endereco_loja,
        proximo: 'visita',
        spec: specOf('endereco_loja'),
      },
      {
        id: 'visita',
        tipo: 'opcoes',
        titulo: 'Quer visitar a loja?',
        texto: head(MESSAGES.pergunta_visita_loja),
        opcoes: [
          {
            rotulo: '🤝 Sim, quero agendar',
            proximo: 'encaminhar',
            palavras: ['sim', 'quero'],
          },
          {
            rotulo: '👋 Não, obrigado(a)',
            proximo: 'fim',
            palavras: ['nao', 'obrigado', 'obrigada'],
          },
        ],
        spec: specOf('pergunta_visita_loja'),
      },
      encaminhar,
      {
        id: 'fim',
        tipo: 'fim',
        titulo: 'Voltar ao menu',
        texto: head(MESSAGES.menu_reapresentado),
        spec: specOf('menu_reapresentado'),
      },
    ],
  };

  const reconhecimento: FlowDoc = {
    id: 'reconhecimento',
    nome: 'Cliente conhecido',
    descricao:
      'Quem já foi atendido e abriu uma conversa nova: recomeçar com a Vera ou falar com o atendente.',
    ativo: true,
    papel: 'reconhecimento',
    nos: [
      {
        id: 'pergunta',
        tipo: 'opcoes',
        titulo: 'Recomeçar ou falar com atendente?',
        texto: head(MESSAGES.reconhecimento),
        opcoes: [
          {
            rotulo: 'Quero começar de novo 🔄',
            proximo: 'fim',
            palavras: ['comecar', 'recomecar', 'de novo'],
          },
          {
            rotulo: 'Falar com um atendente 👤',
            proximo: 'encaminhar',
            palavras: ['atendente', 'humano', 'pessoa'],
          },
        ],
        spec: specOf('reconhecimento'),
      },
      { id: 'fim', tipo: 'fim', titulo: 'Recomeçar' },
      {
        id: 'encaminhar',
        tipo: 'encaminhar',
        titulo: 'Voltar ao mesmo atendente',
        reutilizarAtendente: true,
      },
    ],
  };

  return [vera, projeto, planta, semNada, boleto, loja, reconhecimento];
}
