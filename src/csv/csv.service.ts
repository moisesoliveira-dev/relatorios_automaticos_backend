import { Injectable } from '@nestjs/common';

@Injectable()
export class CsvService {
    generateCsv(data: any[]): string {
        if (!data || data.length === 0) {
            return '';
        }

        // Obtém todas as chaves únicas de todos os objetos
        const allKeys = new Set<string>();
        data.forEach((item) => {
            Object.keys(item).forEach((key) => allKeys.add(key));
        });

        const headers = Array.from(allKeys);

        // Cria o cabeçalho
        const headerRow = headers.map((header) => this.escapeField(header)).join(';');

        // Cria as linhas de dados
        const dataRows = data.map((item) => {
            return headers
                .map((header) => {
                    const value = item[header];
                    return this.escapeField(this.formatValue(value));
                })
                .join(';');
        });

        return [headerRow, ...dataRows].join('\n');
    }

    private escapeField(field: string): string {
        if (field === null || field === undefined) {
            return '';
        }

        const stringValue = String(field);

        // Se contém vírgula, aspas ou quebra de linha, envolve em aspas
        if (
            stringValue.includes(';') ||
            stringValue.includes('"') ||
            stringValue.includes('\n') ||
            stringValue.includes('\r')
        ) {
            return `"${stringValue.replace(/"/g, '""')}"`;
        }

        return stringValue;
    }

    private formatValue(value: any): string {
        if (value === null || value === undefined) {
            return '';
        }

        if (typeof value === 'object') {
            if (value instanceof Date) {
                return value.toISOString();
            }
            return JSON.stringify(value);
        }

        return String(value);
    }
}
