import { ChatbotHumanizerService } from '../services/chatbot-humanizer.service';
import { checkFlow, fluxosAnteriores } from '../engine/flow.validate';
import { startFlow, stepFlow, Published } from '../engine/flow.engine';
import { DEFAULT_SYSTEM } from '../engine/flow.seed';
import { FlowDoc, Reply } from '../engine/flow.types';
import { ToolCatalog } from '../engine/tool.types';

/** Redator de mentira: guarda o que recebeu e devolve o texto combinado. */
function humanizer(saida: { abertura: string; fechamento: string | null }) {
  const pedidos: any[] = [];
  const svc = new ChatbotHumanizerService(
    { chatbot: { humanize: true, writerDailyLimit: 50 } } as never,
    { enabled: true, breakerOpen: false } as never,
    {
      run: async (c: any) => {
        pedidos.push(c);
        return saida;
      },
    } as never,
  );
  return { svc, pedidos };
}
const ctx = { contactId: 1, nome: null, history: [] };

describe('como a IA trata a mensagem da etapa', () => {
  const texto = 'Traga o documento original no dia da visita.';

  it('texto obrigatório: vai literal, a IA só escreve em volta', async () => {
    const { svc, pedidos } = humanizer({
      abertura: 'Combinado, só um detalhe:',
      fechamento: null,
    });
    const r: Reply = {
      texto,
      nodeId: 'n',
      spec: { modo: 'obrigatorio', objetivo: 'Lembrar do documento' },
    };
    const out = (await svc.compose(ctx, [r])).join('\n');
    expect(out).toContain(texto);
    expect(out).toContain('Combinado');
    expect(pedidos[0].block).toBe(texto);
  });

  it('só instrução: a IA escreve a partir da instrução e não vê o texto de reserva', async () => {
    const { svc, pedidos } = humanizer({
      abertura: 'Me conta qual o melhor dia pra você?',
      fechamento: null,
    });
    const r: Reply = {
      texto: 'TEXTO DE RESERVA',
      nodeId: 'n',
      spec: { modo: 'instrucao', objetivo: 'Perguntar o melhor dia' },
    };
    const out = await svc.compose(ctx, [r]);
    expect(out.join(' ')).toContain('melhor dia');
    expect(out.join(' ')).not.toContain('RESERVA');
    expect(pedidos[0].reference).toBe('Perguntar o melhor dia');
  });

  it('só instrução com a IA reprovada ou fora do ar: usa o texto de reserva', async () => {
    const { svc } = humanizer({ abertura: 'Custa R$ 500', fechamento: null });
    const r: Reply = {
      texto: 'TEXTO DE RESERVA',
      nodeId: 'n',
      spec: { modo: 'instrucao', objetivo: 'Perguntar' },
    };
    expect(await svc.compose(ctx, [r])).toEqual(['TEXTO DE RESERVA']);
  });

  it('texto obrigatório com a IA reprovada: o texto continua indo', async () => {
    const { svc } = humanizer({ abertura: 'Custa R$ 500', fechamento: null });
    const r: Reply = { texto, nodeId: 'n', spec: { modo: 'obrigatorio' } };
    expect((await svc.compose(ctx, [r])).join(' ')).toContain(texto);
  });

  it('a instrução aceita {variaveis} do cliente', () => {
    const f: FlowDoc = {
      id: 'f',
      nome: 'F',
      descricao: '',
      ativo: true,
      papel: 'entrada',
      nos: [
        {
          id: 'a',
          tipo: 'pergunta',
          titulo: 'Bairro',
          texto: 'Bairro?',
          variavel: 'bairro',
          proximo: 'b',
        },
        {
          id: 'b',
          tipo: 'mensagem',
          titulo: 'M',
          texto: 'reserva',
          proximo: 'c',
          spec: { modo: 'instrucao', objetivo: 'Comentar sobre {bairro}' },
        },
        { id: 'c', tipo: 'encaminhar', titulo: 'E' },
      ],
    } as FlowDoc;
    const p: Published = { fluxos: [f], sistema: { ...DEFAULT_SYSTEM } };
    const r = stepFlow(
      p,
      startFlow(p, 'f').state!,
      { kind: 'valor', valor: 'Adrianópolis' },
      { maxInvalid: 3 },
    );
    const msg = r.replies.find((x) => x.nodeId === 'b')!;
    expect(msg.spec?.objetivo).toBe('Comentar sobre Adrianópolis');
  });
});

describe('variáveis entre fluxos', () => {
  const catalog: ToolCatalog = { list: () => [], get: () => undefined };
  const fluxo = (id: string, nos: any[]): FlowDoc =>
    ({ id, nome: id, descricao: '', ativo: true, nos }) as FlowDoc;
  const a = fluxo('a', [
    {
      id: 'p',
      tipo: 'pergunta',
      titulo: 'Cidade',
      texto: 'Cidade?',
      variavel: 'cidade',
      proximo: 'i',
    },
    { id: 'i', tipo: 'ir_para', titulo: 'Vai', fluxo: 'b' },
  ]);
  const b = fluxo('b', [
    {
      id: 'm',
      tipo: 'mensagem',
      titulo: 'M',
      texto: 'Atendemos {cidade}!',
      proximo: 'e',
    },
    { id: 'e', tipo: 'encaminhar', titulo: 'E' },
  ]);
  const solto = fluxo('solto', [
    {
      id: 'm',
      tipo: 'mensagem',
      titulo: 'M',
      texto: 'Oi {cidade}',
      proximo: 'e',
    },
    { id: 'e', tipo: 'encaminhar', titulo: 'E' },
  ]);

  it('o fluxo seguinte usa a variável do anterior, e o valor chega de verdade', () => {
    expect(checkFlow(b, catalog, [a, b])).toEqual([]);
    const p: Published = { fluxos: [a, b], sistema: { ...DEFAULT_SYSTEM } };
    const r = stepFlow(
      p,
      startFlow(p, 'a').state!,
      { kind: 'valor', valor: 'Manaus' },
      { maxInvalid: 3 },
    );
    expect(r.replies.map((x) => x.texto)).toContain('Atendemos Manaus!');
  });

  it('um fluxo que não recebe de outro não pode citar a variável dele', () => {
    expect(checkFlow(solto, catalog, [a, b, solto]).join(' ')).toContain(
      'não existe neste fluxo',
    );
  });

  it('encontra os fluxos anteriores, inclusive indiretos e com ciclos', () => {
    const c = fluxo('c', [
      { id: 'i', tipo: 'ir_para', titulo: 'v', fluxo: 'a' },
    ]);
    const d = fluxo('d', [
      { id: 'i', tipo: 'ir_para', titulo: 'v', fluxo: 'c' },
    ]);
    expect([...fluxosAnteriores('b', [a, b, c, d])].sort()).toEqual([
      'a',
      'c',
      'd',
    ]);
    const x = fluxo('x', [
      { id: 'i', tipo: 'ir_para', titulo: 'v', fluxo: 'y' },
    ]);
    const y = fluxo('y', [
      { id: 'i', tipo: 'ir_para', titulo: 'v', fluxo: 'x' },
    ]);
    expect([...fluxosAnteriores('x', [x, y])]).toEqual(['y']);
  });
});
