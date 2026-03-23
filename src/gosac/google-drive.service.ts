import { Injectable, Logger } from '@nestjs/common';
import { google, drive_v3 } from 'googleapis';
import { Readable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class GoogleDriveService {
    private readonly logger = new Logger(GoogleDriveService.name);

    private readonly PT_BR_MONTHS = [
        'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
        'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
    ];

    constructor(private readonly settingsService: SettingsService) { }

    async isEnabled(): Promise<boolean> {
        const value = await this.settingsService.findByKey('GOOGLE_DRIVE_ENABLED');
        return value === 'true';
    }

    private async getDriveClient(): Promise<drive_v3.Drive> {
        const credentialsPath = path.join(
            process.cwd(),
            'src',
            'google_credencials',
            'app-drive-integration-490002-adfd6da727bf.json',
        );

        let credentialsRaw: string;
        try {
            credentialsRaw = fs.readFileSync(credentialsPath, 'utf8');
        } catch {
            throw new Error(`Arquivo de credenciais do Google Drive não encontrado: ${credentialsPath}`);
        }

        let credentials: { client_email?: string; private_key?: string };
        try {
            credentials = JSON.parse(credentialsRaw);
        } catch {
            throw new Error(`Arquivo de credenciais inválido (JSON malformado): ${credentialsPath}`);
        }

        const clientEmail = credentials.client_email;
        const privateKey = credentials.private_key?.replace(/\\n/g, '\n');

        if (!clientEmail || !privateKey) {
            throw new Error('Credenciais do Google Drive inválidas. Campos obrigatórios: client_email e private_key.');
        }

        const auth = new google.auth.JWT({
            email: clientEmail,
            key: privateKey,
            scopes: ['https://www.googleapis.com/auth/drive'],
        });

        return google.drive({ version: 'v3', auth });
    }

    /**
     * Lê o ID da pasta raiz das settings e garante que a subpasta do mês existe.
     * Retorna o ID da subpasta do mês, ou null se a pasta raiz não estiver configurada.
     */
    async ensureMonthFolderFromSettings(): Promise<string | null> {
        const rootFolderId = await this.settingsService.findByKey('GOOGLE_DRIVE_FOLDER_ID');
        if (!rootFolderId) return null;
        return this.ensureMonthFolder(rootFolderId);
    }

    /**
     * Garante que existe uma subpasta com o nome do mês atual (ex: "Março 2025")
     * dentro da pasta pai. Cria se não existir.
     * Retorna o ID da subpasta.
     */
    async ensureMonthFolder(parentFolderId: string): Promise<string> {
        const drive = await this.getDriveClient();
        const now = new Date();
        const monthName = `${this.PT_BR_MONTHS[now.getMonth()]} ${now.getFullYear()}`;

        // Busca pasta existente com esse nome dentro do pai
        const query = `mimeType='application/vnd.google-apps.folder' and name='${monthName}' and '${parentFolderId}' in parents and trashed=false`;
        const list = await drive.files.list({
            q: query,
            fields: 'files(id, name)',
            spaces: 'drive',
            includeItemsFromAllDrives: true,
            supportsAllDrives: true,
        });

        if (list.data.files && list.data.files.length > 0) {
            return list.data.files[0].id!;
        }

        // Cria a pasta
        const created = await drive.files.create({
            requestBody: {
                name: monthName,
                mimeType: 'application/vnd.google-apps.folder',
                parents: [parentFolderId],
            },
            fields: 'id',
            supportsAllDrives: true,
        });

        this.logger.log(`Pasta do mês criada: "${monthName}" (${created.data.id})`);
        return created.data.id!;
    }

    /**
     * Faz upload de um buffer PDF para o Google Drive.
     * @param buffer - Conteúdo do PDF
     * @param filename - Nome do arquivo (ex: "Pagamento Montador - João Silva - Sala.pdf")
     * @param folderId - ID da pasta de destino no Drive
     * @returns ID do arquivo criado no Drive
     */
    async uploadPdf(buffer: Buffer, filename: string, folderId: string): Promise<string> {
        const drive = await this.getDriveClient();

        const stream = Readable.from(buffer);

        const response = await drive.files.create({
            requestBody: {
                name: filename,
                mimeType: 'application/pdf',
                parents: [folderId],
            },
            media: {
                mimeType: 'application/pdf',
                body: stream,
            },
            fields: 'id, name, webViewLink',
            supportsAllDrives: true,
        });

        this.logger.log(`PDF enviado ao Drive: "${filename}" (id: ${response.data.id})`);
        return response.data.id!;
    }

    /**
     * Gera o nome do arquivo PDF no formato: "PrimeiroNome - Ambiente.pdf".
     */
    sanitizePdfFilename(customerName: string, environmentName: string): string {
        const sanitize = (s: string) =>
            s.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim();
        const firstName = sanitize(customerName).split(' ')[0] || 'Cliente';
        const env = sanitize(environmentName) || 'Ambiente';
        return `${firstName} - ${env}.pdf`;
    }
}
