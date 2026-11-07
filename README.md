# CMM System — Backend

API NestJS do console operacional Automi: atendimento por WhatsApp com IA (chatbot), rodízio de atendentes, usuários e configurações.

## Stack

- NestJS 11 · TypeORM · PostgreSQL
- Integrações: GOSAC WhatsApp, OpenAI, Funil comercial do CMSYS (API de integração), Google Drive, SMTP

> O Pontta (relatórios, tarefas automáticas, PCP, agenda) foi removido. O que ele fazia está registrado em [docs/pontta-legado/COMO-FUNCIONAVA.md](./docs/pontta-legado/COMO-FUNCIONAVA.md).

Detalhes de arquitetura: [ARCHITECTURE.md](./ARCHITECTURE.md)

## Setup local

```bash
npm install
cp .env.development.example .env.development
# Edite .env.development com suas credenciais GOSAC
npm run start:dev
```

Com Docker (recomendado — sobe Postgres + backend + frontend):

```bash
cd ..
docker compose up --build
```

## Variáveis de ambiente

| Arquivo | Uso |
|---------|-----|
| `.env.development` | Desenvolvimento local (gitignored) |
| `.env.production` | Produção / Railway (gitignored) |
| `.env.development.example` | Template dev (commitado) |
| `.env.production.example` | Template prod (commitado) |

Variáveis obrigatórias: `JWT_SECRET`, `ENCRYPTION_KEY`, `GOSAC_*`.  
Em produção: também `DATABASE_URL` e `ROTATION_DATABASE_URL`.

## Scripts

```bash
npm run start:dev    # watch mode
npm run build        # compila TypeScript
npm run start:prod   # produção (dist/)
npm run test         # testes unitários
```

## Estrutura principal

```
src/
├── chatbot/               # Chatbot com IA: motor de fluxos, ferramentas, agentes
├── infrastructure/config/ # Config validada + AppConfigService
├── gosac/                 # Webhook do GOSAC + consulta de usuários e filas
├── rotation/              # CRUD do rodízio (banco separado)
├── drive/                 # Google Drive
├── email/                 # Envio de e-mail (convites)
├── users/ · auth/         # Autenticação e permissões (abas: rodizio, ia, usuarios, configuracoes)
└── settings/              # Configurações criptografadas
```

## License

MIT
