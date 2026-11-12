import { custoUsd, precoDoModelo, PRECOS_PADRAO } from '../domain/ai-pricing';
import { ChatbotHumanizerService } from '../services/chatbot-humanizer.service';
import type { FlowDoc, Reply } from '../engine/flow.types';

describe('preços da OpenAI', () => {
  it('acha o modelo pelo maior prefixo (versões datadas)', () => {
    expect(precoDoModelo('gpt-4o-mini-2024-07-18', PRECOS_PADRAO)?.chave).toBe(
      'gpt-4o-mini',
    );
    expect(precoDoModelo('gpt-4o-2024-08-06', PRECOS_PADRAO)?.chave).toBe(
      'gpt-4o',
    );
    expect(precoDoModelo('gpt-4.1-mini', PRECOS_PADRAO)?.chave).toBe(
      'gpt-4.1-mini',
    );
  });

  it('modelo desconhecido não tem preço (a tela avisa em vez de chutar)', () => {
    expect(precoDoModelo('modelo-novo-x', PRECOS_PADRAO)).toBeNull();
  });

  it('calcula o custo separando entrada, cache e saída', () => {
    const p = PRECOS_PADRAO['gpt-4o-mini'];
    // 1M de entrada (400k em cache) + 1M de saída
    const c = custoUsd(
      { entrada: 1_000_000, cache: 400_000, saida: 1_000_000 },
      p,
    );
    expect(c).toBeCloseTo(0.6 * 0.15 + 0.4 * 0.075 + 0.6, 6);
  });

  it('cache maior que a entrada não gera custo negativo', () => {
    const p = PRECOS_PADRAO['gpt-4o-mini'];
    expect(
      custoUsd({ entrada: 10, cache: 50, saida: 0 }, p),
    ).toBeGreaterThanOrEqual(0);
  });
});

describe('prévia do rascunho usa o tom e a reescrita do fluxo em edição', () => {
  const rascunho: FlowDoc = {
    id: 'novo',
    nome: 'Novo',
    ativo: true,
    nos: [],
    guidance: { tone: 'acolhedor', instructions: '' },
    reescrever: true,
  } as unknown as FlowDoc;

  function humanizer() {
    const pedidos: Array<{ guidance?: { tone: string } }> = [];
    const svc = new ChatbotHumanizerService(
      { chatbot: { humanize: true, writerDailyLimit: 50 } } as never,
      { enabled: true, breakerOpen: false } as never,
      {
        run: (c: { guidance?: { tone: string } }) => {
          pedidos.push(c);
          return Promise.resolve({
            abertura: 'Oi! Me conta, qual é o seu nome?',
            fechamento: null,
          });
        },
      } as never,
    );
    return { svc, pedidos };
  }

  const reply: Reply = { texto: 'Qual é o seu nome?', nodeId: 'n1' };
  const ctx = { contactId: -1, nome: null, history: [] };

  it('com o fluxo do rascunho, o Redator recebe o tom acolhedor', async () => {
    const { svc, pedidos } = humanizer();
    const out = await svc.compose(ctx, [reply], 'novo', rascunho);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].guidance?.tone).toBe('acolhedor');
    expect(out.join(' ')).toContain('Me conta');
  });

  it('sem o fluxo (nada publicado com esse id), o texto vai como está', async () => {
    const { svc, pedidos } = humanizer();
    const out = await svc.compose(ctx, [reply], 'novo');
    expect(pedidos).toHaveLength(0);
    expect(out).toEqual(['Qual é o seu nome?']);
  });
});
