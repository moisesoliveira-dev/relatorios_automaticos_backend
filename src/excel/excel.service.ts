import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

@Injectable()
export class ExcelService {
    async generateExcel(data: any[]): Promise<Buffer> {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Relatório de Ocorrências', {
            properties: { tabColor: { argb: '8B5CF6' } },
        });

        if (!data || data.length === 0) {
            return Buffer.from('');
        }

        // Define as colunas com cabeçalhos traduzidos
        const columns = [
            { key: 'number', header: 'Nº', width: 10 },
            { key: 'title', header: 'Título', width: 40 },
            { key: 'status', header: 'Status', width: 15 },
            { key: 'responsibleName', header: 'Responsável', width: 25 },
            { key: 'deadline', header: 'Prazo', width: 20 },
            { key: 'createdDate', header: 'Data Criação', width: 20 },
            { key: 'occurrenceTypeName', header: 'Tipo', width: 20 },
            { key: 'tagName', header: 'Tag', width: 20 },
            { key: 'contactName', header: 'Contato', width: 30 },
            { key: 'salesOrderCode', header: 'Cód. Pedido', width: 20 },
        ];

        worksheet.columns = columns;

        // Estiliza o cabeçalho
        const headerRow = worksheet.getRow(1);
        headerRow.font = {
            bold: true,
            size: 12,
            color: { argb: 'FFFFFFFF' },
        };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: '8B5CF6' }, // Roxo
        };
        headerRow.alignment = {
            vertical: 'middle',
            horizontal: 'center',
        };
        headerRow.height = 25;

        // Adiciona bordas ao cabeçalho
        headerRow.eachCell((cell) => {
            cell.border = {
                top: { style: 'thin', color: { argb: '6D28D9' } },
                left: { style: 'thin', color: { argb: '6D28D9' } },
                bottom: { style: 'thin', color: { argb: '6D28D9' } },
                right: { style: 'thin', color: { argb: '6D28D9' } },
            };
        });

        // Adiciona os dados
        data.forEach((item, index) => {
            const row = worksheet.addRow({
                number: item.number,
                title: item.title,
                status: this.translateStatus(item.status),
                responsibleName: item.responsibleName || '-',
                deadline: this.formatDate(item.deadline),
                createdDate: this.formatDate(item.createdDate),
                occurrenceTypeName: item.occurrenceTypeName || '-',
                tagName: item.tagName || '-',
                contactName: item.contactName || '-',
                salesOrderCode: item.salesOrderCode || '-',
            });

            // Alterna cores das linhas
            const fillColor = index % 2 === 0 ? 'F9FAFB' : 'FFFFFF';
            row.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: fillColor },
            };

            // Estiliza as células
            row.eachCell((cell, colNumber) => {
                cell.border = {
                    top: { style: 'thin', color: { argb: 'E5E7EB' } },
                    left: { style: 'thin', color: { argb: 'E5E7EB' } },
                    bottom: { style: 'thin', color: { argb: 'E5E7EB' } },
                    right: { style: 'thin', color: { argb: 'E5E7EB' } },
                };
                cell.alignment = {
                    vertical: 'middle',
                    horizontal: colNumber === 2 ? 'left' : 'center', // Título alinhado à esquerda
                };

                // Cor do status
                if (colNumber === 3) {
                    const statusColors = {
                        'Novo': { bg: 'DBEAFE', text: '1E40AF' },
                        'Aberto': { bg: 'FEF3C7', text: '92400E' },
                        'Pendente': { bg: 'FED7AA', text: '9A3412' },
                        'Aguardando': { bg: 'E0E7FF', text: '3730A3' },
                        'Em Progresso': { bg: 'DDD6FE', text: '5B21B6' },
                        'Resolvido': { bg: 'D1FAE5', text: '065F46' },
                    };

                    const color = statusColors[cell.value as string] || { bg: 'F3F4F6', text: '374151' };
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: color.bg },
                    };
                    cell.font = {
                        bold: true,
                        color: { argb: color.text },
                    };
                }
            });
        });

        // Adiciona filtros
        worksheet.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: 1, column: columns.length },
        };

        // Congela a primeira linha (cabeçalho)
        worksheet.views = [
            { state: 'frozen', ySplit: 1 },
        ];

        // Gera o buffer
        const buffer = await workbook.xlsx.writeBuffer();
        return Buffer.from(buffer);
    }

    private translateStatus(status: string): string {
        const translations = {
            'NEW': 'Novo',
            'OPEN': 'Aberto',
            'PENDING': 'Pendente',
            'WAITING': 'Aguardando',
            'IN_PROGRESS': 'Em Progresso',
            'RESOLVED': 'Resolvido',
        };
        return translations[status] || status;
    }

    private formatDate(dateString: string | null): string {
        if (!dateString) return '-';

        try {
            const date = new Date(dateString);
            return date.toLocaleString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
            });
        } catch {
            return dateString;
        }
    }
}
