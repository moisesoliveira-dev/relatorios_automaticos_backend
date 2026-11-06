# Chatbot (Vera D'Or) — motor de fluxos

Tudo que o bot faz é um **fluxo** feito de **etapas**, montado na tela *IA › Atendimento* e publicado.
O atendimento da Vera (menu, nome, arquivos, ambientes, agendamento, boleto, loja, cliente conhecido)
é um conjunto de fluxos como qualquer outro, gerado por `engine/flow.seed.ts` a partir dos textos
originais do n8n (`domain/chatbot.messages.ts`). Depois de publicado, é editável.

```
chatbot/
├── engine/                 # puro: sem NestJS, sem banco, sem rede
│   ├── flow.types.ts       # FlowDoc, etapas (NodeType), FlowState, FlowInput, Reply, Effect
│   ├── flow.engine.ts      # startFlow · stepFlow · resumeTool · parseText · promptOf
│   ├── flow.validate.ts    # checkFlow / checkDoc (o que impede de publicar) + contextos (ordem)
│   ├── flow.seed.ts        # o atendimento da Vera como fluxos + mensagens do sistema padrão
│   ├── legacy.ts           # converte o conteúdo publicado pela versão anterior da tela
│   ├── tool.types.ts       # contrato das ferramentas (ToolDefinition, params, requer/produz)
│   └── text.ts             # normalização, validações (nome, número, telefone, e-mail), {variáveis}
├── tools/                  # ferramentas que os fluxos podem usar
│   ├── tool.registry.ts    # catálogo (ToolRegistry); registre aqui as novas
│   ├── drive.tools.ts      # drive.criar_pasta · drive.salvar_respostas
│   ├── agenda.tools.ts     # agenda.oferecer_horarios (escolha) · agenda.reservar
│   └── conversa.tools.ts   # conversa.definir (guardar um valor)
├── agents/                 # IA (OpenAI): escopo, intérprete, FAQ, verificador, redator
├── domain/                 # textos originais, specs do redator, base de conhecimento, guards
├── services/               # orquestração (ChatbotService), conteúdo, admin/simulador, integrações
└── entities/               # chatbot_conversations (step BOT|HUMANO + flow jsonb), inbox, reservas
```

## Como uma mensagem é atendida

1. **Webhook** (`GosacWebhookController`) → `ChatbotService.receive` → caixa de entrada no Postgres
   (dedupe, debounce) → trava por cliente → `process(batch)`.
2. Regras globais do serviço (as do chatbot antigo): cliente novo começa pelo fluxo **Início**;
   ticket novo de cliente conhecido vai ao fluxo **Cliente conhecido**; com atendente humano o bot
   cala (e reinicia após ociosidade); áudio avisa; arquivos vão para a pasta do Drive se existir.
3. **Interpretação**: `parseText` (sem IA: números, 0/10, OK, palavras-chave das opções, validações).
   Texto livre vai aos agentes: pré-filtro → escopo ‖ intérprete → FAQ → verificador. A saída é
   sempre um `FlowInput`; **a IA nunca decide transições**.
4. **Motor**: `stepFlow` devolve o novo estado, os textos (`Reply[]`, com a especificação do que o
   Redator precisa manter) e os efeitos (`ferramenta` ou `handoff`).
5. **Serviço**: salva o estado, envia os textos (Redator reescreve com voz natural quando ligado),
   executa a ferramenta pelo `ToolRegistry` e continua com `resumeTool` até a próxima etapa que
   espera o cliente. Resposta inválida: 1ª avisa, as seguintes ficam em silêncio e, no limite,
   encaminha. Fora de escopo soma advertências.

## Etapas disponíveis

| Tipo | O que faz |
|---|---|
| `mensagem` | Informa e segue. |
| `pergunta` | Espera uma resposta e guarda em `variavel` (validação: texto, nome, número, telefone, e-mail). |
| `opcoes` | Menu numerado; cada opção tem destino, valor e palavras-chave. |
| `confirmacao` | Sim/Não fixos. |
| `multipla` | Vários itens numa mensagem (“2 1 3”), confirma com OK, opção “nenhum”. |
| `arquivos` | Pede arquivos (mínimo); vão para a pasta do cliente. |
| `ferramenta` | Executa uma ferramenta do catálogo; `falha` e `semOpcoes` são caminhos alternativos. |
| `condicao` | Ramifica pelas variáveis (igual, diferente, contém, vazio, respondida). |
| `ir_para` | Continua em outro fluxo (variáveis preservadas). |
| `encaminhar` | Entrega a um atendente (rodízio; opcionalmente o mesmo de antes). |
| `fim` | Termina e volta ao fluxo de início. |

Regras do motor (não dependem do fluxo): `0` volta uma etapa, `10` recomeça, `OK` confirma listas e
arquivos, pedido de atendente encaminha, rodapés e avisos vêm das **mensagens do sistema**
(`ContentDoc.sistema`, editáveis em *Avisos e padrões*).

## Como adicionar uma ferramenta

1. Crie `tools/<nome>.tools.ts` exportando uma função que devolve `ToolDefinition[]`:
   - `key`, `label`, `descricao`, `grupo`, `modo` (`acao` ou `escolha`);
   - `params` (`ParamSpec[]`): a tela monta o formulário sozinha; `template: true` aceita `{variáveis}`;
     `define: true` (tipo `variavel`) cria uma variável para as etapas seguintes;
   - `requer` (variáveis / pasta do Drive necessárias antes) e `produz` (o que deixa pronto): a
     validação e os avisos da tela usam isso;
   - `disponivel()` / `indisponivelPorque()`; `executar(ctx)`; `simular(ctx)` (prévia e simulador).
2. Registre em `tools/tool.registry.ts` (ou chame `registry.register(...)` de outro módulo).

Nada mais muda: motor, validação, simulador, prévia e a tela leem o catálogo.

## Conteúdo publicado

`ChatbotContentService` guarda em `settings` (categoria `chatbot_content`) o documento publicado, o
rascunho e a versão anterior. Documentos da versão antiga da tela são convertidos na leitura
(`engine/legacy.ts`): textos editados caem nas etapas do seed, ambientes renomeados nas listas,
opções 4/5 desativadas saem do menu e fluxos próprios viram fluxos do motor.

## Testes

`src/chatbot/__tests__/engine.spec.ts` percorre o atendimento da Vera de ponta a ponta com o motor
puro (sem IA), cobre condição / ir para / ferramenta, a validação e a conversão do conteúdo antigo.
`npm run chatbot:eval` avalia os agentes com a OpenAI real contra `scripts/chatbot/eval-dataset.json`.
