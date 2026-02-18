import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface OccurrenceSummary {
    id: number;
    title: string;
    status: string;
    createdDate: string;
    [key: string]: any;
}

export interface OccurrenceFiltered {
    number: number;
    title: string;
    status: string;
    responsibleName: string | null;
    deadline: string | null;
    createdDate: string;
    occurrenceTypeName: string | null;
    tagName: string | null;
    contactName: string | null;
    salesOrderCode: string | null;
}

export interface PonttaAuthResponse {
    id_token: string;
}

@Injectable()
export class PonttaService {
    private readonly authUrl: string;
    private readonly apiUrl: string;
    private readonly apiKey: string;

    constructor(private configService: ConfigService) {
        this.authUrl = this.configService.get<string>('PONTTA_AUTH_URL') || 'https://api.pontta.com/api/authenticate';
        this.apiUrl = this.configService.get<string>('PONTTA_API_URL') || 'https://app.pontta.com/api';
        this.apiKey = this.configService.get<string>('PONTTA_API_KEY') || '';
    }

    async authenticate(email: string, password: string): Promise<string> {
        try {
            const response = await axios.post<PonttaAuthResponse>(
                this.authUrl,
                {
                    email,
                    password,
                    rememberMe: true,
                },
                {
                    headers: {
                        Authorization: `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json',
                    },
                },
            );

            return response.data.id_token;
        } catch (error) {
            console.error('Erro na autenticação:', error.response?.data || error.message);
            throw new HttpException(
                'Falha na autenticação com a API Pontta',
                HttpStatus.UNAUTHORIZED,
            );
        }
    }

    async getOccurrences(
        token: string,
        page: number = 0,
        size: number = 25,
        status: string = 'NEW,OPEN,PENDING,WAITING,IN_PROGRESS,RESOLVED',
    ): Promise<OccurrenceSummary[]> {
        try {
            const url = `${this.apiUrl}/occurrences/summary`;
            const response = await axios.get(url, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                params: {
                    status,
                    date: 'global.createdAt',
                    page,
                    size,
                    sort: 'createdDate,desc',
                },
            });

            return response.data;
        } catch (error) {
            console.error('Erro ao buscar ocorrências:', error.response?.data || error.message);
            throw new HttpException(
                'Falha ao buscar ocorrências da API Pontta',
                HttpStatus.BAD_REQUEST,
            );
        }
    }

    async getAllOccurrences(
        token: string,
        status: string = 'NEW,OPEN,PENDING,WAITING,IN_PROGRESS,RESOLVED',
    ): Promise<OccurrenceSummary[]> {
        const size = 100;

        // 1ª página para descobrir quantos registros existem no total
        const firstPage = await this.getOccurrences(token, 0, size, status);

        if (!Array.isArray(firstPage) || firstPage.length === 0) {
            return [];
        }

        // Se retornou menos que o tamanho da página, não há mais páginas
        if (firstPage.length < size) {
            return firstPage;
        }

        // Busca as demais páginas em paralelo (máximo 10 simultâneas para não sobrecarregar a API)
        const CONCURRENCY = 10;
        const allOccurrences: OccurrenceSummary[] = [...firstPage];
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            const pages = Array.from({ length: CONCURRENCY }, (_, i) => page + i);
            const results = await Promise.all(
                pages.map(p => this.getOccurrences(token, p, size, status).catch(() => [] as OccurrenceSummary[]))
            );

            let gotAny = false;
            for (const result of results) {
                if (Array.isArray(result) && result.length > 0) {
                    allOccurrences.push(...result);
                    gotAny = true;
                    if (result.length < size) {
                        hasMore = false;
                        break;
                    }
                } else {
                    hasMore = false;
                    break;
                }
            }

            if (!gotAny) {
                hasMore = false;
            }

            page += CONCURRENCY;
        }

        return allOccurrences;
    }

    /**
     * Filtra os campos das ocorrências para incluir apenas os necessários
     */
    filterOccurrenceFields(occurrences: OccurrenceSummary[]): OccurrenceFiltered[] {
        return occurrences.map((item) => ({
            number: item.number,
            title: item.title,
            status: item.status,
            responsibleName: item.responsible?.name || null,
            deadline: item.deadline || null,
            createdDate: item.createdDate,
            occurrenceTypeName: item.occurrenceType?.name || null,
            tagName: item.tags?.[0]?.name || null,
            contactName: item.contactName || null,
            salesOrderCode: item.salesOrderCode || null,
        }));
    }
}
