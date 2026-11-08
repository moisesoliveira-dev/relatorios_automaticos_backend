import { FlowDoc, FlowNode, LIMITS, NodeType, WAITING } from './flow.types';
import type { ToolCatalog } from './tool.types';
import { placeholdersOf } from './text';

const NODE_TYPES: NodeType[] = [
  'mensagem',
  'pergunta',
  'opcoes',
  'confirmacao',
  'multipla',
  'arquivos',
  'ferramenta',
  'condicao',
  'ir_para',
  'encaminhar',
  'fim',
];

/** Variável criada pela etapa (quando houver). */
export const guardaVariavel = (n: FlowNode): string | null =>
  ((n.tipo === 'pergunta' || n.tipo === 'multipla') && n.variavel) ||
  ((n.tipo === 'opcoes' ||
    n.tipo === 'confirmacao' ||
    n.tipo === 'ferramenta') &&
    n.variavel)
    ? (n as { variavel: string }).variavel
    : null;

export const sucessores = (n: FlowNode): Array<string | null | undefined> => {
  switch (n.tipo) {
    case 'opcoes':
    case 'confirmacao':
      return n.opcoes.map((o) => o.proximo);
    case 'condicao':
      return [...n.regras.map((r) => r.proximo), n.senao];
    case 'ferramenta':
      return [n.proximo, n.falha, n.semOpcoes];
    case 'encaminhar':
    case 'fim':
    case 'ir_para':
      return [];
    default:
      return [n.proximo];
  }
};

export interface Contexto {
  /** Respostas já guardadas, em TODOS os caminhos que chegam à etapa. */
  vars: Set<string>;
  /** A pasta do cliente no Drive já existe em todos esses caminhos. */
  pasta: boolean;
}

/**
 * Para cada etapa alcançável a partir do início, o que já aconteceu antes dela (a interseção de todos
 * os caminhos). Etapas fora do mapa não são alcançadas por ninguém.
 */
export function contextos(
  flow: FlowDoc,
  tools: ToolCatalog,
  inicial: Contexto = { vars: new Set(), pasta: false },
): Map<string, Contexto> {
  const entradas = new Map<string, Contexto>();
  if (!flow.nos.length) return entradas;
  const ids = new Set(flow.nos.map((n) => n.id));
  const byId = new Map(flow.nos.map((n) => [n.id, n]));
  const inicio = flow.nos[0].id;
  entradas.set(inicio, { vars: new Set(inicial.vars), pasta: inicial.pasta });
  const fila = [inicio];
  for (let guarda = 0; fila.length && guarda < 5000; guarda++) {
    const n = byId.get(fila.shift()!)!;
    const ent = entradas.get(n.id)!;
    const tool = n.tipo === 'ferramenta' ? tools.get(n.ferramenta) : undefined;
    const saida: Contexto = {
      vars: new Set(ent.vars),
      pasta: ent.pasta || !!tool?.produz?.pasta,
    };
    const v = guardaVariavel(n);
    if (v) saida.vars.add(v);
    for (const extra of tool?.produz?.vars ?? []) saida.vars.add(extra);
    if (n.tipo === 'ferramenta')
      for (const ps of tool?.params ?? [])
        if (
          ps.define &&
          typeof n.params?.[ps.key] === 'string' &&
          n.params[ps.key]
        )
          saida.vars.add(String(n.params[ps.key]));
    for (const s of sucessores(n)) {
      if (!s || !ids.has(s)) continue;
      const atual = entradas.get(s);
      if (!atual) {
        entradas.set(s, { vars: new Set(saida.vars), pasta: saida.pasta });
        fila.push(s);
        continue;
      }
      const vars = new Set([...atual.vars].filter((x) => saida.vars.has(x)));
      const pasta = atual.pasta && saida.pasta;
      if (vars.size !== atual.vars.size || pasta !== atual.pasta) {
        entradas.set(s, { vars, pasta });
        fila.push(s);
      }
    }
  }
  return entradas;
}

/** Devolve a lista de problemas do fluxo (vazia = válido). Não altera o fluxo. */
/** Fluxos que chegam a este, direta ou indiretamente, por "Ir para outro fluxo". */
export function fluxosAnteriores(id: string, todos: FlowDoc[]): Set<string> {
  const out = new Set<string>();
  const fila = [id];
  while (fila.length) {
    const alvo = fila.pop()!;
    for (const f of todos) {
      if (f.id === id || out.has(f.id)) continue;
      if (f.nos.some((n) => n.tipo === 'ir_para' && n.fluxo === alvo)) {
        out.add(f.id);
        fila.push(f.id);
      }
    }
  }
  return out;
}

export function checkFlow(
  flow: FlowDoc,
  tools: ToolCatalog,
  todos: FlowDoc[] = [flow],
): string[] {
  const e: string[] = [];
  const at = (n: FlowNode) => `Etapa “${n.titulo || n.id}”`;
  if (!flow.nos.length) return ['O fluxo precisa ter ao menos uma etapa.'];
  if (flow.nos.length > LIMITS.nos)
    e.push(`O fluxo aceita no máximo ${LIMITS.nos} etapas.`);
  const ids = new Set(flow.nos.map((n) => n.id));
  if (ids.size !== flow.nos.length)
    e.push('Há etapas com identificador repetido.');
  // Variáveis conhecidas: as deste fluxo e as dos outros (podem chegar por "Ir para outro fluxo").
  const varsDe = (f: FlowDoc): Set<string> => {
    const out = new Set<string>();
    for (const n of f.nos) {
      const v = guardaVariavel(n);
      if (v) out.add(v);
      if (n.tipo === 'ferramenta') {
        const tool = tools.get(n.ferramenta);
        for (const extra of tool?.produz?.vars ?? []) out.add(extra);
        for (const ps of tool?.params ?? [])
          if (
            ps.define &&
            typeof n.params?.[ps.key] === 'string' &&
            n.params[ps.key]
          )
            out.add(String(n.params[ps.key]));
        if (n.variavel) out.add(`${n.variavel}_rotulo`);
      }
      if (n.tipo === 'multipla' && n.variavel) out.add(`${n.variavel}_ids`);
    }
    return out;
  };
  const proprias = varsDe(flow);
  const vars = new Set<string>(['nome', ...proprias]);
  const externas = new Set<string>();
  // Só valem as variáveis de fluxos que realmente levam a este (por "Ir para outro fluxo").
  const anteriores = fluxosAnteriores(flow.id, todos);
  for (const f of todos)
    if (anteriores.has(f.id))
      for (const v of varsDe(f)) {
        vars.add(v);
        externas.add(v);
      }
  const dest = (
    n: FlowNode,
    to: string | null | undefined,
    where: string,
    obrigatorio = true,
  ) => {
    if (!to) {
      if (obrigatorio)
        e.push(`${at(n)}: escolha para onde o cliente vai ${where}.`);
    } else if (!ids.has(to))
      e.push(`${at(n)}: o destino ${where} não existe mais.`);
  };
  const checkVar = (
    n: FlowNode,
    v: string | undefined,
    obrigatoria: boolean,
  ) => {
    if (v === undefined || v === '') {
      if (obrigatoria)
        e.push(
          `${at(n)}: dê um nome à variável que guarda a resposta (ex.: nome, bairro).`,
        );
      return;
    }
    if (!LIMITS.variavel.test(v))
      e.push(
        `${at(n)}: a variável deve começar com letra minúscula e usar só letras, números e _.`,
      );
  };

  for (const n of flow.nos) {
    if (!NODE_TYPES.includes(n.tipo)) {
      e.push(`${at(n)}: tipo desconhecido.`);
      continue;
    }
    if (!n.titulo?.trim()) e.push('Uma etapa está sem nome.');
    const texto = ((n as { texto?: string }).texto ?? '').trim();
    const needsText = [
      'mensagem',
      'opcoes',
      'confirmacao',
      'pergunta',
      'multipla',
      'arquivos',
    ].includes(n.tipo);
    if (needsText && !texto) e.push(`${at(n)}: escreva o texto da mensagem.`);
    if (texto.length > LIMITS.texto)
      e.push(`${at(n)}: o texto passa de ${LIMITS.texto} caracteres.`);
    if (n.spec?.modo === 'instrucao' && !n.spec.objetivo?.trim())
      e.push(`${at(n)}: escreva a instrução para a IA.`);
    for (const v of placeholdersOf(`${texto} ${n.spec?.objetivo ?? ''}`))
      if (!vars.has(v))
        e.push(
          `${at(n)}: {${v}} não existe neste fluxo nem nos fluxos que levam até ele (crie uma pergunta com esse nome ou ligue o fluxo com "Ir para outro fluxo").`,
        );

    switch (n.tipo) {
      case 'mensagem':
      case 'pergunta':
      case 'arquivos':
      case 'multipla':
        dest(n, n.proximo, 'depois desta etapa');
        break;
      case 'opcoes':
      case 'confirmacao': {
        const o = n.opcoes ?? [];
        if (n.tipo === 'confirmacao' && o.length !== 2)
          e.push(`${at(n)}: a confirmação tem sempre duas opções (Sim e Não).`);
        else if (
          n.tipo === 'opcoes' &&
          (o.length < 2 || o.length > LIMITS.opcoes)
        )
          e.push(`${at(n)}: use de 2 a ${LIMITS.opcoes} opções.`);
        o.forEach((x, i) => {
          if (!x.rotulo?.trim() || x.rotulo.length > LIMITS.rotulo)
            e.push(
              `${at(n)}: a opção ${i + 1} precisa de um texto de até ${LIMITS.rotulo} caracteres.`,
            );
          dest(n, x.proximo, `na opção ${i + 1}`);
        });
        checkVar(n, n.variavel, false);
        break;
      }
      case 'ferramenta': {
        const tool = tools.get(n.ferramenta);
        if (!tool) {
          e.push(`${at(n)}: escolha uma ferramenta.`);
          break;
        }
        for (const ps of tool.params) {
          const v = n.params?.[ps.key];
          if (ps.obrigatorio && (v === undefined || v === null || v === ''))
            e.push(`${at(n)}: preencha “${ps.label}”.`);
          if (
            ps.type === 'variavel' &&
            typeof v === 'string' &&
            v &&
            !LIMITS.variavel.test(v)
          )
            e.push(
              `${at(n)}: “${ps.label}” deve ser um nome de variável válido.`,
            );
          if (ps.template && typeof v === 'string')
            for (const pv of placeholdersOf(v))
              if (!vars.has(pv))
                e.push(
                  `${at(n)}: {${pv}} em “${ps.label}” não é uma variável deste fluxo.`,
                );
        }
        dest(n, n.proximo, 'depois desta etapa');
        dest(n, n.falha, 'se a ferramenta falhar', false);
        dest(n, n.semOpcoes, 'quando não houver opções', false);
        if (tool.modo === 'escolha') checkVar(n, n.variavel, true);
        else checkVar(n, n.variavel, false);
        break;
      }
      case 'condicao':
        if (!n.regras?.length) e.push(`${at(n)}: adicione ao menos uma regra.`);
        (n.regras ?? []).forEach((r, i) => {
          if (!r.variavel || !vars.has(r.variavel))
            e.push(
              `${at(n)}: a regra ${i + 1} usa uma variável que não existe.`,
            );
          dest(n, r.proximo, `na regra ${i + 1}`);
        });
        dest(n, n.senao, 'quando nenhuma regra valer');
        break;
      case 'ir_para': {
        const alvo = todos.find((f) => f.id === n.fluxo);
        if (!alvo) e.push(`${at(n)}: escolha o fluxo de destino.`);
        else if (alvo.id === flow.id)
          e.push(`${at(n)}: um fluxo não pode ir para ele mesmo.`);
        break;
      }
    }
    if (n.tipo === 'pergunta') checkVar(n, n.variavel, true);
    if (n.tipo === 'multipla') {
      checkVar(n, n.variavel, true);
      if (!n.itens?.length || n.itens.length > LIMITS.itens)
        e.push(`${at(n)}: use de 1 a ${LIMITS.itens} itens.`);
      (n.itens ?? []).forEach((it, i) => {
        if (!it.rotulo?.trim() || it.rotulo.length > LIMITS.rotulo)
          e.push(
            `${at(n)}: o item ${i + 1} precisa de um texto de até ${LIMITS.rotulo} caracteres.`,
          );
      });
    }
    if (n.tipo === 'arquivos' && (n.minimo ?? 0) > 20)
      e.push(`${at(n)}: o mínimo de arquivos é 20.`);
  }

  // Regras de ORDEM: o que cada etapa precisa que já tenha acontecido em todos os caminhos que chegam nela.
  const ctx = contextos(flow, tools);
  for (const n of flow.nos) {
    const c = ctx.get(n.id);
    if (!c) {
      e.push(
        `${at(n)}: nenhum caminho chega até esta etapa. Ligue-a a uma etapa anterior ou exclua.`,
      );
      continue;
    }
    const texto = (n as { texto?: string }).texto ?? '';
    for (const v of placeholdersOf(texto))
      if (v !== 'nome' && proprias.has(v) && !externas.has(v) && !c.vars.has(v))
        e.push(
          `${at(n)}: {${v}} ainda não foi respondida quando esta etapa roda. Coloque a pergunta antes.`,
        );
    if (n.tipo === 'ferramenta') {
      const tool = tools.get(n.ferramenta);
      for (const v of tool?.requer?.vars ?? [])
        if (!c.vars.has(v) && !(externas.has(v) && !proprias.has(v)))
          e.push(
            `${at(n)}: “${tool!.label}” precisa de {${v}} respondida antes. Coloque a pergunta antes.`,
          );
      if (tool?.requer?.pasta && !c.pasta)
        e.push(
          `${at(n)}: “${tool.label}” precisa da pasta do cliente criada antes (ferramenta “Drive: criar a pasta do cliente”).`,
        );
    }
    if (n.tipo === 'condicao')
      for (const r of n.regras ?? [])
        if (
          r.variavel &&
          proprias.has(r.variavel) &&
          !externas.has(r.variavel) &&
          !c.vars.has(r.variavel) &&
          r.variavel !== 'nome'
        )
          e.push(
            `${at(n)}: a variável {${r.variavel}} ainda não foi respondida quando esta etapa roda.`,
          );
  }
  if (
    !flow.nos.some(
      (n) =>
        n.tipo === 'encaminhar' || n.tipo === 'fim' || n.tipo === 'ir_para',
    )
  )
    e.push(
      'O fluxo precisa terminar em “Encaminhar a um atendente”, “Encerrar” ou “Ir para outro fluxo”.',
    );

  // Ciclo só de etapas automáticas nunca espera o cliente: travaria a conversa.
  const auto = new Map(
    flow.nos.filter((n) => n.tipo === 'mensagem').map((n) => [n.id, n.proximo]),
  );
  for (const start of auto.keys()) {
    const seen = new Set<string>();
    let cur: string | null | undefined = start;
    while (cur && auto.has(cur)) {
      if (seen.has(cur)) {
        e.push('Há um ciclo de mensagens sem pergunta no meio.');
        return [...new Set(e)];
      }
      seen.add(cur);
      cur = auto.get(cur);
    }
  }
  return [...new Set(e)];
}

/** Problemas do conjunto de fluxos (papéis únicos, destinos de "ir para"). */
export function checkDoc(fluxos: FlowDoc[]): string[] {
  const e: string[] = [];
  const entradas = fluxos.filter((f) => f.ativo && f.papel === 'entrada');
  if (!entradas.length)
    e.push(
      'Marque um fluxo ativo como “Início”: é por ele que todo cliente novo começa.',
    );
  if (entradas.length > 1) e.push('Só um fluxo pode ser o “Início”.');
  if (fluxos.filter((f) => f.ativo && f.papel === 'reconhecimento').length > 1)
    e.push('Só um fluxo pode ser o de “Cliente conhecido”.');
  const ids = new Set<string>();
  for (const f of fluxos) {
    if (ids.has(f.id)) e.push(`Há dois fluxos com o identificador “${f.id}”.`);
    ids.add(f.id);
  }
  for (const f of fluxos)
    for (const n of f.nos)
      if (n.tipo === 'ir_para') {
        const alvo = fluxos.find((x) => x.id === n.fluxo);
        if (alvo && !alvo.ativo)
          e.push(
            `${f.nome}: a etapa “${n.titulo}” vai para o fluxo “${alvo.nome}”, que está desativado.`,
          );
      }
  return e;
}

export { WAITING };
