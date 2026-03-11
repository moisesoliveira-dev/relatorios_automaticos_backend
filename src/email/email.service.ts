import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import axios from 'axios';
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

    /** Retorna o provedor configurado: 'smtp' ou 'resend'. */
    private async getProvider(): Promise<string> {
        return await this.settingsService.findByKey('EMAIL_PROVIDER')
            || this.configService.get<string>('EMAIL_PROVIDER')
            || 'smtp';
    }

    /** Cria um transporter SMTP fresco com as credenciais mais atuais. */
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

    /** Envia via Resend HTTP API (funciona em plataformas que bloqueiam SMTP, como Railway). */
    private async sendViaResend(
        from: string, to: string, subject: string,
        html?: string, text?: string, attachments?: EmailOptions['attachments'],
    ): Promise<void> {
        const apiKey = await this.settingsService.findByKey('RESEND_API_KEY')
            || this.configService.get<string>('RESEND_API_KEY') || '';

        if (!apiKey) {
            throw new Error('RESEND_API_KEY não configurada. Vá em Configurações > Email e preencha a chave da API Resend.');
        }

        const payload: any = { from, to: [to], subject };
        if (html) payload.html = html;
        if (text) payload.text = text;

        if (attachments?.length) {
            payload.attachments = attachments.map(a => ({
                filename: a.filename,
                content: Buffer.isBuffer(a.content)
                    ? a.content.toString('base64')
                    : Buffer.from(a.content, 'utf-8').toString('base64'),
                content_type: a.contentType,
            }));
        }

        console.log(`📧 Resend: enviando para ${to}, assunto="${subject}", anexos=${attachments?.length || 0}`);

        const response = await axios.post('https://api.resend.com/emails', payload, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
        });

        console.log(`✅ Resend: email enviado, id=${response.data?.id}`);
    }

    async sendEmail(options: EmailOptions): Promise<boolean> {
        try {
            const emailTo = Array.isArray(options.to) ? options.to.join(',') : options.to;

            if (!emailTo || (typeof emailTo === 'string' && emailTo.trim() === '')) {
                throw new Error('Email de destino não definido');
            }

            const from = await this.settingsService.findByKey('SMTP_FROM')
                || this.configService.get<string>('SMTP_FROM') || '';

            const provider = await this.getProvider();
            console.log(`📧 Provider: ${provider} | Para: ${emailTo} | Assunto: ${options.subject} | Anexos: ${options.attachments?.length || 0}`);

            if (provider === 'resend') {
                await this.sendViaResend(from, emailTo, options.subject, options.html, options.text, options.attachments);
            } else {
                const transporter = await this.createTransporter();
                await transporter.sendMail({
                    from,
                    to: emailTo,
                    subject: options.subject,
                    text: options.text,
                    html: options.html,
                    attachments: options.attachments,
                });
            }

            console.log('✅ Email enviado com sucesso para:', emailTo);
            return true;
        } catch (error) {
            const detail = error?.response?.data || error?.message || error;
            console.error('❌ Erro ao enviar email:', detail);
            throw new HttpException(
                `Falha ao enviar email: ${typeof detail === 'object' ? JSON.stringify(detail) : detail}`,
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
