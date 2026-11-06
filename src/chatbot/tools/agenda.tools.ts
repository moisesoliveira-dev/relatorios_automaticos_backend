import type { AppConfigService } from '../../infrastructure/config/app-config.service';
import type { ToolDefinition } from '../engine/tool.types';
import type { ChatbotSchedulingService } from '../services/chatbot-scheduling.service';

export const HORARIO_INDISPONIVEL =
  'Ops! 😅 O horário que você escolheu já foi agendado por outra pessoa. Por favor, selecione outro horário disponível. ⏰';

/** Ferramentas da agenda de medição (Pontta). */
export function agendaTools(
  scheduling: ChatbotSchedulingService,
  config: AppConfigService,
): ToolDefinition[] {
  const disponivel = () =>
    config.chatbot.ponttaEnabled && !!config.chatbot.measureOwnerId;
  const motivo = () =>
    'Ligue a integração com o Pontta e informe o responsável da agenda em Ajustes.';

  const oferecer: ToolDefinition = {
    key: 'agenda.oferecer_horarios',
    label: 'Agenda: oferecer horários de medição',
    descricao:
      'Consulta a agenda do Pontta e mostra até 8 horários livres (2 h cada, de segunda a sexta). O cliente escolhe um; a escolha fica na variável desta etapa. Sem horários livres, segue pelo caminho "sem opções".',
    grupo: 'Agenda',
    modo: 'escolha',
    params: [
      {
        key: 'texto',
        label: 'Pergunta ao cliente',
        type: 'texto',
        obrigatorio: true,
        template: true,
        padrao:
          'Para finalizarmos com o atendimento, por favor, escolha o melhor horário para realizarmos a medição 🕐📏',
      },
      {
        key: 'nenhum',
        label: 'Opção “nenhum destes”',
        type: 'texto',
        ajuda:
          'Texto da última opção. Quando o cliente a escolhe, a variável fica com o valor "nenhum". Vazio = sem essa opção.',
        padrao: 'Nenhum desses horários.',
      },
    ],
    disponivel,
    indisponivelPorque: motivo,
    async executar(ctx) {
      const slots = await scheduling.offer();
      const opcoes = slots
        .slice(0, 8)
        .map((s) => ({ rotulo: s.label, valor: `${s.startUtc}|${s.endUtc}` }));
      const nenhum = String(ctx.params['nenhum'] ?? '').trim();
      if (opcoes.length && nenhum)
        opcoes.push({ rotulo: nenhum, valor: 'nenhum' });
      return { ok: true, opcoes };
    },
    simular(ctx) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + 1);
      const dia = `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
      const opcoes = [
        { rotulo: `${dia} 07:00 - 09:00`, valor: 'sim-1' },
        { rotulo: `${dia} 09:00 - 11:00`, valor: 'sim-2' },
      ];
      const nenhum = String(ctx.params['nenhum'] ?? '').trim();
      if (nenhum) opcoes.push({ rotulo: nenhum, valor: 'nenhum' });
      return { ok: true, opcoes };
    },
  };

  const reservar: ToolDefinition = {
    key: 'agenda.reservar',
    label: 'Agenda: reservar o horário escolhido',
    descricao:
      'Reserva na agenda do Pontta o horário que o cliente escolheu na etapa “oferecer horários”. Se alguém pegou o horário antes, avisa o cliente e segue pelo caminho "se falhar" (normalmente: oferecer de novo).',
    grupo: 'Agenda',
    modo: 'acao',
    params: [
      {
        key: 'horario',
        label: 'Variável com o horário escolhido',
        type: 'variavel',
        obrigatorio: true,
        padrao: 'horario',
      },
      {
        key: 'avisoOcupado',
        label: 'Aviso se o horário já foi tomado',
        type: 'texto',
        template: true,
        padrao: HORARIO_INDISPONIVEL,
      },
    ],
    requer: {},
    produz: { vars: ['agendamento'] },
    disponivel,
    indisponivelPorque: motivo,
    async executar(ctx) {
      const v = String(ctx.params['horario'] || 'horario');
      const valor = ctx.state.vars[v] ?? '';
      const [startUtc, endUtc] = valor.split('|');
      if (!startUtc || !endUtc) return { ok: false, motivo: 'sem_horario' };
      const label = ctx.state.vars[`${v}_rotulo`] ?? valor;
      const nome = ctx.state.vars['nome'] || ctx.conv.nome || 'o cliente';
      const note = `Precisa entrar em contato com ${nome} do número: ${ctx.conv.numero ?? 'não informado'}, para saber a localização da medição e substituir esta mensagem.`;
      const ok = await scheduling.book(
        { startUtc, endUtc, label },
        ctx.conv.contactId,
        note,
      );
      if (!ok)
        return {
          ok: false,
          motivo: 'ocupado',
          replies: [String(ctx.params['avisoOcupado'] || HORARIO_INDISPONIVEL)],
        };
      return {
        ok: true,
        vars: { agendamento: label },
        conv: { agendamentoStart: startUtc },
      };
    },
    simular(ctx) {
      const v = String(ctx.params['horario'] || 'horario');
      return {
        ok: true,
        vars: { agendamento: ctx.state.vars[`${v}_rotulo`] ?? 'simulado' },
      };
    },
  };

  return [oferecer, reservar];
}
