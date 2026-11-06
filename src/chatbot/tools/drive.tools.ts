import type { ToolDefinition } from '../engine/tool.types';
import type { ChatbotDriveService } from '../services/chatbot-drive.service';

/** Ferramentas do Google Drive: pasta do cliente e arquivo de respostas. */
export function driveTools(drive: ChatbotDriveService): ToolDefinition[] {
  const indisponivel = () =>
    'Configure a pasta raiz do Drive em Ajustes (CHATBOT_DRIVE_ROOT_FOLDER_ID).';

  const criarPasta: ToolDefinition = {
    key: 'drive.criar_pasta',
    label: 'Drive: criar a pasta do cliente',
    descricao:
      'Cria (ou reaproveita) a pasta do cliente no Google Drive, em ano/mês/ANDAMENTO. Precisa do nome do cliente perguntado antes. Os arquivos que ele enviar depois vão para essa pasta.',
    grupo: 'Drive',
    modo: 'acao',
    params: [
      {
        key: 'modo',
        label: 'Se a pasta não existir',
        type: 'escolha',
        opcoes: [
          { value: 'criar', label: 'Criar a pasta' },
          { value: 'existente', label: 'Não criar (só usar se já existir)' },
        ],
        padrao: 'criar',
      },
    ],
    requer: { vars: ['nome'] },
    produz: { pasta: true },
    disponivel: () => drive.enabled,
    indisponivelPorque: indisponivel,
    async executar(ctx) {
      const nome = ctx.state.vars['nome'] || ctx.conv.nome;
      if (!nome) return { ok: false, motivo: 'sem_nome' };
      const criar = ctx.params['modo'] !== 'existente';
      const pasta = await drive.ensureClientFolder(
        ctx.conv.ticketId,
        nome,
        new Date(),
        criar,
      );
      if (!pasta)
        return criar
          ? { ok: false, motivo: 'drive_indisponivel' }
          : { ok: true };
      return { ok: true, conv: { driveFolderId: pasta } };
    },
    simular: () => ({ ok: true, conv: { driveFolderId: 'simulada' } }),
  };

  const salvarRespostas: ToolDefinition = {
    key: 'drive.salvar_respostas',
    label: 'Drive: salvar as respostas',
    descricao:
      'Grava um arquivo de texto na pasta do cliente com as respostas coletadas até aqui. Precisa da pasta criada antes.',
    grupo: 'Drive',
    modo: 'acao',
    params: [
      {
        key: 'titulo',
        label: 'Nome do arquivo',
        type: 'texto',
        ajuda: 'Padrão: o nome do fluxo.',
        template: true,
      },
      {
        key: 'somente',
        label: 'Só estas respostas',
        type: 'texto',
        ajuda:
          'Nomes de variáveis separados por vírgula. Vazio = todas as respostas do fluxo.',
      },
    ],
    requer: { pasta: true },
    disponivel: () => drive.enabled,
    indisponivelPorque: indisponivel,
    async executar(ctx) {
      if (!ctx.conv.driveFolderId) return { ok: false, motivo: 'sem_pasta' };
      const nome = ctx.state.vars['nome'] || ctx.conv.nome || 'cliente';
      const titulo = String(ctx.params['titulo'] || ctx.flowNome);
      const somente = String(ctx.params['somente'] || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const itens = Object.entries(ctx.state.vars)
        .filter(
          ([k]) =>
            !k.endsWith('_ids') &&
            !k.endsWith('_rotulo') &&
            (!somente.length || somente.includes(k)),
        )
        .map(([k, v]) => ({ rotulo: ctx.rotulos[k] ?? k, valor: v }));
      await drive.saveAnswers(ctx.conv.driveFolderId, nome, titulo, itens);
      return { ok: true };
    },
    simular: () => ({ ok: true }),
  };

  return [criarPasta, salvarRespostas];
}
