/**
 * Troca a ENCRYPTION_KEY re-criptografando as configurações sensíveis (tabela settings).
 *
 *   Simulação (padrão, não grava nada):
 *     OLD_ENCRYPTION_KEY=... NEW_ENCRYPTION_KEY=... DATABASE_URL=postgres://... npm run security:rotate-key
 *   Para valer:
 *     ... npm run security:rotate-key -- --apply
 *
 * Segurança: nunca imprime valores, só nomes de configurações e contagens. Antes de gravar, confere que
 * TODOS os valores decifram com a chave antiga, cria uma tabela de backup (settings_backup_<data>) e grava
 * tudo em UMA transação, conferindo que o resultado decifra com a chave nova. Qualquer falha desfaz tudo.
 *
 * Ordem segura em produção: (1) rode a simulação; (2) defina NEW como ENCRYPTION_KEY no Railway com
 * --skip-deploys; (3) rode com --apply; (4) faça o deploy. Entre (3) e (4) o sistema antigo não consegue
 * ler essas configurações por ~1–2 min (e-mails, por exemplo, falham nesse intervalo).
 */
import { Client } from 'pg';
import {
  CryptoKeys,
  decryptStrict,
  deriveKeys,
  encryptV2,
} from '../../src/settings/settings-crypto';

const PLACEHOLDER = /^(sua[_-]|change[_-]?me|troque|example)/i;

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const oldKey = process.env.OLD_ENCRYPTION_KEY;
  const newKey = process.env.NEW_ENCRYPTION_KEY;
  const url = process.env.DATABASE_URL;
  if (!oldKey || !newKey || !url)
    fail('Defina OLD_ENCRYPTION_KEY, NEW_ENCRYPTION_KEY e DATABASE_URL.');
  if (oldKey === newKey) fail('A chave nova é igual à antiga.');
  if (newKey.length < 32 || PLACEHOLDER.test(newKey))
    fail(
      'A chave nova precisa ter 32+ caracteres e não pode ser um valor de exemplo (use: openssl rand -hex 32).',
    );

  const oldKeys: CryptoKeys = deriveKeys(oldKey);
  const newKeys: CryptoKeys = deriveKeys(newKey);
  const ssl =
    process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined;
  const client = new Client({ connectionString: url, ssl });
  await client.connect();

  try {
    const { rows } = await client.query<{
      id: string;
      key: string;
      value: string;
    }>(
      'SELECT id, key, value FROM settings WHERE "isEncrypted" = true ORDER BY key',
    );
    console.log(`Configurações criptografadas encontradas: ${rows.length}`);

    const plain: Array<{
      id: string;
      key: string;
      text: string;
      format: string;
    }> = [];
    const problems: string[] = [];
    for (const row of rows) {
      try {
        plain.push({
          id: row.id,
          key: row.key,
          text: decryptStrict(row.value, oldKeys),
          format: row.value.startsWith('v2:') ? 'v2' : 'legado',
        });
      } catch {
        problems.push(row.key);
      }
    }
    for (const p of plain) console.log(`  ✔ ${p.key.padEnd(34)} (${p.format})`);
    for (const k of problems)
      console.log(`  ✖ ${k.padEnd(34)} NÃO decifra com a chave antiga`);
    if (problems.length)
      fail(
        `${problems.length} valor(es) não decifram com OLD_ENCRYPTION_KEY. Nada foi alterado. Confira se é a chave que está em produção.`,
      );

    if (!apply) {
      console.log(
        '\nSimulação concluída: tudo decifra com a chave antiga. Nada foi gravado. Rode com --apply para trocar.',
      );
      return;
    }
    if (!rows.length) {
      console.log(
        '\nNada para re-criptografar. Pode trocar a ENCRYPTION_KEY com segurança.',
      );
      return;
    }

    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
    const backup = `settings_backup_${stamp}`;
    await client.query('BEGIN');
    try {
      await client.query(
        `CREATE TABLE "${backup}" AS SELECT * FROM settings WHERE "isEncrypted" = true`,
      );
      for (const p of plain) {
        const value = encryptV2(p.text, newKeys);
        if (decryptStrict(value, newKeys) !== p.text)
          throw new Error(`conferência falhou para ${p.key}`);
        await client.query(
          'UPDATE settings SET value = $1, "updatedAt" = now() WHERE id = $2',
          [value, p.id],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      fail(`Falha ao gravar, tudo desfeito: ${(error as Error).message}`);
    }
    console.log(
      `\n✔ ${plain.length} configuração(ões) re-criptografada(s) com a chave nova (formato v2).`,
    );
    console.log(
      `  Backup dos valores antigos: tabela ${backup} (apague depois de confirmar que tudo funciona).`,
    );
    console.log(
      '  Próximo passo: faça o deploy do backend com a ENCRYPTION_KEY nova.',
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => fail(e.message));
