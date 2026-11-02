/**
 * Base de conhecimento fechada. Os agentes de FAQ só podem afirmar o que está aqui.
 * Para liberar um novo assunto, acrescente uma entrada — nunca "ensine" isso só no prompt.
 */
export interface KbEntry {
  id: string;
  /** Palavras que ativam a entrada (sem acento, minúsculas). */
  keywords: string[];
  text: string;
}

export const KNOWLEDGE_BASE: KbEntry[] = [
  {
    id: 'empresa',
    keywords: [
      'empresa',
      'loja',
      'voces',
      'quem',
      'trabalham',
      'fazem',
      'movel',
      'moveis',
      'planejado',
      'planejados',
      'marcenaria',
      'cinthia',
    ],
    text: 'A Cinthia Moreira Modulados trabalha com móveis planejados: cozinhas, salas, dormitórios, banheiros, salas de jantar, cantos alemães, home office e ambientes corporativos.',
  },
  {
    id: 'bot',
    keywords: [
      'robo',
      'bot',
      'atendente',
      'virtual',
      'humano',
      'pessoa',
      'vera',
      'ia',
      'inteligencia',
    ],
    text: "Quem atende por aqui é a Vera D'Or, atendente virtual da Cinthia Moreira Modulados. Depois da triagem, o cliente é encaminhado a um atendente humano (projetista).",
  },
  {
    id: 'endereco',
    keywords: [
      'endereco',
      'onde',
      'fica',
      'localizacao',
      'localiza',
      'loja',
      'visita',
      'visitar',
      'djalma',
      'batista',
      'manaus',
      'chegar',
    ],
    text: 'A loja fica na Av. Djalma Batista, 1334 (CM Modulados — Loja Djalma), em Manaus.',
  },
  {
    id: 'telefone',
    keywords: ['telefone', 'contato', 'ligar', 'whatsapp', 'numero', 'falar'],
    text: 'O telefone da loja é (92) 99455-1471.',
  },
  {
    id: 'pagamento',
    keywords: [
      'pagamento',
      'pagar',
      'boleto',
      'entrada',
      'parcela',
      'parcelar',
      'parcelamento',
      'prazo',
      'financiamento',
      'forma',
      'formas',
    ],
    text: 'É possível adquirir o ambiente planejado com ou sem entrada e iniciar o pagamento em até 60 dias, por boleto bancário. Condições detalhadas são passadas pelo atendente.',
  },
  {
    id: 'medicao',
    keywords: [
      'medicao',
      'medir',
      'medidas',
      'agendar',
      'agendamento',
      'horario',
      'visita',
    ],
    text: 'As medições são agendadas pela equipe, de segunda a sexta, em horários de 2 horas.',
  },
  {
    id: 'orcamento',
    keywords: [
      'orcamento',
      'orcar',
      'projeto',
      'planta',
      'baixa',
      'como',
      'funciona',
      'processo',
    ],
    text: 'Para orçar, o cliente informa se já tem o projeto, só a planta baixa, ou nenhum dos dois; envia os arquivos, escolhe os ambientes de interesse e é encaminhado a um projetista. Valores são informados somente pelo atendente.',
  },
];

export const DEFAULT_KB: KbEntry[] = KNOWLEDGE_BASE.map((e) => ({
  ...e,
  keywords: [...e.keywords],
}));

export const strip = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Busca determinística: as `limit` entradas com mais palavras-chave presentes na pergunta. */
export function retrieveKb(question: string, limit = 3): KbEntry[] {
  const tokens = new Set(
    strip(question)
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2),
  );
  return KNOWLEDGE_BASE.map((entry) => ({
    entry,
    score: entry.keywords.filter((k) => tokens.has(k)).length,
  }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.entry);
}
