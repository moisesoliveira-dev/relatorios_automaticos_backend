# Pontta — como funcionava (registro para simulação)

> **Status: removido.** O sistema não usa mais o Pontta. Este documento registra o que a integração fazia, para servir de base a uma simulação (servidor falso / fixtures) ou a uma futura substituição. O código original continua no histórico do git:
>
> | Repositório | Último commit com o Pontta |
> |---|---|
> | backend (`relatorios_automaticos_backend`) | `cca22e7` |
> | frontend (`relatorios_automaticos_frontend`) | `c40c2ec` |
> | `criar_tarefas_automaticas` (serviço à parte) | `5c8a038` |
>
> Para ver um arquivo antigo: `git show cca22e7:src/pontta/pontta.service.ts`.
>
> Substituto parcial: a API de integração do CMSYS (funil de leads) cobre só o "negócio" do chatbot. **Nada** substitui relatórios, tarefas automáticas, PCP, agenda de medição, orçamentos/pedidos de venda e ocorrências.

---

## 1. Contrato da API do Pontta usada

Base: `PONTTA_API_URL` (padrão `https://app.pontta.com/api`). Autenticação em `PONTTA_AUTH_URL` (padrão `https://api.pontta.com/api/authenticate`).

### 1.1 Autenticação
- `POST {authUrl}` com cabeçalho `Authorization: Bearer <PONTTA_API_KEY>` e corpo `{ "email", "password", "rememberMe": true }`.
- Resposta: `{ "id_token": "<JWT>" }`. Esse JWT vai como `Authorization: Bearer <id_token>` em todas as chamadas seguintes.
- O token durava cerca de 10 min; o sistema guardava em cache por 9 min, por e-mail. Em 401, limpava o cache e logava de novo.
- **O Pontta não aceita sessões simultâneas**: um novo login invalida o token anterior. Os jobs agendados forçavam login novo (`forceRefresh`) e não usavam cache.

### 1.2 Cabeçalhos
- `Businessunit: <PONTTA_BUSINESS_UNIT_ID>` na maioria das rotas (unidade de negócio). Em `/sales-orders/summary` o sistema tentava com o cabeçalho e, se a resposta dissesse "unidade de negócio" inválida/ausente, repetia sem ele.
- `Content-Type: application/json`.
- Respostas de criação (`POST`) devolvem corpo vazio e o **id do objeto no cabeçalho `x-pontta-params`**.
- Paginação estilo Spring: `page` (começa em 0), `size`, `sort=campo,asc|desc`. A lista pode vir como array, `{content: []}` ou `{data: {content: []}}`; o código aceitava os três.

### 1.3 Rotas usadas

| Método e caminho | Para quê | Parâmetros / corpo relevantes | Resposta (campos usados) |
|---|---|---|---|
| `GET /account` | perfil do usuário logado | — | `email`, `login` |
| `GET /collaborators/logged` | colaborador do usuário logado | — | `id` |
| `GET /collaborators` | achar colaborador por e-mail (reserva) | `page=0&size=200` | lista com `id`, `email`, `user.email`, `login` |
| `GET /users` | buscar usuários (rodízio) | `q`, `page=0`, `size=25`, `sort=name` | `id`, `cooperatorId`, `name`, `email`, `activated`, `blocked`. **O `cooperatorId` era o id usado nos rodízios.** |
| `GET /occurrences/summary` | ocorrências (relatório) | `status=NEW,OPEN,PENDING,WAITING,IN_PROGRESS,RESOLVED`, `date=global.createdAt`, `page`, `size=100`, `sort=createdDate,desc` | `number`, `title`, `status`, `responsible.name`, `deadline`, `createdDate`, `occurrenceType.name`, `tags[0].name`, `contactName`, `salesOrderCode` |
| `POST /occurrences` | criar ocorrência ligada a um pedido | `{id:null, type:"OCCURRENCE", title, note, salesOrderCode, salesOrderId, occurrenceDate:null, debitResponsible:false, cost:null, deadline:null, occurrenceTypeId:null, occurrenceTeamId:null, responsibleId:null, causedById:null, reference:null, contactExist:true, tagIds:[]}` | id no cabeçalho `x-pontta-params` |
| `POST /file-storage/OCCURRENCE/{id}` | anexar arquivo | multipart, campo `file` | — |
| `GET /sales-orders/summary` | pedidos de venda (busca e por período) | `status=VALID`, `q` (busca) ou `start`/`end` (ISO), `page`, `size`, `sort=saleDate,number,desc` | `id`, `code` (ou `number`), `saleDate`, `customer.name`/`customerName`, `deliveryDate` (ou `delivery_date`, `expectedDeliveryDate`, `forecastDeliveryDate`) |
| `GET /sales-orders?code={code}` | detalhe do pedido | — | `id`, `code`, `saleDate`, `items[].name` (os ambientes) |
| `GET /sales-orders/{id}/items` (alternativas: `/versions/items`, `/items/{id}`) | itens/ambientes do pedido | tenta cada rota e segue em 404/405 | lista de itens (`name`, valores) |
| `GET /proposals/summary` | orçamentos ativos | `status=ACTIVED`, `q`, `page`, `size=10`, `sort=createdAt,desc` | lista de orçamentos |
| `GET /proposals/{id}/versions/items` | ambientes do orçamento | — | lista de itens |
| `GET /revenues/find-by-sales-order/{code}` | receita ligada ao pedido | — (404 = sem receita) | `references.SALES_ORDER_ID` |
| `GET /tasks/SALES_ORDER/{id}/metadata/summary` | tarefas do pedido | `page=0&size=100` | `title`, `stage`, `deadline`, `schedule`, `moment`, `alert`, `createdDate` |
| `POST /tasks/SALES_ORDER/{id}` | criar tarefa no pedido | `{id:null, title, responsible, comment:null, alert, deadline, time, type:"OTHER", workflowPositionId:null, note:null}` | — |
| `GET /schedules` | compromissos de um responsável | `start`, `end` (ISO **sem fuso**, ex. `2025-07-04T07:00:00`), `owner` | lista com `start`, `end` |
| `POST /schedules` | criar compromisso (medição) | `{title, note, location:"", ownerId, start, end}` (UTC com `Z`) | — |
| `POST /deals` | criar negócio no funil | `{id:null, title, name:null, email, phone, responsible, workflowId, customer:null, contactId:null, contactType:null, contactInternalId:null, tagIds:[], partnerIds:[], custom:{}}` | id no cabeçalho `x-pontta-params` |

Limites observados: o PCP recebia **429** (muitas requisições); o adaptador repetia até 4 vezes com espera 1 s, 2 s, 4 s, 8 s.

---

## 2. O que cada parte do sistema fazia

### 2.1 Chatbot (já documentado em `docs/chatbot-verador/`)
- **Agenda de medição** (`agenda.oferecer_horarios` e `agenda.reservar`): lia os compromissos do responsável (`GET /schedules`) numa janela de 5 dias úteis e calculava horários livres de 2 h (segunda a sexta, só até as 17h de Manaus, até 8 opções). Ao escolher, relia a agenda, reservava com chave primária (tabela `chatbot_booked_slot`, um único vencedor) e criava o compromisso **"Tirar medidas:"** com a nota "Precisa entrar em contato com {nome} do número {numero}, para saber a localização da medição e substituir esta mensagem."
- **Negócio no funil** (`POST /deals`): ao encaminhar para o atendente, criava o negócio com o nome do cliente, o telefone, o responsável do rodízio e o funil (workflow) configurado.
- Estava **desligado** (`CHATBOT_PONTTA_ENABLED=false`). O negócio foi trocado pelo funil do CMSYS. A agenda continua sem substituto.

### 2.2 Relatório de ocorrências (por e-mail)
`report.service`: autentica, busca **todas** as ocorrências (1ª página para saber o tamanho; depois 10 páginas em paralelo até acabar), filtra por data/limite, reduz aos campos `number, title, status, responsibleName, deadline, createdDate, occurrenceTypeName, tagName, contactName, salesOrderCode`, gera Excel/CSV e envia por e-mail (assunto "Relatório de Ocorrências Pontta - {data}") para o destinatário e/ou e-mails fixos cadastrados. Cada execução gravava um registro (`report_executions`) com status e quantidade de registros. Também havia jobs agendados (`scheduled_jobs`: diário, semanal, mensal) e painel com saúde dos serviços (`api_backend`, `database`, `api_pontta`, `email_server`).

### 2.3 Jobs em código
- **`auto-tasks`** (tarefas automáticas): ver 2.4.
- **`delivery-material-dates`**: para os pedidos válidos do dia (período em Manaus), busca a receita (`/revenues/find-by-sales-order/{code}`) para achar o `SALES_ORDER_ID`, lê as tarefas do pedido e, nos ambientes com a tarefa **"Aprovação do Projeto Executivo" concluída**, monta uma tabela de datas de entrega de material. Gera um PDF e salva no Google Drive (pasta mensal de `GOOGLE_DRIVE_DELIVERY_FOLDER_ID`).

### 2.4 Tarefas automáticas (também existia como serviço à parte, `criar_tarefas_automaticas`)
- Horários: 11:00, 15:00 e 23:59 (Manaus). A cada execução busca pedidos de venda (`/sales-orders/summary` por período) de hoje e dos **7 dias anteriores** (recupera falhas), descarta os já processados (tabela `auto_task_processed_orders`, chave = código do pedido) e lê o detalhe de cada um (`/sales-orders?code=`, com pausa de 500 ms).
- Para cada **ambiente** (`items[].name`), na ordem, cria **5 tarefas** (`POST /tasks/SALES_ORDER/{id}`) com título `NN - {ambiente} {etapa}` (NN = 01, 02, ...; o número do ambiente):
  1. **Checagem de medida** — prazo = data da venda + `TASK_DIAS_CHECAGEM_MEDIDA` dias úteis (padrão 2); se o projetista já tem checagem nesse dia, empurra para o próximo dia válido; usa `time`/`alert` de um horário livre do projetista.
  2. **Revisão do Projeto** — + `TASK_DIAS_REVISAO_PROJETO` dias úteis.
  3. **Projeto Executivo** — + `TASK_DIAS_PROJETO_EXECUTIVO`.
  4. **Envio para o Cliente** — mesma data do projeto executivo.
  5. **Aprovação do Projeto Executivo** — + `TASK_DIAS_APROVACAO_EXECUTIVO`.
- Dias úteis ignoram fins de semana e feriados de Manaus. Datas em calendário de Manaus.
- **Responsável**: um projetista por ambiente (as 5 tarefas ficam com a mesma pessoa), em **rodízio** (tabela `tb_pontta_rotation`: `projetistaid` = id do cooperador no Pontta, `turn`, `name`, `turn_v`, `pcp_area`). Com a opção `AUTO_TASKS_ASSIGN_BY_PCP_AREA` ligada, o rodízio é por **área PCP** (`molhada`, `intima`, `social`), classificando o nome do ambiente por palavras-chave (com ajustes manuais por ambiente). Havia um caso especial: quando o responsável era um projetista específico (Vitor Libório), a checagem de medida ia para outro projetista, num rodízio próprio.
- O pedido só era marcado como processado se ao menos um ambiente gerasse tarefas.

### 2.5 PCP operacional
Calendário de produção por pedido. Fonte: pedidos (`/sales-orders/summary`, de 365 dias atrás a 90 à frente, até 8 páginas de 100; cache de 5 min; busca por `q`) e tarefas de cada pedido (`/tasks/.../metadata/summary`, concorrência 5).
- **Data base** = maior prazo (`deadline`, senão `schedule`, `moment`, `alert`) entre as tarefas cujo título casa com "aprovação do projeto executivo", concluída ou não.
- Cada ambiente é classificado numa área e recebe data = data base + dias úteis da área: **molhada 15, íntima 22, social 29** (configurável). Datas de entrega caem em **terça, quinta ou sexta** (`adjustToTueThuFri`), e o sistema evita conflitos de dia entre áreas/pedidos.
- Telas: tabela de pedidos, calendário e configuração das áreas; ajustes manuais de classificação por ambiente (`pcp_environment_overrides`).

### 2.6 GOSAC ↔ Pontta (tela "Grupos")
Cadastrava um **grupo do WhatsApp (GOSAC)** associado a um **pedido de venda**: busca pedidos (`/sales-orders/summary?q=`), guarda uma cópia (`pontta_sales_orders`: `ponttaId`, `code`, `customerName`) e o vínculo (`gosac_sales_order_links`), 1 pedido por grupo. Em segundo plano criava uma **ocorrência** no Pontta (`POST /occurrences`, nota "criada automaticamente para receber anexos do grupo GOSAC ..."), guardando id, número e status (`pending`, `created`, `failed`). O envio de arquivos para a ocorrência existia no serviço (`/file-storage/OCCURRENCE/{id}`). Também movia o ticket do GOSAC para a fila/atendente fixos (atendente 71, fila 62, status `open`).

### 2.7 Pagamento do montador (PDF)
Escolhia um **orçamento** (`/proposals/summary`, itens em `/proposals/{id}/versions/items`) ou um **pedido** (`/sales-orders/{id}/items`), o usuário informava o valor de cada ambiente (e desconto) e o sistema gerava um PDF de pagamento (com logotipo enviado pela tela) e podia salvá-lo no Drive.

### 2.8 Rodízio
Duas listas: `tb_rotation` (GOSAC: usuário e fila do atendimento — **continua em uso pelo chatbot**; `id` era o cooperador do Pontta, `name` o nome no GOSAC, `identificacao` o id do usuário no GOSAC, `queueid` a fila) e `tb_pontta_rotation` (projetistas das tarefas, removida). A tela buscava usuários do Pontta (`GET /users?q=`) para preencher o id.

---

## 3. Como simular

Um servidor falso do Pontta precisa de, no mínimo:
1. `POST /authenticate` → `{"id_token":"fake"}` (aceitar qualquer e-mail/senha).
2. Rotas do item 1.3 com os formatos de resposta da tabela. Nas criações, devolver corpo vazio e o cabeçalho `x-pontta-params: <uuid>`.
3. Comportamentos que valem simular: 401 com token vencido, 429 intermitente, paginação com última página incompleta, 404 em `/revenues/...` (pedido sem receita), 404/405 nas duas primeiras rotas de itens do pedido, e horário já ocupado na agenda.

Fixtures úteis:
```json
// GET /sales-orders/summary
[{ "id": "7c1f...", "code": "PV-CM-600", "saleDate": "2026-11-03T14:20:00Z",
   "customer": { "name": "Karina Santos" }, "deliveryDate": "2026-12-15" }]

// GET /sales-orders?code=PV-CM-600
{ "id": "7c1f...", "code": "PV-CM-600", "saleDate": "2026-11-03T14:20:00Z",
  "items": [{ "name": "Cozinha" }, { "name": "Dormitório Casal" }, { "name": "Banheiro Social" }] }

// GET /tasks/SALES_ORDER/{id}/metadata/summary
[{ "title": "01 - Cozinha Aprovação do Projeto Executivo", "stage": "FINISHED",
   "deadline": "2026-11-20T23:59:59Z" }]

// GET /schedules?start=2026-11-09T07:00:00&end=2026-11-14T17:00:00&owner=<id>
[{ "start": "2026-11-09T11:00:00Z", "end": "2026-11-09T13:00:00Z" }]
```

No chatbot, a forma mais simples de simular a agenda sem o Pontta é implementar a `ToolDefinition` `agenda.*` sobre uma tabela própria de compromissos (o simulador de fluxos já chama `simular()` das ferramentas, sem efeitos externos).
