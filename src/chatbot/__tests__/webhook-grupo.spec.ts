import { parseWebhook } from '../services/chatbot.service';

const base = {
  id: 1,
  body: 'oi',
  fromMe: false,
  contactId: 10,
  ticketId: 20,
  contact: { number: '559284250433' },
};

describe('webhook do GOSAC: o que é grupo', () => {
  it('contato comum que pertence a um grupo de contatos NÃO é grupo de WhatsApp', () => {
    // Caso real: contact.isGroup=false e groupContactId preenchido.
    const m = parseWebhook({
      ...base,
      groupContactId: 24914,
      ticket: { contact: { isGroup: false } },
    });
    expect(m?.isGroup).toBe(false);
  });

  it('sem groupContactId também não é grupo', () => {
    expect(parseWebhook({ ...base, ticket: { contact: {} } })?.isGroup).toBe(
      false,
    );
  });

  it('grupo de verdade continua sendo ignorado', () => {
    expect(
      parseWebhook({ ...base, ticket: { contact: { isGroup: true } } })
        ?.isGroup,
    ).toBe(true);
    expect(parseWebhook({ ...base, contact: { isGroup: true } })?.isGroup).toBe(
      true,
    );
    expect(parseWebhook({ ...base, ticket: { isGroup: true } })?.isGroup).toBe(
      true,
    );
  });
});
