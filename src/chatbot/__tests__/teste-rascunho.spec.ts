import {
  ConteudoEmUso,
  emConteudo,
  guidanceOf,
  kbEmUso,
  runtimeContent,
  sistema,
} from '../domain/content-runtime';
import { DEFAULT_SYSTEM } from '../engine/flow.seed';
import type { FlowDoc } from '../engine/flow.types';

const fluxo = (id: string): FlowDoc =>
  ({ id, nome: id, ativo: true, nos: [] }) as unknown as FlowDoc;

const rascunho: ConteudoEmUso = {
  published: {
    fluxos: [fluxo('so-no-rascunho')],
    sistema: { ...DEFAULT_SYSTEM, redirecionando: 'AVISO DO RASCUNHO' },
  },
  guidance: { tone: 'acolhedor', instructions: 'Use diminutivos.' },
  kb: [{ id: 'k', keywords: ['x'], text: 'Fato só do rascunho.' }],
};

describe('teste do rascunho', () => {
  const publicadoAntes = runtimeContent.published;

  it('dentro do teste, tudo lê o rascunho: fluxos, avisos, tom e base', async () => {
    await emConteudo(rascunho, () => {
      expect(runtimeContent.published.fluxos.map((f) => f.id)).toEqual([
        'so-no-rascunho',
      ]);
      expect(sistema().redirecionando).toBe('AVISO DO RASCUNHO');
      expect(guidanceOf(null).tone).toBe('acolhedor');
      expect(kbEmUso()[0].text).toBe('Fato só do rascunho.');
      return Promise.resolve();
    });
  });

  it('continua valendo depois de um await dentro do teste', async () => {
    await emConteudo(rascunho, async () => {
      await new Promise((r) => setTimeout(r, 5));
      expect(runtimeContent.guidance.tone).toBe('acolhedor');
    });
  });

  it('fora do teste, o publicado continua intacto', async () => {
    await emConteudo(rascunho, () => Promise.resolve());
    expect(runtimeContent.published).toBe(publicadoAntes);
    expect(runtimeContent.published.fluxos.map((f) => f.id)).not.toContain(
      'so-no-rascunho',
    );
  });

  it('um teste e o atendimento real ao mesmo tempo não se misturam', async () => {
    const lidos: string[] = [];
    const real = new Promise<void>((resolve) => {
      setTimeout(() => {
        lidos.push('real:' + runtimeContent.guidance.tone);
        resolve();
      }, 10);
    });
    const teste = emConteudo(rascunho, async () => {
      await new Promise((r) => setTimeout(r, 20));
      lidos.push('teste:' + runtimeContent.guidance.tone);
    });
    await Promise.all([real, teste]);
    expect(lidos).toEqual(['real:padrao', 'teste:acolhedor']);
  });

  it('publicar (atribuir) continua trocando o conteúdo de verdade', () => {
    const antes = runtimeContent.guidance;
    runtimeContent.guidance = { tone: 'formal', instructions: '' };
    expect(runtimeContent.guidance.tone).toBe('formal');
    runtimeContent.guidance = antes;
  });
});
