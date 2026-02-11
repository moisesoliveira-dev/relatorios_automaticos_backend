import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

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
    private transporter: nodemailer.Transporter;

    constructor(private configService: ConfigService) {
        this.transporter = nodemailer.createTransport({
            host: this.configService.get<string>('SMTP_HOST'),
            port: this.configService.get<number>('SMTP_PORT'),
            secure: false, // true para 465, false para outras portas
            auth: {
                user: this.configService.get<string>('SMTP_USER'),
                pass: this.configService.get<string>('SMTP_PASS'),
            },
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

            const mailOptions = {
                from: this.configService.get<string>('SMTP_FROM'),
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

            await this.transporter.sendMail(mailOptions);
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
