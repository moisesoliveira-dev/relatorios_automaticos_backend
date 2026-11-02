/**
 * Textos e tabelas do chatbot "Vera D'Or" (Cinthia Moreira Modulados).
 * Fonte: workflows n8n do projeto Railway "verador". Os textos são a fonte de verdade do
 * que o cliente lê — a IA NUNCA os reescreve; ela só interpreta o que o cliente escreveu.
 */

export const MESSAGES = {
  menu_inicial:
    'Olá! Seja bem-vindo à Cinthia Moreira Modulados 👋\nSou a Vera D’Or, sua atendente virtual 🤖✨\nComo posso te ajudar hoje?\n\n*1* - 📐 Já tenho o projeto e quero orçar.\n*2* - 📏 Só tenho a planta baixa e quero um projeto.\n*3* - 🚫 Não tenho nem o projeto e nem a planta baixa.\n*4* - 💳 Quero informações sobre forma de pagamento por boleto bancário.\n*5* - 📍 Qual endereço da loja física?\n\n👉 *Envie o número da opção desejada.*',
  menu_reapresentado:
    '😊 Se quiser pode selecionar outra forma de atendimento, caso contrário... ignorar esta mensagem!\n\n*1* - 📐 Já tenho o projeto e quero orçar.\n*2* - 📏 Só tenho a planta baixa e quero um projeto.\n*3* - 🚫 Não tenho nem o projeto e nem a planta baixa.\n*4* - 💳 Quero informações sobre forma de pagamento por boleto bancário.\n*5* - 📍 Qual endereço da loja física?\n\n👉 *Envie o número da opção desejada.*',
  pedir_nome:
    'Antes de prosseguirmos, você pode me informar seu nome, por gentileza? 😊\n\n0 - ↩️ Voltar uma etapa\n10 - 🔄 Recomeçar o atendimento',
  pedir_projeto:
    '📎 Pode enviar o projeto aqui mesmo.\nPode ser em PDF, imagem ou qualquer outro formato que você tiver.\n\n👋🛠 Assim que recebermos, um atendente humano vai te chamar por aqui para dar sequência na criação do seu projeto. ✨\n\nEstamos animados para te ajudar a transformar seu ambiente! 🏡\n\n0 - ↩️ Voltar uma etapa\n10 - 🔄 Recomeçar o atendimento',
  confirmar_nome:
    'Só confirmando, seu nome é *{nome}*, certo? 😊\n\n*1* - Sim\n*2* - Não\n\n10 - 🔄 Recomeçar o atendimento\n\n👉 *Envie o número da opção desejada.*',
  casa_ou_ap:
    'Me diz uma coisa:\n\n🏠 É uma *casa* ou\n🏢 Um *apartamento*?\n\nPor favor, responda com o *número*:\n*1* - Casa\n*2* - Apartamento\n\n0 - ↩️ Voltar uma etapa\n10 - 🔄 Recomeçar o atendimento\n\n👉 *Envie o número da opção desejada.*',
  planta_instrucoes:
    '📌 Para que possamos te ajudar da melhor forma, por favor, siga os passos abaixo:\n\n1️⃣ Acesse o site da construtora ou do condomínio responsável pelo seu imóvel. 🌐\n2️⃣ Procure pela planta baixa do seu apartamento. 🔍\n3️⃣ Tire um print (captura de tela) ou baixe a imagem da planta. 📸\n4️⃣ Envie a imagem aqui mesmo por esta conversa. 📲',
  planta_achou_ou_nao:
    '🔎 Selecione uma das duas opções para continuarmos com o atendimento. 🚀\n\n*1* - ✅ Achei e enviei a imagem da planta baixa.\n*2* - ❌ Não encontrei a minha planta baixa.\n\n0 - ↩️ Voltar uma etapa\n10 - 🔄 Recomeçar o atendimento',
  ambientes_categorias:
    '📝 Para finalizarmos, você pode me informar qual ambiente deseja ver e projetar?\n\nMande cada número separadamente na mesma mensagem, exemplo: *2 1 3*\n\nAs opções são:\n\n*1* - 🍳 Cozinha\n*2* - 🛋️ Sala de Estar\n*3* - 🛏️ Dormitório\n*4* - 🚿 Banheiro\n*5* - 🍽️ Sala de Jantar\n*6* - 🍻 Canto Alemão\n*7* - 💻 Home Office\n*8* - 🏢 Ambiente Coorporativo\n*9* - ❌ Nenhum destes ambientes\n\n0 - ↩️ Voltar para etapa anterior.\n10 - 🔄 Recomeçar o atendimento.\n\n👉 *Envie o número da opção desejada.*',
  agendar_medicao_pergunta:
    'Podemos agendar uma visita para realizar as medições necessárias.\n\n📅 Deseja agendar um horário com nossa equipe?\n\n*1* -  Quero agendar 📝\n*2* - Não quero agendar ❌\n\n0 - ↩️ Voltar uma etapa\n10 - 🔄 Recomeçar o atendimento\n\n👉 *Envie o número da opção desejada.*',
  escolher_horario:
    'Para finalizarmos com o atendimento, por favor, escolha o melhor horário para realizarmos a medição 🕐📏\n\n*1 - {horario1}*\n2 - {horario2}\n*3 - {horario3}*\n4 - {horario4}\n*5 - {horario5}*\n6 - {horario6}\n*7 - {horario7}*\n8 - {horario8}\n*9 - Nenhum desses horários.*\n\n0 - ↩️ Voltar uma etapa\n10 - 🔄 Recomeçar o atendimento\n\n👉 *Envie o número da opção desejada.*',
  horario_agendado:
    'Entendi!\n\nAgora vou te direcionar para que o responsável possa falar com você sobre a medição no local.\n\nEle poderá confirmar todos os detalhes com você. 👷📏\n\n⏳ Aguarde um momento, por favor!',
  horario_indisponivel:
    'Ops! 😅 O horário que você escolheu já foi agendado por outra pessoa. Por favor, selecione outro horário disponível. ⏰',
  nao_quer_agendar:
    '❌ Tudo bem, sem problemas!\n\nCaso mude de ideia no futuro ou precise de ajuda com qualquer outra coisa, estaremos à disposição.\n\n🙏 Obrigado pelo seu tempo e tenha um ótimo dia! ☀️',
  info_boleto:
    '✨ Transforme seu espaço com inteligência e bom gosto. Você pode adquirir seu ambiente planejado com ou sem entrada, e ainda contar com o privilégio de iniciar o pagamento em até 60 dias. Sofisticação também é ter flexibilidade. 🏡💼',
  pergunta_visita_boleto:
    '💳 Vi que você demonstrou interesse nas formas de pagamento.\n\nGostaria de agendar uma visita para conversarmos com mais detalhes? 🗓️\n\n*Responda com:* \n*1* - 🤝 Sim, quero agendar \n*2* - 👋 Não, obrigado(a)\n\n10 - 🔄 Voltar para o início\n\n👉 *Envie o número da opção desejada.*',
  endereco_loja:
    '📍 Nosso endereço:\n\nAv. Djalma Batista, 1334\nCM Modulados - Loja Djalma\n\n📞 (92) 99455-1471\n📍 https://g.co/kgs/RrF1q24',
  pergunta_visita_loja:
    '🏠 Que tal fazer uma visita à nossa loja? Será um prazer te receber pessoalmente! 😊\n\nAssim podemos te mostrar opções, esclarecer dúvidas e avançar com seu projeto.\n\n*Deseja agendar uma visita?*\n*1* - 🤝 Sim, quero agendar\n*2* - 👋 Não, obrigado(a)\n\n10 - 🔄 Voltar para o inicio\n\n👉 *Envie o número da opção desejada.*',
  referencias_ok:
    '✅ Depois que finalizar... envie a palavra *OK* para confirmar sua escolha e lhe redirecionar para o atendente. 😉',
  aguardar_ok_atendente:
    '✅ Depois que finalizar... envie a palavra *OK* para redirecionar você para o atendente. 😉',
  aguardar_ok_continuar:
    '✅ Depois que finalizar... envie a palavra *OK* para continuarmos com o atendimento. 😉',
  reconhecimento:
    '👋 Olá! Percebemos que você já falou com nossos atendentes!\n\nDeseja reiniciar o atendimento com a Vera D’or 🤖 ou prefere falar diretamente com um atendente projetista 👷‍♀️?\n\nPor favor, escolha uma das opções abaixo para continuarmos:\n\n*1* - Quero começar de novo 🔄\n*2* - Falar com um atendente 👤\n\n👉 *Envie o número da opção desejada.*',
  reinicio_por_pausa:
    '⏳ Como houve uma pausa no atendimento, vamos reiniciar o atendimento. 😊',
  redirecionando_projetistas:
    '✅ Tudo certo por aqui!\nAgora vou te encaminhar para o nosso time de Projetistas 💼, que vai continuar te atendendo com toda atenção e carinho. 💖\n\nAguarde só um instante… já estou lhe redirecionando! 🔄',
  redirecionando_projetistas_com_nome:
    '✅ Tudo certo por aqui!\nAgora vou te encaminhar para o nosso time de Projetistas 💼, que vai continuar te atendendo com toda atenção e carinho. 💖\n\nAguarde só um instante, *{nome}*… já estou lhe redirecionando! 🔄',
  invalida_generica:
    '😊 Ops! Por favor, envie uma das opções que solicitamos na mensagem anterior.',
  invalida_nome_1_etapa:
    '😊 Ops! Por favor, envie um nome válido.\n\nFalta apenas 1️⃣ etapa para lhe *redirecionar para o atendente.*',
  invalida_nome_2_etapas:
    '😊 Ops! Por favor, envie um nome válido.\n\nFaltam apenas 2️⃣ etapas para lhe *redirecionar para o atendente.*',
  invalida_arquivos:
    '😊 Ops! Envie os arquivos que solicitamos, se já enviou... confirme com a palavra que pedimos.\n\nFalta apenas esta etapa para lhe *redirecionar para o atendente.*',
  invalida_ambientes:
    '😊 Ops! Por favor, envie as opções dos ambientes, se já enviou... mande a palavra de confirmação que pedimos.\n\nEsta é a última etapa antes de lhe *redirecionar para o atendente.*',
  invalida_horario:
    '😊 Ops! Por favor, envie uma das opções que pedimos nesta etapa.\n\nVocê está nos momentos finais antes de falar com o *atendimento humano* 🙋',
  invalida_nome:
    '😊 Ops! Por favor, envie um nome válido.\n\nFaltam poucas etapas para lhe *redirecionar para o atendente.*',
  fora_escopo:
    '😊 Eu só consigo ajudar com assuntos da Cinthia Moreira Modulados: projetos, orçamentos, medições e móveis planejados.\n\nVamos continuar de onde paramos?',
  fora_escopo_limite:
    'Para manter o atendimento focado, vou seguir apenas com as opções do atendimento sobre móveis planejados. 🙂\n\nSe precisar falar com uma pessoa, envie *10* para recomeçar e escolha a opção desejada.',
  audio_nao_suportado:
    '🎧 Ainda não consigo ouvir áudios por aqui. Pode me enviar por texto, por favor? 😊',
} as const;

export type MessageKey = keyof typeof MESSAGES;

/** Categorias de ambiente (opções 1–8 do passo de ambientes). */
export const CATEGORIAS_AMBIENTE: Record<number, string> = {
  1: 'Cozinha',
  2: 'Sala de Estar',
  3: 'Dormitório',
  4: 'Banheiro',
  5: 'Sala de Jantar',
  6: 'Canto Alemão',
  7: 'Home Office',
  8: 'Ambiente Coorporativo',
};
