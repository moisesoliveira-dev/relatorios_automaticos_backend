import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { AppConfigService } from '../../infrastructure/config/app-config.service';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Envio de mensagens e gestão de tickets no GOSAC (WhatsApp). */
@Injectable()
export class GosacMessengerService {
  private readonly logger = new Logger(GosacMessengerService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly appConfig: AppConfigService;

  constructor(appConfig: AppConfigService) {
    this.appConfig = appConfig;
    const gosac = appConfig.gosacApi;
    this.baseUrl = (gosac.baseUrl ?? '').replace(/\/+$/, '');
    this.apiKey = gosac.apiKey ?? '';
  }

  get host(): string {
    try {
      return new URL(this.baseUrl).hostname.toLowerCase();
    } catch {
      return '';
    }
  }

  private get headers() {
    return {
      Authorization: `INTEGRATION ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  private async withRetry<T>(
    label: string,
    fn: () => Promise<T>,
    attempts = 3,
  ): Promise<T> {
    let lastError: unknown;
    for (let i = 1; i <= attempts; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        const status = error?.response?.status;
        // 4xx (exceto 429) não melhora tentando de novo
        if (status && status >= 400 && status < 500 && status !== 429) break;
        await sleep(400 * i);
      }
    }
    this.logger.error(
      `${label} falhou: ${(lastError as any)?.response?.status ?? ''} ${(lastError as any)?.message}`,
    );
    throw lastError;
  }

  async sendText(ticketId: number, body: string): Promise<void> {
    await this.withRetry(`sendText #${ticketId}`, () =>
      axios.post(
        `${this.baseUrl}/api/messages/${ticketId}`,
        { body },
        { headers: this.headers, timeout: 15000 },
      ),
    );
  }

  /** Tempo de "digitando": cresce com o tamanho do texto, com um pouco de variação — como uma pessoa. */
  private typingMs(text: string): number {
    return (
      Math.min(2600, 500 + text.length * 12) + Math.floor(Math.random() * 400)
    );
  }

  /** Envia vários textos em ordem, cada um depois de uma pausa natural. */
  async sendTexts(ticketId: number, bodies: string[]): Promise<void> {
    for (let i = 0; i < bodies.length; i++) {
      if (this.appConfig.chatbot.typingDelay)
        await sleep(this.typingMs(bodies[i]));
      else if (i > 0) await sleep(300);
      await this.sendText(ticketId, bodies[i]);
    }
  }

  /** Atribui o ticket a um atendente/fila e/ou muda o status ("pending" devolve para a fila de atendimento humano). */
  async updateTicket(
    ticketId: number,
    data: {
      userId?: number | null;
      queueId?: number | null;
      status?: 'open' | 'pending' | 'closed';
    },
  ): Promise<void> {
    const payload: Record<string, unknown> = {};
    if (data.userId != null) payload.userId = data.userId;
    if (data.queueId != null) payload.queueId = data.queueId;
    if (data.status) payload.status = data.status;
    await this.withRetry(`updateTicket #${ticketId}`, () =>
      axios.put(`${this.baseUrl}/api/tickets/${ticketId}`, payload, {
        headers: this.headers,
        timeout: 15000,
      }),
    );
  }

  /** Baixa uma mídia recebida. A chave só é enviada ao host do próprio GOSAC (anti-SSRF / vazamento). */
  async downloadMedia(
    url: string,
    allowedHosts: string[],
  ): Promise<{ data: Buffer; contentType: string; filename?: string }> {
    const parsed = new URL(url);
    if (!allowedHosts.includes(parsed.hostname.toLowerCase())) {
      throw new Error('Host de mídia não permitido');
    }
    const isGosac = parsed.hostname.toLowerCase() === this.host;
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: isGosac ? { Authorization: `INTEGRATION ${this.apiKey}` } : {},
      timeout: 30000,
      maxRedirects: 0,
      maxContentLength: 50 * 1024 * 1024,
    });
    const disposition = String(response.headers['content-disposition'] ?? '');
    const match = /filename\*?=(?:UTF-8'')?"?([^";\n]+)"?/i.exec(disposition);
    return {
      data: Buffer.from(response.data),
      contentType: String(
        response.headers['content-type'] ?? 'application/octet-stream',
      ),
      filename: match?.[1],
    };
  }
}
