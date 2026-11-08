import { OpenAiService, textoValido } from '../services/openai.service';

describe('OpenAiService.callTool', () => {
  const config = (
    over: Record<string, unknown> = {},
    chatbot: Record<string, unknown> = {},
  ) => {
    const openai = {
      apiKey: 'sk-teste',
      model: 'modelo-base',
      temperature: 0,
      timeoutMs: 1000,
      ...over,
    };
    return {
      chatbot: { aiEnabled: true, ...chatbot },
      openai,
      modelFor: (agent: string) =>
        process.env[`OPENAI_MODEL_${agent.toUpperCase()}`] || openai.model,
    } as any;
  };

  const tool = {
    name: 'f',
    description: 'd',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  };
  const call = { agent: 'scope', system: 'sys', user: 'u', tool };
  const fake = (impl: () => Promise<any>) =>
    ({ chat: { completions: { create: jest.fn(impl) } } }) as any;
  const ok = (args: unknown) => async () => ({
    choices: [
      {
        message: {
          tool_calls: [
            { type: 'function', function: { arguments: JSON.stringify(args) } },
          ],
        },
      },
    ],
    usage: { total_tokens: 10 },
  });

  it('força a chamada de função e devolve os argumentos', async () => {
    const service = new OpenAiService(config());
    const client = fake(ok({ a: 1 }));
    service.setClientForTests(client);
    expect(await service.callTool(call)).toEqual({ a: 1 });
    const args = client.chat.completions.create.mock.calls[0][0];
    expect(args.tool_choice).toEqual({
      type: 'function',
      function: { name: 'f' },
    });
    expect(args.tools[0].function.strict).toBe(true);
    expect(args.model).toBe('modelo-base');
  });

  it('permite modelo diferente por agente via OPENAI_MODEL_<AGENTE>', async () => {
    process.env.OPENAI_MODEL_VERIFIER = 'modelo-forte';
    const service = new OpenAiService(config());
    const client = fake(ok({}));
    service.setClientForTests(client);
    await service.callTool({ ...call, agent: 'verifier' });
    await service.callTool({ ...call, agent: 'scope' });
    expect(client.chat.completions.create.mock.calls[0][0].model).toBe(
      'modelo-forte',
    );
    expect(client.chat.completions.create.mock.calls[1][0].model).toBe(
      'modelo-base',
    );
    delete process.env.OPENAI_MODEL_VERIFIER;
  });

  it('sem chave ou com IA desligada não chama a OpenAI', async () => {
    expect(new OpenAiService(config({ apiKey: undefined })).enabled).toBe(
      false,
    );
    const off = new OpenAiService(config({}, { aiEnabled: false }));
    expect(off.enabled).toBe(false);
    expect(await off.callTool(call)).toBeNull();
  });

  it('erro de rede devolve null; 3 falhas abrem o disjuntor e as chamadas seguintes nem saem', async () => {
    const service = new OpenAiService(config());
    const client = fake(async () => {
      throw new Error('boom');
    });
    service.setClientForTests(client);
    for (let i = 0; i < 3; i++) expect(await service.callTool(call)).toBeNull();
    expect(service.breakerOpen).toBe(true);
    await service.callTool(call);
    expect(client.chat.completions.create).toHaveBeenCalledTimes(3);
  });

  it('resposta sem chamada de função = null; omite temperature quando não configurada', async () => {
    const service = new OpenAiService(config({ temperature: undefined }));
    const client = fake(async () => ({
      choices: [{ message: { tool_calls: [] } }],
    }));
    service.setClientForTests(client);
    expect(await service.callTool(call)).toBeNull();
    expect(
      'temperature' in client.chat.completions.create.mock.calls[0][0],
    ).toBe(false);
  });
});

describe('OpenAiService: textos e falhas que não devem pausar a IA', () => {
  it('remove meio-emoji que surge ao cortar um texto', () => {
    const emoji = '😊';
    expect(textoValido(`ola ${emoji.slice(0, 1)}`)).toBe('ola ');
    expect(textoValido(`${emoji.slice(1)} fim`)).toBe(' fim');
    expect(textoValido(`inteiro ${emoji} ok`)).toBe(`inteiro ${emoji} ok`);
  });

  const servico = (erro: { status?: number }) => {
    const svc = new OpenAiService({
      chatbot: { aiEnabled: true },
      openai: { apiKey: 'k', timeoutMs: 100 },
      modelFor: () => 'm',
    } as never);
    svc.setClientForTests({
      chat: {
        completions: {
          create: () => Promise.reject(Object.assign(new Error('x'), erro)),
        },
      },
    } as never);
    return svc;
  };
  const call = {
    agent: 'scope',
    system: 's',
    user: 'u',
    tool: { name: 't', description: 'd', parameters: {} },
  };

  it('erro 400 repetido não abre o disjuntor', async () => {
    const svc = servico({ status: 400 });
    for (let i = 0; i < 5; i++) await svc.callTool(call);
    expect(svc.breakerOpen).toBe(false);
  });

  it('erro 500 ou 429 repetido abre o disjuntor', async () => {
    for (const status of [500, 429]) {
      const svc = servico({ status });
      for (let i = 0; i < 3; i++) await svc.callTool(call);
      expect(svc.breakerOpen).toBe(true);
    }
  });
});
