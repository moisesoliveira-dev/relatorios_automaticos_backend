# Roteiro de segurança — passos que dependem do dono da conta

Estes passos mexem em contas e segredos (GitHub, Railway, Pontta, GOSAC, Gmail). Faça na ordem.
Serviço do Railway: `relatorios-automaticos` → `relatorios_automaticos_backend` (ambiente `production`).

```bash
mkdir -p /tmp/rw && cd /tmp/rw
~/.railway/bin/railway link --project relatorios-automaticos --environment production   # escolha o backend
```

## 1. Trocar as credenciais que vazaram (URGENTE)
O arquivo `scripts/security/replacements.txt` (e senhas no job antigo) ficou público no GitHub. Troque **nos próprios sistemas** e depois atualize no Railway:

| O quê | Onde trocar | Variável no Railway (backend) |
|---|---|---|
| Chave e senha do Pontta | painel do Pontta | `PONTTA_API_KEY`, `PONTTA_PASSWORD` |
| Senha de app do Gmail (SMTP) | Conta Google → Segurança → Senhas de app | `SMTP_PASS` |
| Chave do GOSAC | painel do GOSAC | `GOSAC_API_KEY` |
| Senha do Postgres do Railway | serviço Postgres → Variables (regenerar) | `DB_PASSWORD`, `DATABASE_URL`, `ROTATION_DATABASE_URL` |
| Chave da service account do Google | Google Cloud → IAM → Service accounts → Keys | `GOOGLE_SERVICE_ACCOUNT_JSON_B64` |

Atualize (um por vez; o último comando dispara o deploy):
```bash
echo -n 'NOVO_VALOR' | ~/.railway/bin/railway variable set PONTTA_PASSWORD --stdin --skip-deploys --service relatorios_automaticos_backend
```

## 2. Tornar os repositórios privados
```bash
for r in relatorios_automaticos_backend relatorios_automaticos_frontend criar_tarefas_automaticas; do
  gh repo edit moisesoliveira-dev/$r --visibility private --accept-visibility-change-consequences
done
```
Depois confirme que o Railway continua enxergando os repositórios (Railway → Settings → Source). Se não enxergar, reautorize o app do GitHub.

## 3. Remover a chave SSH temporária
```bash
~/.railway/bin/railway ssh keys rm claude-temp
```

## 4. Trocar a ENCRYPTION_KEY (hoje é um valor de exemplo)
Ela protege as configurações sensíveis salvas no sistema. A ferramenta abaixo faz **simulação por padrão**, confere que tudo decifra, faz backup e grava numa transação.

```bash
cd relatorios_automaticos_backend && npm ci
# chave antiga = a que está no Railway hoje; nova = gerada agora
export OLD_ENCRYPTION_KEY="$(~/.railway/bin/railway variable list --service relatorios_automaticos_backend --kv | sed -n 's/^ENCRYPTION_KEY=//p')"
export NEW_ENCRYPTION_KEY="$(openssl rand -hex 32)"
# URL pública do banco (Railway → Postgres → Variables → DATABASE_PUBLIC_URL)
export DATABASE_URL='postgresql://...'
export DB_SSL=false        # mude para true se o seu Postgres exigir SSL

npm run security:rotate-key                  # 1) simulação: lista as configurações e confere
echo -n "$NEW_ENCRYPTION_KEY" | ~/.railway/bin/railway variable set ENCRYPTION_KEY --stdin --skip-deploys --service relatorios_automaticos_backend   # 2) chave nova no Railway (sem deploy)
npm run security:rotate-key -- --apply       # 3) re-criptografa o banco (cria settings_backup_<data>)
~/.railway/bin/railway redeploy --service relatorios_automaticos_backend --yes             # 4) deploy com a chave nova
```
Entre os passos 3 e 4 (1–2 min) o sistema antigo não lê essas configurações (e-mails podem falhar). Depois de confirmar que tudo funciona, apague a tabela `settings_backup_*`.

## 5. Fechar o webhook do GOSAC
Hoje ele aceita chamadas de qualquer um (sem segredo configurado, fora de produção).
```bash
SEGREDO=$(openssl rand -hex 32)
echo -n "$SEGREDO" | ~/.railway/bin/railway variable set GOSAC_WEBHOOK_SECRET --stdin --skip-deploys --service relatorios_automaticos_backend
echo "URL para o painel do GOSAC: https://relatoriosautomaticosbackend-production.up.railway.app/api/gosac/webhook?token=$SEGREDO"
```
Cadastre essa URL no painel do GOSAC **antes** do deploy (senão o GOSAC passa a receber 401 até você ajustar) e então faça o deploy.

## 6. Ligar o modo produção
Só depois dos itens 1 a 5:
```bash
~/.railway/bin/railway variable set NODE_ENV=production DB_SSL=false --service relatorios_automaticos_backend
```
`DB_SSL=false` mantém a conexão com o banco exatamente como hoje. Para ativar SSL no banco, teste separadamente (`DB_SSL=true`). Com `NODE_ENV=production` o servidor recusa subir com segredos de exemplo ou curtos.

## 7. (Opcional) Apagar os segredos do histórico do Git
Só depois de rotacionar (item 1). Reescreve o histórico e exige `force push`: `scripts/security/purge-secrets-from-history.sh`. Com os repositórios privados e as credenciais trocadas, o risco já está neutralizado.
