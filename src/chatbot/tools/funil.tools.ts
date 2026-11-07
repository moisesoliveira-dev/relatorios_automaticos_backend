import type { AppConfigService } from '../../infrastructure/config/app-config.service';
import type {
  ParamSpec,
  ToolContext,
  ToolDefinition,
  ToolResult,
} from '../engine/tool.types';
import {
  CRM_FLUXOS,
  contatoGosac,
  CrmError,
  CrmFluxo,
  CrmFunilService,
  CrmLeadEdicao,
  CrmLeadEntrada,
  fluxoDaTrilha,
} from '../services/crm-funil.service';

/** Texto do parâmetro, já sem espaços; vazio quando o cliente ainda não respondeu a variável. */
const texto = (ctx: ToolContext, key: string): string =>
  String(ctx.params[key] ?? '').trim();

const ehFluxo = (v: string): v is CrmFluxo =>
  (CRM_FLUXOS as string[]).includes(v);

/** "R$ 30.000,50", "30000", "30 mil" não: só números, com ou sem separadores brasileiros. */
export function lerValor(raw: string): number | null {
  const limpo = raw.replace(/[^\d.,]/g, '');
  if (!limpo) return null;
  const n = limpo.includes(',')
    ? Number(limpo.replace(/\./g, '').replace(',', '.'))
    : /^\d{1,3}(\.\d{3})+$/.test(limpo)
      ? Number(limpo.replace(/\./g, ''))
      : Number(limpo);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Nome do cliente para o lead: o que ele confirmou, senão o do GOSAC, senão um rótulo neutro. */
const nomeDe = (ctx: ToolContext): string =>
  (ctx.state.vars['nome'] || ctx.conv.nome || '').trim() ||
  `Cliente ${ctx.conv.numero ?? ctx.conv.ticketId}`;

/** Dados do lead a partir da conversa (o fluxo pode sobrescrever o fluxo do funil). */
export function leadDaConversa(
  ctx: ToolContext,
  crm: AppConfigService['crm'],
  extra: Partial<CrmLeadEntrada> = {},
): CrmLeadEntrada {
  const auto = fluxoDaTrilha(ctx.state.vars['trilha'], crm.fluxo as CrmFluxo);
  const { fluxo: pedido, ...resto } = extra;
  const f = String(pedido ?? '').trim();
  return {
    contato: contatoGosac(ctx.conv.numero, ctx.conv.contactId),
    nome: nomeDe(ctx).slice(0, 200),
    telefone: ctx.conv.numero,
    atendimento: String(ctx.conv.ticketId),
    ...resto,
    // fluxo pedido pelo dono do fluxo (já confirmado) ou o deduzido do menu (o consultor confirma)
    fluxo: ehFluxo(f) ? f : auto.fluxo,
    fluxoProvisorio: ehFluxo(f) ? false : auto.provisorio,
  };
}

/** Traduz o erro da API em "motivo" curto para o caminho "se falhar" do fluxo. */
function falhou(e: unknown): ToolResult {
  if (e instanceof CrmError) {
    if (e.foraDaPreVenda) return { ok: false, motivo: 'fora_da_pre_venda' };
    if (e.status === 400 || e.status === 404)
      return { ok: false, motivo: 'dados_invalidos' };
  }
  return { ok: false, motivo: 'erro' };
}

const NADA_A_FAZER = { ok: true } as const;

/** Ferramentas do funil comercial do CMSYS (API de integração). */
export function funilTools(
  crm: CrmFunilService,
  config: AppConfigService,
): ToolDefinition[] {
  const base = {
    grupo: 'Funil comercial' as const,
    disponivel: () => crm.enabled,
    indisponivelPorque: () => crm.indisponivelPorque,
  };

  /** Lead desta conversa: o que já existe ou um novo (a API nunca duplica). */
  const garantirLead = async (
    ctx: ToolContext,
  ): Promise<{ id: string; novo: boolean }> => {
    if (ctx.conv.crmLeadId) return { id: ctx.conv.crmLeadId, novo: false };
    const r = await crm.registrar(leadDaConversa(ctx, config.crm));
    return { id: r.id, novo: true };
  };
  const conv = (id: string, novo: boolean) =>
    novo ? { conv: { crmLeadId: id } } : {};

  const fluxoParam: ParamSpec = {
    key: 'fluxo',
    label: 'Fluxo do funil',
    type: 'texto',
    template: true,
    ajuda:
      '1 = já tem projeto; 2.1 = sem projeto, imóvel na planta; 2.2 = sem projeto, já com as chaves. Vazio = automático pelo caminho escolhido no menu (o consultor confirma na Qualificação).',
  };

  const registrar: ToolDefinition = {
    ...base,
    key: 'funil.registrar_lead',
    label: 'Funil: registrar o cliente como lead',
    descricao:
      'Cria o lead no funil comercial (CMSYS) com o nome e o telefone do cliente, ou atualiza o que já existe: nunca duplica. Os próximos passos de “Funil” usam este lead. Ao encaminhar para um atendente, o sistema também registra o lead sozinho.',
    modo: 'acao',
    params: [
      fluxoParam,
      {
        key: 'origem',
        label: 'Origem do lead',
        type: 'texto',
        padrao: 'WhatsApp',
      },
      {
        key: 'resumo',
        label: 'Resumo da conversa (até 300 letras)',
        type: 'texto',
        template: true,
        ajuda: 'Vai na observação do lead novo. Pode citar {variaveis}.',
      },
    ],
    produz: { vars: ['lead_id'] },
    async executar(ctx) {
      try {
        const origem = texto(ctx, 'origem');
        const resumo = texto(ctx, 'resumo');
        const r = await crm.registrar(
          leadDaConversa(ctx, config.crm, {
            fluxo: texto(ctx, 'fluxo') as CrmFluxo,
            ...(origem ? { origem } : {}),
            ...(resumo ? { conversa: resumo.slice(0, 300) } : {}),
          }),
        );
        return { ok: true, vars: { lead_id: r.id }, conv: { crmLeadId: r.id } };
      } catch (e) {
        return falhou(e);
      }
    },
    simular: () => ({ ok: true, vars: { lead_id: 'simulado' } }),
  };

  const atualizar: ToolDefinition = {
    ...base,
    key: 'funil.atualizar_cadastro',
    label: 'Funil: atualizar o cadastro do lead',
    descricao:
      'Grava no lead o que o cliente respondeu (ambientes, faixa de investimento, fase da obra...). Só os campos preenchidos mudam. Funciona enquanto o lead está na pré-venda (Novo lead e Qualificação).',
    modo: 'acao',
    params: [
      {
        key: 'ambientes',
        label: 'Ambientes',
        type: 'texto',
        template: true,
        padrao: '{ambientes}',
        ajuda: 'Até 200 letras.',
      },
      {
        key: 'valorEstimado',
        label: 'Faixa de investimento (R$)',
        type: 'texto',
        template: true,
        ajuda: 'Só o valor, ex.: 30000 ou 30.000,00.',
      },
      {
        key: 'faseObra',
        label: 'Fase da obra',
        type: 'texto',
        template: true,
      },
      {
        key: 'previsaoLiberacao',
        label: 'Previsão de entrega das chaves',
        type: 'texto',
        template: true,
        ajuda: 'Data no formato AAAA-MM-DD.',
      },
      {
        key: 'email',
        label: 'E-mail',
        type: 'texto',
        template: true,
      },
      fluxoParam,
    ],
    async executar(ctx) {
      const dados: CrmLeadEdicao = {};
      const ambientes = texto(ctx, 'ambientes');
      if (ambientes) dados.ambientes = ambientes.slice(0, 200);
      const fase = texto(ctx, 'faseObra');
      if (fase) dados.faseObra = fase.slice(0, 200);
      const email = texto(ctx, 'email');
      if (email) {
        if (!/^\S+@\S+\.\S+$/.test(email))
          return { ok: false, motivo: 'dados_invalidos' };
        dados.email = email.slice(0, 200);
      }
      const valor = texto(ctx, 'valorEstimado');
      if (valor) {
        const n = lerValor(valor);
        if (n === null) return { ok: false, motivo: 'dados_invalidos' };
        dados.valorEstimado = n;
      }
      const previsao = texto(ctx, 'previsaoLiberacao');
      if (previsao) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(previsao))
          return { ok: false, motivo: 'dados_invalidos' };
        dados.previsaoLiberacao = previsao;
      }
      const fluxo = texto(ctx, 'fluxo');
      if (fluxo) {
        if (!ehFluxo(fluxo)) return { ok: false, motivo: 'dados_invalidos' };
        dados.fluxo = fluxo;
      }
      if (!Object.keys(dados).length) return NADA_A_FAZER;
      try {
        const lead = await garantirLead(ctx);
        await crm.editar(lead.id, dados);
        return { ok: true, ...conv(lead.id, lead.novo) };
      } catch (e) {
        return falhou(e);
      }
    },
    simular: () => ({ ok: true }),
  };

  const checklist: ToolDefinition = {
    ...base,
    key: 'funil.marcar_checklist',
    label: 'Funil: marcar item do checklist',
    descricao:
      'Marca (ou desmarca) um item do checklist da etapa atual do lead, pelo texto exato do item (ex.: “Ambientes definidos”). O checklist completo libera “Funil: avançar de etapa”.',
    modo: 'acao',
    params: [
      {
        key: 'item',
        label: 'Texto do item',
        type: 'texto',
        obrigatorio: true,
        template: true,
        ajuda:
          'Novo lead: “Primeiro contato feito”, “Origem do lead registrada”. Qualificação: “Ambientes definidos”, “Faixa de investimento”, “Prazo desejado”, “Fase da obra ou previsão de entrega das chaves”. Os itens podem ser mudados no CMSYS.',
      },
      {
        key: 'ok',
        label: 'Marcar como feito',
        type: 'booleano',
        padrao: true,
      },
    ],
    async executar(ctx) {
      const item = texto(ctx, 'item');
      if (!item) return { ok: false, motivo: 'dados_invalidos' };
      try {
        const lead = await garantirLead(ctx);
        const ok = ctx.params['ok'] !== false && ctx.params['ok'] !== 'false';
        await crm.checklist(lead.id, item, ok);
        return { ok: true, ...conv(lead.id, lead.novo) };
      } catch (e) {
        return falhou(e);
      }
    },
    simular: () => ({ ok: true }),
  };

  const avancar: ToolDefinition = {
    ...base,
    key: 'funil.avancar',
    label: 'Funil: avançar de etapa',
    descricao:
      'Leva o lead de “Novo lead” para “Qualificação”. Só funciona com o checklist da etapa completo; senão segue pelo caminho “se falhar”.',
    modo: 'acao',
    params: [
      {
        key: 'obs',
        label: 'Observação (até 500 letras)',
        type: 'texto',
        template: true,
      },
    ],
    async executar(ctx) {
      try {
        const lead = await garantirLead(ctx);
        await crm.avancar(lead.id, texto(ctx, 'obs'));
        return { ok: true, ...conv(lead.id, lead.novo) };
      } catch (e) {
        return falhou(e);
      }
    },
    simular: () => ({ ok: true }),
  };

  const nota: ToolDefinition = {
    ...base,
    key: 'funil.nota',
    label: 'Funil: anotar no histórico do lead',
    descricao:
      'Registra uma anotação no histórico do lead, em qualquer etapa (inclusive depois que o consultor assumiu). Bom para o resumo da triagem.',
    modo: 'acao',
    params: [
      {
        key: 'texto',
        label: 'Anotação',
        type: 'texto',
        obrigatorio: true,
        template: true,
        ajuda: 'Até 2000 letras. Pode citar {variaveis}.',
      },
    ],
    async executar(ctx) {
      const obs = texto(ctx, 'texto');
      if (!obs) return { ok: false, motivo: 'dados_invalidos' };
      try {
        const lead = await garantirLead(ctx);
        await crm.nota(lead.id, obs);
        return { ok: true, ...conv(lead.id, lead.novo) };
      } catch (e) {
        return falhou(e);
      }
    },
    simular: () => ({ ok: true }),
  };

  const perder: ToolDefinition = {
    ...base,
    key: 'funil.perder',
    label: 'Funil: marcar lead como perdido',
    descricao:
      'Marca o lead como perdido, com um motivo da lista do funil (ex.: “Sem retorno”, “Preço”, “Prazo”). Só na pré-venda.',
    modo: 'acao',
    params: [
      {
        key: 'motivo',
        label: 'Motivo',
        type: 'texto',
        obrigatorio: true,
        template: true,
        padrao: 'Sem retorno',
      },
      {
        key: 'obs',
        label: 'Observação (até 1000 letras)',
        type: 'texto',
        template: true,
      },
    ],
    async executar(ctx) {
      const motivo = texto(ctx, 'motivo');
      if (!motivo) return { ok: false, motivo: 'dados_invalidos' };
      try {
        const lead = await garantirLead(ctx);
        await crm.perder(lead.id, motivo, texto(ctx, 'obs'));
        return { ok: true, ...conv(lead.id, lead.novo) };
      } catch (e) {
        return falhou(e);
      }
    },
    simular: () => ({ ok: true }),
  };

  return [registrar, atualizar, checklist, avancar, nota, perder];
}
