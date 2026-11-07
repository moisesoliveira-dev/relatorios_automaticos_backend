# Arquitetura — CMM System Backend

Este backend segue **Clean Architecture**, **Hexagonal (Ports & Adapters)** e **DDD tático** de forma incremental — sem reescrever o projeto inteiro de uma vez.

## Visão geral

O backend é um conjunto de módulos NestJS. O mais importante é o chatbot (`src/chatbot/`), que concentra as regras de negócio:

```
Presentation   controllers · DTOs · guards
Application    ChatbotService · agentes (OpenAI) · ferramentas (ToolRegistry)
Domain/engine  motor de fluxos puro (src/chatbot/engine) · mensagens · escopo
Infrastructure TypeORM · GOSAC · CMSYS (funil) · Google Drive · SMTP
```

## Módulos

| Módulo | Caminho | Papel |
|--------|---------|-------|
| Chatbot | `src/chatbot/` | Atendimento por fluxos publicados, IA, ferramentas (Drive, funil comercial) |
| Gosac / WhatsApp | `src/gosac/` | Webhook (entrega ao chatbot) e consulta de usuários/filas |
| Rodízio | `src/rotation/` | Quem atende a vez (tabela `tb_rotation`, banco separado) |
| Usuários & Auth | `src/users/`, `src/auth/` | Login, convites e abas de acesso |
| Settings | `src/settings/` | Configurações criptografadas editáveis pela tela |

Novos recursos com regras de negócio complexas devem nascer em `src/contexts/{nome}/` ou como módulo próprio, com domínio puro (sem NestJS nem axios) separado da infraestrutura.

## Configuração (12-factor)

- `src/load-env.ts` — carrega `.env.{NODE_ENV}` antes do bootstrap
- `src/infrastructure/config/env.validation.ts` — validação fail-fast
- `AppConfigService` — acesso tipado (sem secrets hardcoded nos services)

| Ambiente | Arquivo | Banco app | Rodízio |
|----------|---------|-----------|---------|
| Dev | `.env.development` | `DB_*` local | opcional |
| Prod | `.env.production` / Railway vars | `DATABASE_URL` | obrigatório |

## Princípios aplicados

1. **Dependência invertida** — regras de negócio não dependem de serviços externos nem de TypeORM
2. **Domínio puro** — `domain/` não importa NestJS nem axios
3. **Secrets no ambiente** — nenhum fallback de senha/API key no código
4. **Migrations em prod** — `synchronize: false` quando `NODE_ENV=production`

## Como rodar (entrevista / demo)

```bash
cd relatorios_automaticos_backend
cp .env.development.example .env.development
# preencha GOSAC_* com credenciais de teste

cd ..
docker compose up --build
# Frontend: http://localhost:8080  |  API: http://localhost:3000/api
```


## Chatbot com IA
Módulo `src/chatbot/`: motor de fluxos puro (`engine/`), catálogo de ferramentas (`tools/`) e agentes OpenAI (`agents/`).
Todo atendimento é um fluxo montado na tela e publicado; o atendimento da Vera é o seed. Guia: `src/chatbot/README.md`.
