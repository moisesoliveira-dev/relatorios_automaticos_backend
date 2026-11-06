import type { ToolDefinition } from '../engine/tool.types';

/** Ferramentas que mexem só na própria conversa (sem integração externa). */
export function conversaTools(): ToolDefinition[] {
  const definir: ToolDefinition = {
    key: 'conversa.definir',
    label: 'Guardar um valor',
    descricao:
      'Grava um valor numa variável da conversa (pode citar outras variáveis com {chaves}). Útil para marcar um caminho e decidir depois com “Condição”.',
    grupo: 'Conversa',
    modo: 'acao',
    params: [
      {
        key: 'variavel',
        label: 'Variável',
        type: 'variavel',
        obrigatorio: true,
        define: true,
      },
      {
        key: 'valor',
        label: 'Valor',
        type: 'texto',
        obrigatorio: true,
        template: true,
      },
    ],
    disponivel: () => true,
    executar(ctx) {
      return Promise.resolve({
        ok: true,
        vars: {
          [String(ctx.params['variavel'])]: String(ctx.params['valor'] ?? ''),
        },
      });
    },
    simular(ctx) {
      return {
        ok: true,
        vars: {
          [String(ctx.params['variavel'])]: String(ctx.params['valor'] ?? ''),
        },
      };
    },
  };

  return [definir];
}
