import { Injectable, Logger } from '@nestjs/common';
import { google, drive_v3 } from 'googleapis';
import { Readable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';
import { SettingsService } from '../settings/settings.service';

interface GoogleServiceAccountCredentials {
    client_email?: string;
    private_key?: string;
}

@Injectable()
export class GoogleDriveService {
    private readonly logger = new Logger(GoogleDriveService.name);

    private readonly PT_BR_MONTHS = [
        'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
        'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
    ];

    constructor(private readonly settingsService: SettingsService) { }

    private maskEmail(email?: string): string {
        if (!email) return '(vazio)';
        const [user, domain] = email.split('@');
        if (!domain) return '***';
        const head = user.slice(0, 3);
        return `${head}***@${domain}`;
    }

    async isEnabled(): Promise<boolean> {
        const value = await this.settingsService.findByKey('GOOGLE_DRIVE_ENABLED');
        return value === 'true';
    }

    private parseCredentials(raw: string, source: string): GoogleServiceAccountCredentials {
        try {
            return JSON.parse(raw);
        } catch {
            throw new Error(`Credenciais do Google Drive inválidas (JSON malformado) em ${source}.`);
        }
    }

    private loadCredentials(): { credentials: GoogleServiceAccountCredentials; source: string } {
        const envBase64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64;
        if (envBase64) {
            this.logger.log(`[DriveCreds] Tentando carregar credenciais via GOOGLE_SERVICE_ACCOUNT_JSON_B64 (len=${envBase64.length}).`);
            try {
                const decoded = Buffer.from(envBase64, 'base64').toString('utf8');
                this.logger.log(`[DriveCreds] Base64 decodificado com sucesso (decodedLen=${decoded.length}).`);
                return {
                    credentials: this.parseCredentials(decoded, 'GOOGLE_SERVICE_ACCOUNT_JSON_B64'),
                    source: 'GOOGLE_SERVICE_ACCOUNT_JSON_B64',
                };
            } catch {
                throw new Error('Falha ao decodificar GOOGLE_SERVICE_ACCOUNT_JSON_B64. Verifique se está em base64 válido.');
            }
        }

        const envJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
        if (envJson) {
            this.logger.log(`[DriveCreds] Tentando carregar credenciais via GOOGLE_SERVICE_ACCOUNT_JSON (len=${envJson.length}).`);
            return {
                credentials: this.parseCredentials(envJson, 'GOOGLE_SERVICE_ACCOUNT_JSON'),
                source: 'GOOGLE_SERVICE_ACCOUNT_JSON',
            };
        }

        const fileCandidates = [
            path.join(process.cwd(), 'src', 'google_credencials', 'app-drive-integration-490002-adfd6da727bf.json'),
            path.join(process.cwd(), 'src', 'google_credencials', 'mythic-lead-461122-n4-a9544f9382f4.json'),
        ];

        for (const filePath of fileCandidates) {
            if (!fs.existsSync(filePath)) continue;
            this.logger.log(`[DriveCreds] Tentando carregar credenciais via arquivo: ${filePath}`);
            const raw = fs.readFileSync(filePath, 'utf8');
            this.logger.log(`[DriveCreds] Arquivo de credenciais lido com sucesso (len=${raw.length}).`);
            return {
                credentials: this.parseCredentials(raw, filePath),
                source: filePath,
            };
        }

        throw new Error(
            'Credenciais do Google Drive não encontradas. Configure GOOGLE_SERVICE_ACCOUNT_JSON_B64 (recomendado), GOOGLE_SERVICE_ACCOUNT_JSON, ou disponibilize um JSON em src/google_credencials/.',
        );
    }

    private async getDriveClient(): Promise<drive_v3.Drive> {
        const { credentials, source } = this.loadCredentials();

        const clientEmail = credentials.client_email;
        const privateKey = credentials.private_key?.replace(/\\n/g, '\n');

        if (!clientEmail || !privateKey) {
            throw new Error('Credenciais do Google Drive inválidas. Campos obrigatórios: client_email e private_key.');
        }

        this.logger.log(`Google Drive autenticando via service account (${source}) | client_email=${this.maskEmail(clientEmail)} | private_key_len=${privateKey.length}`);

        const auth = new google.auth.JWT({
            email: clientEmail,
            key: privateKey,
            scopes: ['https://www.googleapis.com/auth/drive'],
        });

        return google.drive({ version: 'v3', auth });
    }

    /**
     * Lê o ID da pasta raiz das settings (chave GOOGLE_DRIVE_FOLDER_ID) e garante
     * que a subpasta do mês existe.
     * Retorna o ID da subpasta do mês, ou null se a pasta raiz não estiver configurada.
     */
    async ensureMonthFolderFromSettings(): Promise<string | null> {
        return this.ensureMonthFolderFromSettingsKey('GOOGLE_DRIVE_FOLDER_ID');
    }

    /**
     * Versão genérica: lê o ID da pasta raiz de uma chave de settings arbitrária
     * (com fallback na env var de mesmo nome) e garante que a subpasta do mês existe.
     * Retorna o ID da subpasta do mês, ou null se a pasta raiz não estiver configurada.
     */
    async ensureMonthFolderFromSettingsKey(settingsKey: string): Promise<string | null> {
        const folderFromSettings = (await this.settingsService.findByKey(settingsKey))?.trim();
        if (folderFromSettings) {
            this.logger.log(`[DriveCreds] ${settingsKey} carregado via settings: ${folderFromSettings}`);
            return this.ensureMonthFolder(folderFromSettings);
        }

        const folderFromEnv = process.env[settingsKey]?.trim();
        if (folderFromEnv) {
            this.logger.log(`[DriveCreds] ${settingsKey} carregado via env: ${folderFromEnv}`);
            return this.ensureMonthFolder(folderFromEnv);
        }

        this.logger.warn(`[DriveCreds] ${settingsKey} não configurado nem nas settings nem no env.`);
        return null;
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
     * Gera o nome do arquivo PDF no formato: "(PV-CM611) PrimeiroNome - Ambiente.pdf".
     */
    sanitizePdfFilename(customerName: string, environmentName: string, salesOrderCode?: string): string {
        const sanitize = (s: string) =>
            s.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim();
        const firstName = sanitize(customerName).split(' ')[0] || 'Cliente';
        const env = sanitize(environmentName) || 'Ambiente';
        const code = sanitize(salesOrderCode || '');
        return code ? `(${code}) ${firstName} - ${env}.pdf` : `${firstName} - ${env}.pdf`;
    }
}
