import * as crypto from 'crypto';
import { decryptStrict, deriveKeys, encryptV2 } from './settings-crypto';

/** Cifra no formato LEGADO com código independente (como o sistema antigo gravava). */
function legacyEncrypt(text: string, encryptionKey: string): string {
  const key = Buffer.from(encryptionKey.padEnd(32, '0').slice(0, 32));
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv('aes-256-cbc', key, iv);
  return `${iv.toString('hex')}:${c.update(text, 'utf8', 'hex') + c.final('hex')}`;
}

describe('settings-crypto', () => {
  const keys = deriveKeys('chave-de-teste-com-mais-de-32-caracteres!!');

  it('v2: ida e volta, com IV diferente a cada vez', () => {
    const a = encryptV2('senha-smtp-123', keys);
    const b = encryptV2('senha-smtp-123', keys);
    expect(a.startsWith('v2:')).toBe(true);
    expect(a).not.toBe(b);
    expect(decryptStrict(a, keys)).toBe('senha-smtp-123');
  });

  it('lê valores gravados no formato legado (compatibilidade com o que já está no banco)', () => {
    const k = 'sua-chave-curta-de-exemplo'; // 26 chars: completada com zeros, como antes
    expect(
      decryptStrict(legacyEncrypt('segredo antigo', k), deriveKeys(k)),
    ).toBe('segredo antigo');
  });

  it('chave errada ou valor adulterado lançam erro (GCM autentica)', () => {
    const v = encryptV2('x', keys);
    expect(() =>
      decryptStrict(v, deriveKeys('outra-chave-outra-chave-outra-chave-123')),
    ).toThrow();
    const [p, iv, tag, data] = v.split(':');
    const flipped = `${p}:${iv}:${tag}:${(parseInt(data.slice(0, 2), 16) ^ 1).toString(16).padStart(2, '0')}${data.slice(2)}`;
    expect(() => decryptStrict(flipped, keys)).toThrow();
    expect(() => decryptStrict('lixo-sem-formato', keys)).toThrow();
  });
});
