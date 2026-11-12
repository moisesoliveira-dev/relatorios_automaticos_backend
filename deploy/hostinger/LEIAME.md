# Subir na VPS da Hostinger

Precisa de um plano **VPS** com o template "Ubuntu com Docker". O `docker-compose.yml` desta pasta sobe
tudo (Postgres, backend, frontend e HTTPS) e baixa o código direto do GitHub.

## Antes
1. Aponte um registro A do domínio (ex.: `sistema.seudominio.com.br`) para o IP da VPS.
2. Gere os segredos (`openssl rand -hex 32`) para `JWT_SECRET` e `ENCRYPTION_KEY`.
   Use o **mesmo `ENCRYPTION_KEY` do Railway** se for levar o banco, senão os segredos salvos não abrem.
   `GOSAC_WEBHOOK_SECRET` pode ser o mesmo do Railway.

## Pelo Gerenciador Docker do Hostinger (colando a URL)
Em Gerenciador Docker > Compose, cole a URL **crua** do arquivo (não a de `/blob/`, não o Dockerfile):

    https://raw.githubusercontent.com/moisesoliveira-dev/relatorios_automaticos_backend/main/deploy/hostinger/docker-compose.yml

Depois preencha as variáveis do `.env.example` no campo de variáveis de ambiente do projeto e implante.

## Pelo terminal da VPS (Web console), se preferir
```bash
mkdir -p ~/relatorios && cd ~/relatorios
curl -fsSLO https://raw.githubusercontent.com/moisesoliveira-dev/relatorios_automaticos_backend/main/deploy/hostinger/docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/moisesoliveira-dev/relatorios_automaticos_backend/main/deploy/hostinger/.env.example -o .env
nano .env            # preencha
docker compose up -d --build
docker compose logs -f backend
```

## Levar os dados do Railway
```bash
pg_dump --no-owner --no-acl "<DATABASE_URL pública do Railway>" > dump.sql
docker compose exec -T db psql -U relatorios relatorios < dump.sql
docker compose restart backend
```

## Depois de subir
- No GOSAC, troque o webhook para `https://SEU-DOMINIO/api/gosac/webhook?token=<GOSAC_WEBHOOK_SECRET>`.
- Firewall da Hostinger: liberar só 22, 80 e 443.
- Atualizar versão: `docker compose up -d --build --pull always` (baixa o código novo da `main`).
- A chave da OpenAI e as demais configurações do chatbot ficam no banco (tela de Ajustes), não no `.env`.
