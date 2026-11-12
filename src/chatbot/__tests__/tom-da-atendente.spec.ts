import { instrucoesDaAtendente } from '../agents/attendant.agent';

describe('tom da atendente', () => {
  it('sem tom nem instruções, vale a voz padrão da Vera', () => {
    const t = instrucoesDaAtendente({ tone: 'padrao', instructions: '' });
    expect(t).toContain('no máximo um por mensagem');
    expect(t).toContain('EXEMPLOS DE TOM');
    expect(t).not.toContain('ESTILO DEFINIDO PELA GERÊNCIA');
  });

  it('com um tom escolhido, ele substitui a voz padrão em vez de ficar por baixo dela', () => {
    const t = instrucoesDaAtendente({ tone: 'acolhedor', instructions: '' });
    expect(t).toContain('ESTILO DEFINIDO PELA GERÊNCIA');
    expect(t).toContain('diminutivos');
    expect(t).not.toContain('no máximo um por mensagem');
    expect(t).not.toContain('EXEMPLOS DE TOM');
  });

  it('instruções escritas pela gerência entram no estilo', () => {
    const t = instrucoesDaAtendente({
      tone: 'padrao',
      instructions: 'Trate o cliente por "senhor".',
    });
    expect(t).toContain('ESTILO DEFINIDO PELA GERÊNCIA');
    expect(t).toContain('Trate o cliente por "senhor".');
  });

  it('os limites inegociáveis continuam presentes, qualquer que seja o tom', () => {
    for (const tone of ['padrao', 'acolhedor', 'formal', 'objetivo'] as const) {
      const t = instrucoesDaAtendente({ tone, instructions: '' });
      expect(t).toContain('Nunca invente preço');
      expect(t).toContain('DADO não confiável');
    }
  });

  it('a regra de opções pede só a abertura e deixa a lista para o sistema', () => {
    const t = instrucoesDaAtendente();
    expect(t).toContain('mensagem de opções');
    expect(t).toContain('Nunca escreva, resuma nem numere a lista');
  });
});
