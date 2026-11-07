import type { ToolContext, ToolDefinition } from '../engine/tool.types';
import { ChatbotHandoffService } from '../services/chatbot-handoff.service';
import type { ChatbotConversation } from '../entities/chatbot-conversation.entity';
import {
  contatoGosac,
  CrmError,
  CrmFunilService,
  fluxoDaTrilha,
  linhasDaTriagem,
} from '../services/crm-funil.service';
import { funilTools, leadDaConversa, lerValor } from '../tools/funil.tools';

const crmCfg = {
  enabled: true,
  baseUrl: 'https://crm',
  apiKey: 'k',
  fluxo: '2.2',
};

/** Cliente falso do funil: guarda as chamadas e pode ser instruído a falhar. */
function fakeCrm(opts: { falha?: Partial<Record<string, CrmError>> } = {}) {
  const calls: Array<[string, ...unknown[]]> = [];
  const run = (nome: string, ...args: unknown[]) => {
    calls.push([nome, ...args]);
    const erro = opts.falha?.[nome];
    return erro ? Promise.reject(erro) : Promise.resolve();
  };
  const crm = {
    enabled: true,
    indisponivelPorque: '',
    registrar: async (l: unknown) => {
      await run('registrar', l);
      return {
        acao: 'criado',
        id: 'lead1',
        consultor: '',
        status: 'ativo',
        etapa: 'novo',
      };
    },
    editar: (...a: unknown[]) => run('editar', ...a),
    nota: (...a: unknown[]) => run('nota', ...a),
    checklist: (...a: unknown[]) => run('checklist', ...a),
    avancar: (...a: unknown[]) => run('avancar', ...a),
    perder: (...a: unknown[]) => run('perder', ...a),
  };
  return { crm: crm as unknown as CrmFunilService, calls };
}

const ctx = (
  params: ToolContext['params'] = {},
  extra: { vars?: Record<string, string>; crmLeadId?: string | null } = {},
): ToolContext => ({
  conv: {
    contactId: 7,
    ticketId: 99,
    nome: 'Ana',
    numero: '5592991234567',
    driveFolderId: null,
    crmLeadId: extra.crmLeadId ?? null,
  },
  state: {
    flowId: 'f',
    nodeId: 'n',
    vars: extra.vars ?? {},
  } as ToolContext['state'],
  params,
  flowNome: 'Fluxo',
  rotulos: {},
});

const tool = (crm: CrmFunilService, key: string): ToolDefinition =>
  funilTools(crm, { crm: crmCfg } as never).find((t) => t.key === key)!;

describe('funil comercial (CMSYS)', () => {
  it('lê valores em reais nos formatos brasileiros', () => {
    expect(lerValor('30000')).toBe(30000);
    expect(lerValor('R$ 30.000,50')).toBe(30000.5);
    expect(lerValor('30.000')).toBe(30000);
    expect(lerValor('abc')).toBeNull();
  });

  it('contato no formato do detector de leads e fluxo pelo menu', () => {
    expect(contatoGosac('+55 (92) 99123-4567', 7)).toBe('5592991234567@c.us');
    expect(contatoGosac(null, 7)).toBe('gosac-7');
    expect(fluxoDaTrilha('projeto', '2.2')).toEqual({
      fluxo: '1',
      provisorio: false,
    });
    expect(fluxoDaTrilha('planta', '2.1')).toEqual({
      fluxo: '2.1',
      provisorio: true,
    });
    expect(fluxoDaTrilha(undefined, '2.2')).toEqual({
      fluxo: '2.2',
      provisorio: true,
    });
  });

  it('o fluxo pedido na etapa vale; fluxo inválido volta ao automático', () => {
    const c = ctx({}, { vars: { trilha: 'projeto' } });
    expect(leadDaConversa(c, crmCfg, { fluxo: '2.1' as never })).toMatchObject({
      fluxo: '2.1',
      fluxoProvisorio: false,
    });
    expect(leadDaConversa(c, crmCfg, { fluxo: '' as never })).toMatchObject({
      fluxo: '1',
      fluxoProvisorio: false,
    });
    expect(leadDaConversa(c, crmCfg, { fluxo: '9' as never })).toMatchObject({
      fluxo: '1',
    });
  });

  it('resumo da triagem ignora campos técnicos e usa os rótulos', () => {
    expect(
      linhasDaTriagem(
        {
          nome: 'Ana',
          trilha: 'projeto',
          ambientes: 'Cozinha',
          ambientes_ids: '1',
          horario_rotulo: 'x',
          vazio: ' ',
        },
        { ambientes: 'Ambientes de interesse' },
      ),
    ).toEqual(['nome: Ana', 'Ambientes de interesse: Cozinha']);
  });

  describe('ferramentas', () => {
    it('registrar_lead guarda o id do lead na conversa e numa variável', async () => {
      const { crm, calls } = fakeCrm();
      const r = await tool(crm, 'funil.registrar_lead').executar(
        ctx({ origem: 'WhatsApp', resumo: 'quer cozinha' }),
      );
      expect(r).toMatchObject({
        ok: true,
        vars: { lead_id: 'lead1' },
        conv: { crmLeadId: 'lead1' },
      });
      expect(calls[0][1]).toMatchObject({
        contato: '5592991234567@c.us',
        nome: 'Ana',
        atendimento: '99',
        origem: 'WhatsApp',
        conversa: 'quer cozinha',
      });
    });

    it('atualizar_cadastro sem nada preenchido não chama a API', async () => {
      const { crm, calls } = fakeCrm();
      const r = await tool(crm, 'funil.atualizar_cadastro').executar(
        ctx({ ambientes: '  ', faseObra: '' }),
      );
      expect(r).toEqual({ ok: true });
      expect(calls).toHaveLength(0);
    });

    it('atualizar_cadastro cria o lead se ainda não existe e só envia o preenchido', async () => {
      const { crm, calls } = fakeCrm();
      const r = await tool(crm, 'funil.atualizar_cadastro').executar(
        ctx({ ambientes: 'Cozinha', valorEstimado: 'R$ 30.000,00' }),
      );
      expect(r).toMatchObject({ ok: true, conv: { crmLeadId: 'lead1' } });
      expect(calls.map((c) => c[0])).toEqual(['registrar', 'editar']);
      expect(calls[1]).toEqual([
        'editar',
        'lead1',
        { ambientes: 'Cozinha', valorEstimado: 30000 },
      ]);
    });

    it('usa o lead que a conversa já tem, sem criar outro', async () => {
      const { crm, calls } = fakeCrm();
      const r = await tool(crm, 'funil.nota').executar(
        ctx({ texto: 'oi' }, { crmLeadId: 'abc' }),
      );
      expect(r).toEqual({ ok: true });
      expect(calls).toEqual([['nota', 'abc', 'oi']]);
    });

    it('dados inválidos seguem pelo caminho de falha, sem chamar a API', async () => {
      const { crm, calls } = fakeCrm();
      const t = tool(crm, 'funil.atualizar_cadastro');
      const invalidos: Array<Record<string, string>> = [
        { email: 'sem-arroba' },
        { valorEstimado: 'muito' },
        { previsaoLiberacao: '12/2026' },
        { fluxo: '3' },
      ];
      for (const p of invalidos)
        expect(await t.executar(ctx(p))).toEqual({
          ok: false,
          motivo: 'dados_invalidos',
        });
      expect(calls).toHaveLength(0);
    });

    it('explica por que falhou: checklist incompleto, fora da pré-venda, API fora do ar', async () => {
      const c = ctx({}, { crmLeadId: 'abc' });
      const incompleto = fakeCrm({
        falha: { avancar: new CrmError('Complete o checklist', 400) },
      });
      expect(await tool(incompleto.crm, 'funil.avancar').executar(c)).toEqual({
        ok: false,
        motivo: 'dados_invalidos',
      });
      const fora = fakeCrm({
        falha: { avancar: new CrmError('x', 409, 'fora-da-pre-venda') },
      });
      expect(await tool(fora.crm, 'funil.avancar').executar(c)).toEqual({
        ok: false,
        motivo: 'fora_da_pre_venda',
      });
      const caiu = fakeCrm({
        falha: { avancar: new CrmError('timeout', null) },
      });
      expect(await tool(caiu.crm, 'funil.avancar').executar(c)).toEqual({
        ok: false,
        motivo: 'erro',
      });
    });

    it('marcar_checklist desmarca quando ok=false', async () => {
      const { crm, calls } = fakeCrm();
      await tool(crm, 'funil.marcar_checklist').executar(
        ctx({ item: 'Prazo desejado', ok: false }, { crmLeadId: 'abc' }),
      );
      expect(calls).toEqual([['checklist', 'abc', 'Prazo desejado', false]]);
    });

    it('simulador não chama a API', () => {
      const { crm, calls } = fakeCrm();
      for (const t of funilTools(crm, { crm: crmCfg } as never))
        expect(t.simular(ctx()).ok).toBe(true);
      expect(calls).toHaveLength(0);
    });
  });

  describe('encaminhamento', () => {
    const montar = (
      crmFalha?: Partial<Record<string, CrmError>>,
      pick: { name: string | null } | null = { name: 'Elizabete Araújo' },
    ) => {
      const { crm, calls } = fakeCrm({ falha: crmFalha });
      const ticket = jest.fn().mockResolvedValue(undefined);
      const svc = new ChatbotHandoffService(
        { chatbot: { fallbackGosacUserId: undefined }, crm: crmCfg } as never,
        { updateTicket: ticket, sendTexts: jest.fn() } as never,
        {
          next: async () =>
            pick
              ? { ...pick, ponttaId: 'p', gosacUserId: 5, gosacQueueId: 6 }
              : null,
        } as never,
        crm,
        { compose: async () => [] } as never,
      );
      const conv = {
        contactId: 7,
        ticketId: 99,
        nome: 'Ana',
        contactName: null,
        numero: '5592991234567',
        history: [],
        crmLeadId: null,
      } as unknown as ChatbotConversation;
      return { svc, conv, calls, ticket };
    };

    it('registra o lead com o atendente do rodízio, o cadastro e o resumo da triagem', async () => {
      const { svc, conv, calls, ticket } = montar();
      const r = await svc.execute(conv, {
        jaAvisou: true,
        vars: { nome: 'Ana', trilha: 'projeto', ambientes: 'Cozinha, Sala' },
        rotulos: { ambientes: 'Ambientes de interesse' },
      });
      expect(r).toMatchObject({
        atendenteId: 5,
        filaId: 6,
        crmLeadId: 'lead1',
        error: null,
      });
      expect(ticket).toHaveBeenCalled();
      expect(calls[0][1]).toMatchObject({
        contato: '5592991234567@c.us',
        nome: 'Ana',
        fluxo: '1',
        fluxoProvisorio: false,
        atendente: 'Elizabete Araújo',
        atendimento: '99',
      });
      expect(calls[1]).toEqual([
        'editar',
        'lead1',
        { ambientes: 'Cozinha, Sala' },
      ]);
      expect(calls[2][0]).toBe('nota');
      expect(String(calls[2][2])).toContain(
        '- Ambientes de interesse: Cozinha, Sala',
      );
    });

    it('se o funil falhar, o cliente ainda é entregue ao atendente', async () => {
      const { svc, conv, ticket } = montar({
        registrar: new CrmError('fora do ar', 503),
      });
      const r = await svc.execute(conv, {
        jaAvisou: true,
        vars: { nome: 'Ana' },
      });
      expect(ticket).toHaveBeenCalled();
      expect(r.atendenteId).toBe(5);
      expect(r.crmLeadId).toBeNull();
      expect(r.error).toContain('funil: fora do ar');
    });

    it('devolvendo ao mesmo atendente não troca o consultor nem repete o resumo', async () => {
      const { svc, conv, calls } = montar();
      conv.atendenteId = 5;
      conv.filaId = 6;
      await svc.execute(conv, {
        jaAvisou: true,
        reutilizar: true,
        vars: { nome: 'Ana' },
      });
      expect(calls[0][1]).toMatchObject({ atendente: null });
      expect(calls.some((c) => c[0] === 'nota')).toBe(false);
    });
  });
});
