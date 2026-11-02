import { FlowState } from '../domain/chatbot.types';
import { HistoryTurn } from '../entities/chatbot-conversation.entity';

export interface AgentContext {
  state: FlowState;
  message: string;
  history: HistoryTurn[];
}

/** Moldura comum: delimita o texto do cliente como DADO não confiável. */
export function wrapCustomerMessage(message: string): string {
  const safe = message.replace(/<\/?mensagem_cliente>/gi, '').slice(0, 600);
  return `<mensagem_cliente>\n${safe}\n</mensagem_cliente>`;
}

export function renderHistory(history: HistoryTurn[]): string {
  const lines = history
    .slice(-6)
    .map((t) => `${t.role === 'cliente' ? 'Cliente' : 'Bot'}: ${t.text}`);
  return lines.length ? `Conversa recente:\n${lines.join('\n')}\n\n` : '';
}
