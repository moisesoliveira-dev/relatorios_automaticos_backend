import { BadRequestException } from '@nestjs/common';
import {
  ChatbotContentService,
  emptyDoc,
} from '../services/chatbot-content.service';
import { MESSAGES, CATEGORIAS_AMBIENTE } from '../domain/chatbot.messages';
import { KNOWLEDGE_BASE, retrieveKb } from '../domain/knowledge-base';
import { identifyMessage } from '../domain/message-specs';
import { decide, validOptions } from '../domain/chatbot.flow';
import { INITIAL_FLOW_STATE } from '../domain/chatbot.types';
import { guidanceBlock } from '../domain/content-runtime';
import { sanitizeFreeReply } from '../domain/free-reply.guard';

class FakeSettings {
  rows = new Map<string, { value: string; category: string }>();
  async getAllDecrypted() {
    return [...this.rows].map(([key, r]) => ({
      key,
      value: r.value,
      category: r.category,
      isEncrypted: false,
      description: '',
    }));
  }
  async upsert(key: string, value: string, category: string) {
    this.rows.set(key, { value, category });
  }
  async delete(key: string) {
    this.rows.delete(key);
  }
}

describe('ChatbotContentService', () => {
  let settings: FakeSettings;
  let svc: ChatbotContentService;
  const opts = { maxInvalid: 3, scheduling: false };

  beforeEach(() => {
    settings = new FakeSettings();
    svc = new ChatbotContentService(settings as any);
    svc.apply(emptyDoc());
  });
  afterAll(() => new ChatbotContentService({} as any).apply(emptyDoc()));

  const draft = (patch: Record<string, unknown>) =>
    svc.saveDraft({ ...emptyDoc(), ...patch }, 'a@b.c');

  it('rascunho não afeta o que o cliente vê; publicar afeta', async () => {
    const original = MESSAGES.pedir_nome;
    await draft({ messages: { pedir_nome: 'Qual o seu nome, por favor?' } });
    expect(MESSAGES.pedir_nome).toBe(original);
    await svc.publish('a@b.c');
    expect(MESSAGES.pedir_nome).toBe('Qual o seu nome, por favor?');
    expect(identifyMessage('Qual o seu nome, por favor?')?.key).toBe(
      'pedir_nome',
    );
  });

  it('exige manter placeholders e os números das opções', async () => {
    await expect(
      draft({
        messages: {
          confirmar_nome: 'Seu nome está certo?\n*1* - Sim\n*2* - Não',
        },
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      draft({ messages: { confirmar_nome: 'Seu nome é {nome}?' } }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      draft({ messages: { pedir_nome: 'oi {inventado}' } }),
    ).rejects.toThrow(BadRequestException);
    await expect(draft({ messages: { pedir_nome: '   ' } })).rejects.toThrow(
      BadRequestException,
    );
    await expect(draft({ messages: { nao_existe: 'x' } })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('desativar opção do menu: o fluxo recusa e a opção pode sair do texto', async () => {
    const semOpcao4 = MESSAGES.menu_inicial.replace(/\*4\*[^\n]*\n/, '');
    await expect(
      draft({ messages: { menu_inicial: semOpcao4 } }),
    ).rejects.toThrow();
    await draft({ messages: { menu_inicial: semOpcao4 }, menuDesativado: [4] });
    await svc.publish(null);
    expect(validOptions({ ...INITIAL_FLOW_STATE, step: 'MENU' })).toEqual([
      1, 2, 3, 5,
    ]);
    const d = decide(
      { ...INITIAL_FLOW_STATE, step: 'MENU' },
      { kind: 'option', value: 4 },
      opts,
    );
    expect(d.patch.step).toBeUndefined(); // tratada como inválida, não entra em boleto
    expect(d.replies[0]).toContain('Ops');
  });

  it('base de conhecimento: edita, adiciona, deriva palavras-chave e volta ao padrão', async () => {
    await draft({
      kb: [
        {
          id: 'Horário!',
          keywords: [],
          text: 'A loja abre de segunda a sábado, das 9h às 18h.',
        },
      ],
    });
    await svc.publish(null);
    expect(KNOWLEDGE_BASE).toHaveLength(1);
    expect(KNOWLEDGE_BASE[0].id).toBe('horario');
    expect(retrieveKb('que horas a loja abre no sabado?')[0]?.id).toBe(
      'horario',
    );
    await draft({ kb: null });
    await svc.publish(null);
    expect(KNOWLEDGE_BASE.length).toBeGreaterThan(1);
  });

  it('números da base publicada passam no filtro de respostas livres', async () => {
    expect(sanitizeFreeReply('Fale no ramal 4455 da loja.')).toBeNull();
    await draft({
      kb: [
        {
          id: 'ramal',
          keywords: ['ramal'],
          text: 'O ramal da loja é 4455, em horário comercial.',
        },
      ],
    });
    await svc.publish(null);
    expect(sanitizeFreeReply('Fale no ramal 4455 da loja.')).not.toBeNull();
  });

  it('renomeia ambientes e rejeita nomes ruins', async () => {
    await expect(draft({ categorias: { 1: 'x' } })).rejects.toThrow();
    await expect(draft({ categorias: { 99: 'Garagem' } })).rejects.toThrow();
    await draft({ categorias: { 1: 'Cozinha Gourmet' } });
    await svc.publish(null);
    expect(CATEGORIAS_AMBIENTE[1]).toBe('Cozinha Gourmet');
  });

  it('guia da IA entra no prompt sem tirar as regras; tom inválido é recusado', async () => {
    expect(guidanceBlock()).toBe('');
    await expect(
      draft({ guidance: { tone: 'gritando', instructions: '' } }),
    ).rejects.toThrow();
    await draft({
      guidance: { tone: 'formal', instructions: 'Trate por senhor/senhora.' },
    });
    await svc.publish(null);
    const g = guidanceBlock();
    expect(g).toContain('formal');
    expect(g).toContain('senhor/senhora');
    expect(g).toContain('NUNCA substituem');
  });

  it('publicar sem rascunho falha; reverter volta à versão anterior; descartar limpa', async () => {
    await expect(svc.publish(null)).rejects.toThrow();
    await draft({ messages: { pedir_nome: 'Primeira versão do nome?' } });
    await svc.publish(null);
    await draft({ messages: { pedir_nome: 'Segunda versão do nome?' } });
    await svc.publish(null);
    expect(MESSAGES.pedir_nome).toBe('Segunda versão do nome?');
    await svc.rollback(null);
    expect(MESSAGES.pedir_nome).toBe('Primeira versão do nome?');
    await draft({ guidance: { tone: 'objetivo', instructions: '' } });
    const after = await svc.discardDraft();
    expect(after.draft).toBeNull();
  });

  it('outra instância enxerga a publicação pelo reload', async () => {
    await draft({ messages: { pedir_nome: 'Nome, por favor?' } });
    await svc.publish(null);
    new ChatbotContentService({
      getAllDecrypted: () => settings.getAllDecrypted(),
    } as any).apply(emptyDoc());
    expect(MESSAGES.pedir_nome).not.toBe('Nome, por favor?');
    const other = new ChatbotContentService(settings as any);
    await other.reload();
    expect(MESSAGES.pedir_nome).toBe('Nome, por favor?');
  });

  it('mensagem igual ao padrão não vira override', async () => {
    await draft({ messages: { pedir_nome: MESSAGES.pedir_nome } });
    const g = await svc.get();
    expect(g.draft?.messages).toEqual({});
  });
});
