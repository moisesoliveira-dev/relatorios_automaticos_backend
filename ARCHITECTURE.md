# Arquitetura — CMM System Backend

Este backend segue **Clean Architecture**, **Hexagonal (Ports & Adapters)** e **DDD tático** de forma incremental — sem reescrever o projeto inteiro de uma vez.

## Visão geral

```
┌─────────────────────────────────────────────────────────────┐
│  Presentation (NestJS)                                      │
│  Controllers · DTOs · Guards · PcpScheduleService (facade)  │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│  Application (Use Cases)                                      │
│  GetPcpScheduleUseCase · ports (interfaces)                   │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│  Domain (regras de negócio puras)                           │
│  EnvironmentClassifier · PcpConflictResolver · tipos        │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│  Infrastructure (adapters)                                  │
│  PonttaSalesOrderAdapter · TypeORM · Config · SMTP          │
└─────────────────────────────────────────────────────────────┘
```

## Bounded contexts

| Contexto | Caminho | Status |
|----------|---------|--------|
| **PCP Operacional** | `src/contexts/pcp/` | Refatorado (piloto) |
| Gosac / WhatsApp | `src/gosac/` | Módulo Nest clássico |
| Usuários & Auth | `src/users/`, `src/auth/` | Módulo Nest clássico |
| Relatórios | `src/report/` | Módulo Nest clássico |
| Rodízio | `src/rotation/` | Módulo Nest clássico |

Novos recursos com regras de negócio complexas devem nascer em `src/contexts/{nome}/`.

## PCP — exemplo hexagonal

```
contexts/pcp/
├── domain/                          # Entidades, VOs, domain services
│   ├── pcp.types.ts
│   ├── environment-classifier.ts    # Classifica ambientes → área PCP
│   └── pcp-schedule.domain.ts       # Dias úteis, conflitos, calendário
├── application/
│   ├── ports/sales-order.port.ts    # Interface (porta de saída)
│   └── get-pcp-schedule.use-case.ts # Orquestra domínio + portas
├── infrastructure/adapters/
│   └── pontta-sales-order.adapter.ts # Implementação Pontta (adapter)
└── pcp.context.module.ts            # Composition root do contexto
```

**Fluxo:** `GosacController` → `PcpScheduleService` (facade) → `GetPcpScheduleUseCase` → domain + `SalesOrderPort` → `PonttaSalesOrderAdapter`.

## Configuração (12-factor)

- `src/load-env.ts` — carrega `.env.{NODE_ENV}` antes do bootstrap
- `src/infrastructure/config/env.validation.ts` — validação fail-fast
- `AppConfigService` — acesso tipado (sem secrets hardcoded nos services)

| Ambiente | Arquivo | Banco app | Rodízio |
|----------|---------|-----------|---------|
| Dev | `.env.development` | `DB_*` local | opcional |
| Prod | `.env.production` / Railway vars | `DATABASE_URL` | obrigatório |

## Princípios aplicados

1. **Dependência invertida** — use cases dependem de ports, não de Pontta/TypeORM
2. **Domínio puro** — `domain/` não importa NestJS nem axios
3. **Secrets no ambiente** — nenhum fallback de senha/API key no código
4. **Migrations em prod** — `synchronize: false` quando `NODE_ENV=production`
5. **Evolução incremental** — próximo candidato a refatorar: módulo Gosac ou Relatórios

## Como rodar (entrevista / demo)

```bash
cd relatorios_automaticos_backend
cp .env.development.example .env.development
# preencha PONTTA_* e GOSAC_* com credenciais de teste

cd ..
docker compose up --build
# Frontend: http://localhost:8080  |  API: http://localhost:3000/api
```
