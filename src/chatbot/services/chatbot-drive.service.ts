import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
import { GoogleDriveService } from '../../gosac/google-drive.service';
import { CATEGORIAS_AMBIENTE } from '../domain/chatbot.messages';

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/** Nome seguro para pasta/arquivo: sem caracteres de caminho e sem ficar vazio. */
export function safeName(value: string, fallback = 'cliente'): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

/**
 * Pasta do cliente: <raiz> / <ano> / <mês> / ANDAMENTO / "<ticketId> - <nome>".
 * Se o cliente já tem pasta (mesmo ticket), ela é reaproveitada mesmo que o nome tenha mudado.
 */
@Injectable()
export class ChatbotDriveService {
  private readonly logger = new Logger(ChatbotDriveService.name);

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly drive: GoogleDriveService,
  ) {}

  get enabled(): boolean {
    return !!this.appConfig.chatbot.driveRootFolderId;
  }

  async ensureClientFolder(
    ticketId: number,
    nome: string,
    now = new Date(),
    criar = true,
  ): Promise<string | null> {
    const root = this.appConfig.chatbot.driveRootFolderId;
    if (!root) {
      this.logger.warn(
        'CHATBOT_DRIVE_ROOT_FOLDER_ID ausente — pasta do cliente não será criada',
      );
      return null;
    }
    // Mês/ano em Manaus (UTC-4)
    const local = new Date(now.getTime() - 4 * 3600_000);
    const caminho = [
      String(local.getUTCFullYear()),
      MESES[local.getUTCMonth()],
      'ANDAMENTO',
    ];
    if (!criar) {
      // Só procura: não cria nenhuma pasta no caminho.
      let pai: string | null = root;
      for (const nome of caminho) {
        pai = pai ? await this.drive.findFolder(pai, nome) : null;
      }
      return pai
        ? this.drive.findFolder(pai, `${ticketId} - `, 'startsWith')
        : null;
    }
    const andamento = await this.drive.ensureFolderPath(root, caminho);

    const existing = await this.drive.findFolder(
      andamento,
      `${ticketId} - `,
      'startsWith',
    );
    if (existing) return existing;
    return this.drive.ensureFolderPath(andamento, [
      `${ticketId} - ${safeName(nome)}`,
    ]);
  }

  async saveFile(
    folderId: string,
    nome: string,
    original: string | undefined,
    contentType: string,
    data: Buffer,
  ): Promise<void> {
    const ext =
      contentType
        .split('/')[1]
        ?.split(';')[0]
        ?.replace(/[^a-z0-9]/gi, '') || 'bin';
    const base = safeName(original || `arquivo_${Date.now()}`);
    const filename = `${safeName(nome)} - ${base}`.slice(0, 150);
    const finalName = /\.[a-z0-9]{2,5}$/i.test(filename)
      ? filename
      : `${filename}.${ext}`;
    await this.drive.uploadBuffer(data, finalName, contentType, folderId);
  }

  async savePreferences(
    folderId: string,
    nome: string,
    categorias: number[],
  ): Promise<void> {
    const nomes = categorias
      .map((id) => CATEGORIAS_AMBIENTE[id])
      .filter(Boolean);
    const lista =
      nomes.length > 1
        ? `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`
        : (nomes[0] ?? 'nenhum');
    const text = `Cliente: ${safeName(nome)}\nAmbientes de interesse: ${lista}.\nAtualizado em: ${new Date().toISOString()}\n`;
    await this.drive.upsertTextFile(folderId, 'Preferências.txt', text);
  }

  /** Grava as respostas coletadas por um fluxo personalizado na pasta do cliente. */
  async saveAnswers(
    folderId: string,
    nome: string,
    titulo: string,
    itens: Array<{ rotulo: string; valor: string }>,
  ): Promise<void> {
    const linhas = itens.map(
      (i) => `${safeName(i.rotulo)}: ${i.valor.replace(/\s+/g, ' ')}`,
    );
    const text = `Cliente: ${safeName(nome)}\nFluxo: ${safeName(titulo)}\n${linhas.join('\n')}\nAtualizado em: ${new Date().toISOString()}\n`;
    await this.drive.upsertTextFile(
      folderId,
      `${safeName(titulo)} - Respostas.txt`,
      text,
    );
  }
}
