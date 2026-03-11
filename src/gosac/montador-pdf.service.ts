import { Injectable, Logger } from '@nestjs/common';
import * as puppeteer from 'puppeteer';

export interface MontadorPdfData {
    proposalCode: string;
    customerName: string;
    environmentName: string;
    environmentValue: number;
    discount: number;
    discountedValue: number;
    montadorRate: number;
    montadorPayment: number;
    deliveryDate: string;
    assemblyStartDate: string;
    assemblyEndDate: string;
}

@Injectable()
export class MontadorPdfService {
    private readonly logger = new Logger(MontadorPdfService.name);

    async generatePdf(data: MontadorPdfData): Promise<Buffer> {
        const html = this.buildHtml(data);
        let browser: puppeteer.Browser | null = null;

        try {
            browser = await puppeteer.launch({
                headless: true,
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
            });

            const page = await browser.newPage();
            await page.setContent(html, { waitUntil: 'networkidle0' });

            const pdfUint8 = await page.pdf({
                format: 'A4',
                printBackground: true,
                margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
            });

            return Buffer.from(pdfUint8);
        } catch (error) {
            this.logger.error('Erro ao gerar PDF do montador', error);
            throw error;
        } finally {
            if (browser) await browser.close();
        }
    }

    private formatCurrency(value: number): string {
        return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    private buildHtml(data: MontadorPdfData): string {
        const rate = (data.montadorRate * 100).toFixed(0);

        return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #333; padding: 40px; }
    .header { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid #1e3a5f; padding-bottom: 16px; margin-bottom: 32px; }
    .header .logo { max-height: 60px; }
    .header .title { font-size: 22px; font-weight: 700; color: #1e3a5f; text-align: right; }
    .section { margin-bottom: 24px; }
    .section-title { font-size: 14px; font-weight: 700; color: #1e3a5f; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #ddd; padding-bottom: 6px; margin-bottom: 12px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; }
    .info-item { font-size: 13px; }
    .info-item .label { font-weight: 600; color: #555; }
    .info-item .value { color: #111; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { padding: 10px 12px; text-align: left; font-size: 13px; }
    th { background: #1e3a5f; color: #fff; font-weight: 600; }
    td { border-bottom: 1px solid #eee; }
    tr:nth-child(even) td { background: #f9f9f9; }
    .highlight { font-size: 18px; font-weight: 700; color: #1e3a5f; }
    .dates-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-top: 8px; }
    .date-box { border: 1px solid #ccc; border-radius: 6px; padding: 12px; text-align: center; }
    .date-box .date-label { font-size: 11px; color: #666; text-transform: uppercase; margin-bottom: 4px; }
    .date-box .date-value { font-size: 14px; font-weight: 600; min-height: 20px; }
    .footer { margin-top: 48px; text-align: center; font-size: 11px; color: #999; border-top: 1px solid #eee; padding-top: 12px; }
    .signature-area { margin-top: 60px; display: flex; justify-content: space-between; }
    .signature-line { width: 200px; text-align: center; }
    .signature-line .line { border-top: 1px solid #333; margin-bottom: 4px; }
    .signature-line .sig-label { font-size: 11px; color: #666; }
</style>
</head>
<body>
    <div class="header">
        <div class="title">
            Pagamento de<br>Montador
        </div>
    </div>

    <div class="section">
        <div class="section-title">Dados do Cliente</div>
        <div class="info-grid">
            <div class="info-item"><span class="label">Cliente:</span> <span class="value">${this.escapeHtml(data.customerName)}</span></div>
            <div class="info-item"><span class="label">Orçamento:</span> <span class="value">${this.escapeHtml(data.proposalCode)}</span></div>
        </div>
    </div>

    <div class="section">
        <div class="section-title">Ambiente</div>
        <table>
            <thead>
                <tr>
                    <th>Ambiente</th>
                    <th>Valor Original</th>
                    <th>Desconto</th>
                    <th>Valor c/ Desconto</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>${this.escapeHtml(data.environmentName)}</td>
                    <td>${this.formatCurrency(data.environmentValue)}</td>
                    <td>${data.discount.toFixed(1)}%</td>
                    <td>${this.formatCurrency(data.discountedValue)}</td>
                </tr>
            </tbody>
        </table>
    </div>

    <div class="section">
        <div class="section-title">Cálculo de Pagamento</div>
        <table>
            <thead>
                <tr>
                    <th>Base de Cálculo</th>
                    <th>Percentual</th>
                    <th>Valor do Montador</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>${this.formatCurrency(data.discountedValue)}</td>
                    <td>${rate}%</td>
                    <td class="highlight">${this.formatCurrency(data.montadorPayment)}</td>
                </tr>
            </tbody>
        </table>
    </div>

    <div class="section">
        <div class="section-title">Datas</div>
        <div class="dates-grid">
            <div class="date-box">
                <div class="date-label">Entrega de Material</div>
                <div class="date-value">${data.deliveryDate || '____/____/________'}</div>
            </div>
            <div class="date-box">
                <div class="date-label">Início de Montagem</div>
                <div class="date-value">${data.assemblyStartDate || '____/____/________'}</div>
            </div>
            <div class="date-box">
                <div class="date-label">Finalização de Montagem</div>
                <div class="date-value">${data.assemblyEndDate || '____/____/________'}</div>
            </div>
        </div>
    </div>

    <div class="signature-area">
        <div class="signature-line">
            <div class="line"></div>
            <div class="sig-label">Responsável</div>
        </div>
        <div class="signature-line">
            <div class="line"></div>
            <div class="sig-label">Montador</div>
        </div>
    </div>

    <div class="footer">
        Documento gerado automaticamente em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}
    </div>
</body>
</html>`;
    }

    private escapeHtml(text: string): string {
        const map: Record<string, string> = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;',
        };
        return text.replace(/[&<>"']/g, (char) => map[char]);
    }
}
