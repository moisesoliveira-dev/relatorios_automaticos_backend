import type { NodeType, Reply, SystemMessageKey } from '../engine/flow.types';
import { MessageSpec, Point, splitBlock } from './message-specs';
import {
  validateWriterOutput,
  WriterOutput,
  WriterVerdict,
} from './writer.validator';

/**
 * Modo atendente: em vez de reescrever mensagem por mensagem, tudo que o motor decidiu dizer neste
 * turno vira UM pedido à atendente, que escreve uma resposta só. O motor continua decidindo o
 * caminho; aqui só se define o que precisa ser dito e o que não pode ser mudado.
 */

export interface ItemDoTurno {
  reply: Reply;
  spec?: MessageSpec;
}

export interface Turno {
  /** O que a mensagem precisa fazer, na ordem. */
  pedidos: string[];
  /** Tudo o que a atendente pode citar (define os números permitidos). */
  referencia: string;
  /** Só os textos do fluxo (sem os objetivos): o que não pode ser copiado. */
  referenciaTextos: string;
  /** Textos que vão exatamente como estão, entre a abertura e o fechamento. */
  literais: string[];
  /** Pontos, tamanho e regras somados de todos os itens. */
  spec: MessageSpec;
  /** Opções que precisam aparecer em frase corrida. */
  opcoes: string[];
  /** O último literal é uma lista: a pergunta vem antes dela. */
  temLista: boolean;
  /** A mensagem começa pelo texto fixo (a resposta a uma dúvida) e a atendente continua depois. */
  literalAbre: boolean;
  primeira: boolean;
}

/** Até quantas opções cabem numa frase; acima disso, lista. */
export const MAX_OPCOES_EM_FRASE = 5;

/** O cliente não entendeu ou respondeu algo que não serve: aí sim mostra a lista completa. */
const PEDEM_LISTA = new Set<SystemMessageKey>([
  'invalida_generica',
  'invalida_lista',
]);

const numerada = (opcoes: string[]) =>
  opcoes.map((o, i) => `*${i + 1}* - ${o}`).join('\n');

const NAO_CITA = (rotulo: string) => /^\W*(sim|n[aã]o)\b/i.test(rotulo);

/**
 * As mensagens de sistema foram escritas para bot de menu ("escolha uma das opções"). Numa conversa,
 * o que importa é a intenção; os pontos ficam só onde há informação que não pode faltar.
 */
const INTENCAO: Partial<
  Record<SystemMessageKey, { objetivo: string; pontos: Point[] }>
> = {
  duvida_sem_resposta: {
    objetivo:
      'O cliente perguntou algo que você não tem como confirmar. Responda diretamente ao que ele perguntou, dizendo que quem passa essa informação é o projetista, no fim do atendimento. Não dê nenhum dado sobre o assunto.',
    pontos: [{ anyOf: ['projetista', 'atendente', 'especialista', 'equipe'] }],
  },
  retomar_conversa: {
    objetivo:
      'Responder em poucas palavras ao que o cliente comentou, como uma pessoa responderia.',
    pontos: [],
  },
  esclarecer_etapa: {
    objetivo:
      'O cliente não entendeu: explique de um jeito mais simples o que você precisa dele.',
    pontos: [],
  },
  invalida_generica: {
    objetivo:
      'Dizer, com leveza, que não entendeu direito o que ele quis dizer.',
    pontos: [],
  },
  invalida_nome: {
    objetivo:
      'Dizer, com leveza, que não entendeu o nome e pedir para ele escrever de novo.',
    pontos: [{ anyOf: ['nome', 'chama'] }],
  },
  invalida_arquivos: {
    objetivo:
      'Dizer, com leveza, que ainda não recebeu o arquivo; se ele já mandou tudo, é só avisar com um OK.',
    pontos: [{ anyOf: ['arquivo', 'planta', 'projeto', 'imagem'] }],
  },
  invalida_lista: {
    objetivo:
      'Dizer, com leveza, que não entendeu quais itens ele quer e pedir para indicar quais.',
    pontos: [],
  },
  fora_escopo: {
    objetivo:
      'Dizer com leveza que esse assunto foge do que você atende, que são os móveis planejados da loja.',
    pontos: [
      { anyOf: ['movel', 'moveis', 'planejado', 'planejados', 'projeto'] },
    ],
  },
};

export function intencaoDoSistema(
  key: SystemMessageKey,
  base: MessageSpec | undefined,
): MessageSpec | undefined {
  const i = INTENCAO[key];
  if (!i) return base && { ...base, modo: 'instrucao' };
  // Só a intenção: com o texto padrão na frente, o modelo copia a frase toda vez.
  return { ...base, modo: 'instrucao', objetivo: i.objetivo, pontos: i.pontos };
}

/** O texto do fluxo só serve de informação: sem emojis e negrito, para não ser imitado. */
const semEnfeite = (s: string) =>
  s
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{20E3}]/gu, '')
    .replace(/\*/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*/g, ' ')
    .trim();

/** Endereço, telefone e outros números longos precisam chegar exatos. */
const numerosLongos = (s: string) => s.match(/\d{3,}/g) ?? [];

export function montarTurno(input: {
  itens: ItemDoTurno[];
  /** A etapa em que o cliente está, se ainda houver algo a responder. */
  pendente?: ItemDoTurno | null;
  primeira: boolean;
}): Turno {
  const { primeira } = input;
  const itens = [...input.itens];
  const p = input.pendente;
  if (p && !itens.some((i) => i.reply.nodeId === p.reply.nodeId))
    itens.push({ ...p, reply: { ...p.reply, retomada: true } });

  const listar = itens.some(
    (i) => i.reply.sistema && PEDEM_LISTA.has(i.reply.sistema),
  );
  // "Não entendi": explica de novo por inteiro, em conversa, sem resumir a pergunta.
  const explicar =
    listar || itens.some((i) => i.reply.sistema === 'esclarecer_etapa');
  const pedidos: string[] = [];
  const referencias: string[] = [];
  const textos: string[] = [];
  const literais: string[] = [];
  const pontos: Point[] = [];
  const opcoes: string[] = [];
  const manter: string[] = [];
  let temLista = false;
  let chars = 0;
  let usaNome = false;
  let saudacao = false;
  let nomeObrigatorio = false;

  for (const { reply: r, spec } of itens) {
    const forma = r.forma;
    if (!spec) {
      // Resposta já verificada ou texto de ferramenta: não passa por reescrita.
      literais.push(r.texto);
      continue;
    }
    if (spec.modo === 'obrigatorio') {
      literais.push(
        forma
          ? [forma.corpo, numerada(forma.opcoes)].filter(Boolean).join('\n\n')
          : r.texto,
      );
      continue;
    }
    usaNome ||= !!spec.usaNome;
    const retoma = !!r.retomada && !explicar && !primeira;
    if (retoma || (spec.saudacao && !primeira && !explicar)) {
      const caminhos = (forma?.opcoes ?? []).map(semEnfeite).join('; ');
      pedidos.push(
        spec.saudacao && retoma
          ? `Voltar ao assunto com uma pergunta curta para descobrir o que o cliente precisa, sem listar tudo e sem se apresentar. O que você atende: ${caminhos}`
          : spec.saudacao
            ? 'Perguntar em uma frase curta se pode ajudar em mais alguma coisa, sem se apresentar de novo e sem listar opções.'
            : `Voltar ao que falta, em uma frase curta e natural, sem repetir a explicação. O que falta: ${spec.objetivo}`,
      );
      chars += 130;
      continue;
    }

    const { head, block } = forma
      ? { head: forma.corpo, block: '' }
      : splitBlock(spec, r.texto);
    if (block) literais.push(block);
    const instrucao = spec.modo === 'instrucao';
    const objetivo =
      spec.saudacao && primeira
        ? `${spec.objetivo} Obrigatório nesta primeira mensagem: dizer que é a Vera e o nome da loja, mesmo que o cliente já tenha perguntado algo.`
        : spec.saudacao
          ? 'Explicar de novo, sem cumprimentar nem se apresentar, com o que você pode ajudar.'
          : spec.objetivo;
    referencias.push(head, spec.objetivo);
    if (!instrucao) textos.push(head);
    pedidos.push(
      instrucao || !head
        ? objetivo
        : `${objetivo}\n   Informação correta (passe com as suas palavras, sem copiar as frases): "${semEnfeite(head).slice(0, 700)}"`,
    );
    if (primeira || !spec.saudacao) pontos.push(...spec.pontos);
    manter.push(...(spec.manter ?? []));
    if (!instrucao) manter.push(...numerosLongos(head));
    chars += spec.maxChars ?? 260;
    saudacao ||= !!spec.saudacao && primeira;
    nomeObrigatorio ||= !!spec.nomeObrigatorio;

    const lista = forma?.opcoes ?? [];
    if (lista.length) {
      // Etapa de opções: a mensagem também sai como opções (a IA escreve a abertura no seu estilo e
      // a lista numerada vai logo depois), para o cliente ver o formato da etapa e responder com o número.
      if (
        listar ||
        forma?.tipo !== undefined ||
        lista.length > MAX_OPCOES_EM_FRASE
      ) {
        literais.push(numerada(lista));
        temLista = true;
      } else {
        opcoes.push(...lista.filter((o) => !NAO_CITA(o)));
        chars += 45 * lista.length;
      }
    }
  }

  const literalAbre = !!itens[0] && !itens[0].spec;
  if (literalAbre)
    pedidos.unshift(
      'O texto fixo já respondeu ao que o cliente perguntou e vai antes da sua frase. Não repita nem comente a resposta: só continue a conversa.',
    );

  return {
    pedidos,
    referencia: referencias.join(' '),
    referenciaTextos: textos.join(' '),
    literais,
    opcoes,
    temLista,
    literalAbre,
    primeira,
    spec: {
      objetivo: pedidos.join(' '),
      pontos,
      manter,
      saudacao,
      usaNome,
      nomeObrigatorio,
      perguntar: opcoes.length > 0 || temLista,
      maxChars: Math.min(Math.max(chars, 160), 640),
    },
  };
}

const semAcento = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const PALAVRAS_VAZIAS = new Set(
  'tenho quero qual quais sobre para como minha meu mais nem uma informacoes informacao desejo gostaria'.split(
    ' ',
  ),
);

/** Palavras que identificam uma opção (basta uma aparecer no texto). */
export function palavrasDaOpcao(rotulo: string): string[] {
  return semAcento(rotulo)
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !PALAVRAS_VAZIAS.has(w));
}

/** O que dizer à atendente quando o revisor reprova: ela tenta uma vez mais. */
export function explicarReprovacao(motivo: string): string {
  const [tipo, detalhe] = motivo.split(':');
  const textos: Record<string, string> = {
    emojis_demais: 'Use no máximo um emoji.',
    muito_longo: 'Ficou comprida: encurte.',
    tom_de_menu: 'Não fale como menu: sem "digite", "selecione" ou "número".',
    elogio_inventado: 'Tire os elogios à loja.',
    perguntas_demais: 'Faça só uma pergunta.',
    reapresentou: 'Não se apresente de novo.',
    cumprimentou_de_novo: 'Não cumprimente de novo: vá direto ao assunto.',
    promessa_comercial:
      'Não fale de preço, desconto, garantia ou prazo; se precisar citar, diga que quem passa é o projetista.',
    numero_inventado: 'Tire os números que não estão na informação.',
    conteudo_proibido: 'Tire valores, links e e-mails.',
    copiou_opcoes: 'Não escreva a lista: o sistema insere.',
    repetiu_texto_fixo:
      'O texto fixo já traz essa informação: não repita, apenas continue a conversa.',
    copiou_texto:
      'Você copiou frases do texto de referência. Diga a mesma coisa com palavras suas, como numa conversa.',
    repetida: 'Diga de outro jeito: essa frase já foi usada.',
    pergunta_ausente: 'Termine com uma pergunta.',
    nome_ausente: 'Inclua o nome do cliente.',
    vazio: 'Escreva a mensagem.',
    opcao_ausente: `Faltou citar o caminho sobre "${detalhe}".`,
    ponto_ausente: `Faltou uma informação: a mensagem precisa ter a palavra "${detalhe}".`,
  };
  return textos[tipo] ?? 'Reescreva seguindo os limites.';
}

const ROBOTICO =
  /envie o n[uú]mero|digite|selecione|op[çc][ãa]o desejada|escolha uma das op[çc]|por gentileza|prosseguirmos/i;
const ELOGIO =
  /bem acess[ií]vel|alta qualidade|excelente|melhor(es)? (loja|atendimento|qualidade)/i;
const APRESENTACAO = /\b(sou a|aqui [ée] a|me chamo) vera\b/i;
const CUMPRIMENTO = /^\W*(oi|ol[aá]|bom dia|boa tarde|boa noite)\b/i;

const TRECHO_COPIADO = 8;

/** Oito palavras seguidas iguais ao texto de referência é cópia. Trechos com número são dados. */
export function copiouTexto(escrito: string, referencia: string): boolean {
  const palavras = (s: string) =>
    semAcento(s)
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  const ref = ` ${palavras(referencia).join(' ')} `;
  const p = palavras(escrito);
  for (let i = 0; i + TRECHO_COPIADO <= p.length; i++) {
    const trecho = p.slice(i, i + TRECHO_COPIADO).join(' ');
    if (!/\d/.test(trecho) && ref.includes(` ${trecho} `)) return true;
  }
  return false;
}

/** Revisor da resposta da atendente: as regras do Redator e o que é próprio de uma conversa. */
export function validarTurno(
  raw: WriterOutput | null,
  turno: Turno,
  c: {
    nome?: string | null;
    recentBot: string[];
    ultimaCliente?: string;
  },
): WriterVerdict {
  const verdict = validateWriterOutput(raw, {
    spec: turno.spec,
    reference: turno.referencia,
    block: turno.literais.join('\n\n'),
    nome: c.nome,
    recentBot: c.recentBot,
    conversa: true,
  });
  if (!verdict.ok) return verdict;

  const escrito = [verdict.abertura, verdict.fechamento]
    .filter(Boolean)
    .join(' ');
  if (ROBOTICO.test(escrito)) return { ok: false, motivo: 'tom_de_menu' };
  // "Quero agendar 📝" solto no fim: é o rótulo de uma opção, não uma frase da conversa.
  if (
    !turno.literais.length &&
    verdict.fechamento &&
    verdict.fechamento.length < 30 &&
    !/[.!?]/.test(verdict.fechamento)
  )
    return { ok: false, motivo: 'copiou_opcoes' };
  if (ELOGIO.test(escrito)) return { ok: false, motivo: 'elogio_inventado' };
  if (copiouTexto(escrito, turno.referenciaTextos))
    return { ok: false, motivo: 'copiou_texto' };
  if ((escrito.match(/\?/g) ?? []).length > 2)
    return { ok: false, motivo: 'perguntas_demais' };

  if (!turno.primeira) {
    if (APRESENTACAO.test(escrito))
      return { ok: false, motivo: 'reapresentou' };
    if (CUMPRIMENTO.test(escrito) && !CUMPRIMENTO.test(c.ultimaCliente ?? ''))
      return { ok: false, motivo: 'cumprimentou_de_novo' };
  }

  if (
    turno.literais.some((l) =>
      numerosLongos(l).some((n) => escrito.includes(n)),
    )
  )
    return { ok: false, motivo: 'repetiu_texto_fixo' };

  const alvo = semAcento(escrito);
  for (const opcao of turno.opcoes) {
    const palavras = palavrasDaOpcao(opcao);
    if (palavras.length && !palavras.some((w) => alvo.includes(w)))
      return { ok: false, motivo: `opcao_ausente:${palavras[0]}` };
  }
  return verdict;
}

/** Uma mensagem só; duas apenas quando o conjunto ficaria comprido demais para uma bolha. */
export function bolhasDoTurno(
  out: { abertura: string; fechamento: string | null },
  literais: string[],
  literalAbre = false,
): string[] {
  if (literalAbre) {
    const texto = [...literais, out.abertura, out.fechamento]
      .filter((x) => x && x.trim())
      .join('\n\n');
    return [texto];
  }
  const inteiro = [out.abertura, ...literais, out.fechamento]
    .filter((x) => x && x.trim())
    .join(literais.length ? '\n\n' : ' ');
  if (inteiro.length <= 700 || !out.abertura.trim() || !literais.length)
    return [inteiro];
  return [
    out.abertura,
    [...literais, out.fechamento].filter(Boolean).join('\n\n'),
  ];
}

export type { NodeType };
