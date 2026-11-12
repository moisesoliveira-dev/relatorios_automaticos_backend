// Recifra as configurações sensíveis (tabela settings) da chave antiga (OLD_KEY) para a ENCRYPTION_KEY atual
// do container, e deixa o chatbot desligado e sem mensagens antigas pendentes (troca do webhook é manual).
// Uso (na VPS):
//   curl -fsSL <url deste arquivo> | docker exec -i -e OLD_KEY='<chave antiga>' <container do backend> node -
// Não imprime valores: só nomes de configurações e contagens. Tudo em uma transação (falhou = desfaz).
const { Client } = require('/app/node_modules/pg');
const {
  deriveKeys,
  decryptStrict,
  encryptV2,
} = require('/app/dist/settings/settings-crypto.js');

(async () => {
  if (!process.env.OLD_KEY) throw new Error('defina OLD_KEY');
  const oldK = deriveKeys(process.env.OLD_KEY);
  const newK = deriveKeys(process.env.ENCRYPTION_KEY);
  if (process.env.OLD_KEY === process.env.ENCRYPTION_KEY)
    throw new Error('as chaves são iguais');

  const c = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
  });
  await c.connect();

  const { rows } = await c.query(
    'SELECT id, key, value FROM settings WHERE "isEncrypted" = true',
  );
  const plain = [];
  const bad = [];
  for (const r of rows) {
    try {
      plain.push({ id: r.id, key: r.key, text: decryptStrict(r.value, oldK) });
    } catch {
      bad.push(r.key);
    }
  }
  if (bad.length) {
    console.log('ERRO: não decifram com a chave antiga:', bad.join(', '));
    process.exit(1);
  }

  await c.query('BEGIN');
  try {
    for (const p of plain) {
      const v = encryptV2(p.text, newK);
      if (decryptStrict(v, newK) !== p.text)
        throw new Error('conferência falhou para ' + p.key);
      await c.query('UPDATE settings SET value = $1, "updatedAt" = now() WHERE id = $2', [v, p.id]);
    }
    const cb = await c.query(
      `SELECT id, "isEncrypted" FROM settings WHERE key = 'CHATBOT_ENABLED'`,
    );
    if (cb.rows[0]) {
      const val = cb.rows[0].isEncrypted ? encryptV2('false', newK) : 'false';
      await c.query('UPDATE settings SET value = $1 WHERE id = $2', [val, cb.rows[0].id]);
    }
    await c.query('UPDATE chatbot_inbox SET processed_at = now() WHERE processed_at IS NULL');
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  }
  console.log('configurações recifradas:', plain.length, '| chatbot desligado na VPS');
  await c.end();
})().catch((e) => {
  console.log('ERRO:', e.message);
  process.exit(1);
});
