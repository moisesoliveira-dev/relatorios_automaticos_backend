import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { SettingsService } from '../settings/settings.service';

export interface EmailOptions {
    to: string;
    subject: string;
    text?: string;
    html?: string;
    attachments?: {
        filename: string;
        content: string | Buffer;
        contentType?: string;
    }[];
}

@Injectable()
export class EmailService {
    constructor(
        private configService: ConfigService,
        private settingsService: SettingsService,
    ) { }

    /** Cria um transporter fresco com as credenciais mais atuais do banco/settings. */
    private async createTransporter(): Promise<nodemailer.Transporter> {
        // Lê do banco (settings editáveis pela UI) com fallback para env vars
        const host = await this.settingsService.findByKey('SMTP_HOST')
            || this.configService.get<string>('SMTP_HOST') || '';
        const portStr = await this.settingsService.findByKey('SMTP_PORT')
            || this.configService.get<string>('SMTP_PORT') || '587';
        const user = await this.settingsService.findByKey('SMTP_USER')
            || this.configService.get<string>('SMTP_USER') || '';
        const pass = await this.settingsService.findByKey('SMTP_PASSWORD')
            || this.configService.get<string>('SMTP_PASS') || '';

        const port = parseInt(portStr, 10);
        const secure = port === 465;

        console.log(`📧 SMTP config: host=${host}, port=${port}, secure=${secure}, user=${user}`);

        return nodemailer.createTransport({
            host,
            port,
            secure,
            auth: { user, pass },
            connectionTimeout: 30000,
            greetingTimeout: 30000,
            socketTimeout: 240000,
        });
    }

    async sendEmail(options: EmailOptions): Promise<boolean> {
        try {
            console.log('📧 Tentando enviar email para:', options.to);
            console.log('📧 Tipo do destinatário:', typeof options.to);
            console.log('📧 É array?:', Array.isArray(options.to));
            console.log('📧 Assunto:', options.subject);
            console.log('📧 Anexos:', options.attachments?.length || 0);

            // Converte array para string se necessário
            const emailTo = Array.isArray(options.to) ? options.to.join(',') : options.to;

            if (!emailTo || (typeof emailTo === 'string' && emailTo.trim() === '')) {
                throw new Error('Email de destino não definido');
            }

            const from = await this.settingsService.findByKey('SMTP_FROM')
                || this.configService.get<string>('SMTP_FROM') || '';

            const mailOptions = {
                from,
                to: emailTo,
                subject: options.subject,
                text: options.text,
                html: options.html,
                attachments: options.attachments,
            };

            console.log('📧 Configurações do email:', {
                from: mailOptions.from,
                to: mailOptions.to,
                subject: mailOptions.subject,
            });

            const transporter = await this.createTransporter();
            await transporter.sendMail(mailOptions);
            console.log('✅ Email enviado com sucesso para:', emailTo);
            return true;
        } catch (error) {
            console.error('❌ Erro ao enviar email:', error);
            throw new HttpException(
                `Falha ao enviar email: ${error.message}`,
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    async sendReportEmail(
        to: string,
        content: string | Buffer,
        isExcel: boolean = false,
        reportName: string = 'relatorio_ocorrencias',
    ): Promise<boolean> {
        const now = new Date();
        const dateStr = now.toLocaleDateString('pt-BR');
        const timeStr = now.toLocaleTimeString('pt-BR');

        const extension = isExcel ? 'xlsx' : 'csv';
        const contentType = isExcel
            ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            : 'text/csv; charset=utf-8';

        return this.sendEmail({
            to,
            subject: `Relatório de Ocorrências Pontta - ${dateStr}`,
            html: `
        <h2>📊 Relatório de Ocorrências</h2>
        <p>Olá,</p>
        <p>Segue em anexo o relatório de ocorrências gerado em <strong>${dateStr}</strong> às <strong>${timeStr}</strong>.</p>
        <p>O arquivo está em formato <strong>${isExcel ? 'Excel (.xlsx)' : 'CSV'}</strong> e pode ser aberto no Microsoft Excel, Google Sheets ou LibreOffice.</p>
        <br>
        <p>Atenciosamente,</p>
        <p><strong>Sistema de Relatórios Automáticos</strong></p>
      `,
            attachments: [
                {
                    filename: `${reportName}_${now.toISOString().split('T')[0]}.${extension}`,
                    content: Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8'),
                    contentType,
                },
            ],
        });
    }
}
