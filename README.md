# CMM System — Backend

API NestJS do console operacional Automi (relatórios, GOSAC, PCP, rodízio).

## Stack

- NestJS 11 · TypeORM · PostgreSQL
- Integrações: Pontta ERP, GOSAC WhatsApp, Google Drive, SMTP

## Arquitetura

O projeto adota **Clean Architecture + Hexagonal + DDD** de forma incremental. O bounded context **PCP Operacional** já está refatorado como referência.

Detalhes completos: [ARCHITECTURE.md](./ARCHITECTURE.md)

## Setup local

```bash
npm install
cp .env.development.example .env.development
# Edite .env.development com suas credenciais Pontta/GOSAC
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

Variáveis obrigatórias: `JWT_SECRET`, `ENCRYPTION_KEY`, `PONTTA_*`, `GOSAC_*`.  
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
├── contexts/pcp/          # Bounded context PCP (hexagonal)
├── infrastructure/config/ # Config validada + AppConfigService
├── gosac/                 # Integração GOSAC + webhook
├── pontta/                # Client HTTP Pontta
├── report/                # Relatórios e jobs agendados
├── rotation/              # CRUD rodízio (banco separado)
├── users/ · auth/         # Autenticação e permissões
└── settings/              # Configurações criptografadas
```

## License

MIT
