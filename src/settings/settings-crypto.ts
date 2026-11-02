import * as crypto from 'crypto';

/**
 * Criptografia das configurações sensíveis (tabela settings).
 *  - v2 (atual): "v2:<iv>:<tag>:<dados>" em AES-256-GCM, chave derivada por scrypt (autenticado).
 *  - legado:     "<iv>:<dados>" em AES-256-CBC, chave = ENCRYPTION_KEY completada com zeros até 32 bytes.
 * Usado tanto pelo SettingsService quanto pelo script de troca de chave, para nunca divergirem.
 */
export interface CryptoKeys {
  legacy: Buffer;
  v2: Buffer;
}

export function deriveKeys(encryptionKey: string): CryptoKeys {
  return {
    legacy: Buffer.from(encryptionKey.padEnd(32, '0').slice(0, 32)),
    v2: crypto.scryptSync(encryptionKey, 'cmm-settings-v2', 32),
  };
}

export function encryptV2(text: string, keys: CryptoKeys): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keys.v2, iv);
  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final(),
  ]);
  return `v2:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted.toString('hex')}`;
}

/** Decifra (v2 ou legado). Lança erro se a chave estiver errada ou o valor corrompido. */
export function decryptStrict(text: string, keys: CryptoKeys): string {
  if (text.startsWith('v2:')) {
    const [, ivHex, tagHex, dataHex] = text.split(':');
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      keys.v2,
      Buffer.from(ivHex, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  }
  const [ivHex, dataHex] = text.split(':');
  if (!ivHex || !dataHex) throw new Error('formato desconhecido');
  const decipher = crypto.createDecipheriv(
    'aes-256-cbc',
    keys.legacy,
    Buffer.from(ivHex, 'hex'),
  );
  return decipher.update(dataHex, 'hex', 'utf8') + decipher.final('utf8');
}
