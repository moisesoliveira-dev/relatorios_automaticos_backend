import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import FormData from 'form-data';

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
    private readonly businessUnitId: string;

    // Token cache: evita re-autenticação a cada chamada (token válido por ~10 min)
    private tokenCache: Map<string, { token: string; expiresAt: number }> = new Map();
    private readonly TOKEN_TTL_MS = 9 * 60 * 1000; // 9 minutos (margem antes do JWT expirar)

    constructor(private configService: ConfigService) {
        this.authUrl = this.configService.get<string>('PONTTA_AUTH_URL') || 'https://api.pontta.com/api/authenticate';
        this.apiUrl = this.configService.get<string>('PONTTA_API_URL') || 'https://app.pontta.com/api';
        this.apiKey = this.configService.get<string>('PONTTA_API_KEY') || 'your_pontta_api_key';
        this.businessUnitId = this.configService.get<string>('PONTTA_BUSINESS_UNIT_ID') || 'd6e8a1cd-ab55-4dd2-96cd-dbab38f75f2e';
        console.log(`[PonttaService] businessUnitId: "${this.businessUnitId}"`);
    }

    async authenticate(email: string, password: string): Promise<string> {
        // Retorna token do cache se ainda válido
        const cacheKey = `${email}`;
        const cached = this.tokenCache.get(cacheKey);
        if (cached && Date.now() < cached.expiresAt) {
            return cached.token;
        }

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

            const token = response.data.id_token;
            // Salva token no cache
            this.tokenCache.set(cacheKey, { token, expiresAt: Date.now() + this.TOKEN_TTL_MS });
            return token;
        } catch (error) {
            console.error('Erro na autenticação:', error.response?.data || error.message);
            throw new HttpException(
                'Falha na autenticação com a API Pontta',
                HttpStatus.UNAUTHORIZED,
            );
        }
    }

    /** Invalida o token em cache para forçar re-autenticação na próxima chamada */
    clearTokenCache(email: string): void {
        this.tokenCache.delete(email);
    }

    /** Retorna o perfil do usuário autenticado no Pontta (id, name, etc.) */
    async getCurrentUser(token: string): Promise<any> {
        try {
            const response = await axios.get(`${this.apiUrl}/account`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    Businessunit: this.businessUnitId,
                },
            });
            console.log(`👤 /api/account FULL response:`, JSON.stringify(response.data).substring(0, 1000));
            return response.data;
        } catch (error) {
            console.warn('⚠️ Não foi possível obter perfil Pontta:', error.response?.data || error.message);
            return null;
        }
    }

    /**
     * Busca o colaborador (Collaborator) do usuário autenticado dentro da unidade de negócio.
     * O Pontta diferencia "user" (conta) de "collaborator" (perfil na business unit).
     * O responsibleId na criação de ocorrência precisa ser o ID do collaborator, não do user.
     */
    async getCollaboratorId(token: string): Promise<string | null> {
        try {
            // Tenta buscar o colaborador logado diretamente
            const response = await axios.get(`${this.apiUrl}/collaborators/logged`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    Businessunit: this.businessUnitId,
                },
            });
            console.log(`👤 /api/collaborators/logged FULL response:`, JSON.stringify(response.data).substring(0, 1000));
            const collaboratorId = response.data?.id || null;
            if (collaboratorId) {
                console.log(`✅ Collaborator ID encontrado: ${collaboratorId}`);
                return String(collaboratorId);
            }
        } catch (error) {
            console.warn(`⚠️ /api/collaborators/logged falhou (${error.response?.status}):`, error.response?.data || error.message);
        }

        // Fallback: tenta buscar da lista de colaboradores filtrando pelo email do account
        try {
            const account = await this.getCurrentUser(token);
            const email = account?.email || account?.login;
            if (!email) {
                console.warn('⚠️ Não foi possível encontrar email do account para buscar collaborator');
                return null;
            }
            console.log(`🔍 Buscando collaborator pela lista, email: ${email}`);
            const response = await axios.get(`${this.apiUrl}/collaborators`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    Businessunit: this.businessUnitId,
                },
                params: { page: 0, size: 200 },
            });
            const data = response.data;
            const list = Array.isArray(data) ? data : (data?.content || []);
            console.log(`📋 Total de collaborators retornados: ${list.length}`);
            if (list.length > 0) {
                console.log(`📋 Primeiro collaborator como amostra:`, JSON.stringify(list[0]).substring(0, 500));
            }

            // Procura o colaborador cujo email "corresponde" ao do usuário autenticado
            const match = list.find((c: any) =>
                c.email === email ||
                c.user?.email === email ||
                c.user?.login === email ||
                c.login === email,
            );
            if (match) {
                console.log(`✅ Collaborator encontrado por email match: ${match.id}`);
                return String(match.id);
            }
            console.warn(`⚠️ Nenhum collaborator encontrado com email ${email}`);
        } catch (error) {
            console.warn(`⚠️ Falha ao buscar collaborators:`, error.response?.data || error.message);
        }

        return null;
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

    /**
     * Pesquisa pedidos de venda no Pontta
     */
    async searchSalesOrders(
        token: string,
        query?: string,
        page: number = 0,
        size: number = 25,
    ): Promise<any[]> {
        try {
            const url = `${this.apiUrl}/sales-orders/summary`;
            console.log(`🔍 Buscando pedidos de venda Pontta: "${query || '(inicial)'}"`);
            // Monta a URL manualmente para garantir que sort=saleDate,number,desc
            // seja enviado exatamente como o app Pontta envia (sem encoding das vírgulas)
            const params = new URLSearchParams({
                status: 'VALID',
                page: String(page),
                size: String(size),
            });
            if (query && query.trim().length > 0) {
                params.set('q', query.trim());
            }

            const requestUrl = `${url}?${params.toString()}&sort=saleDate,number,desc`;

            const parseItems = (data: any): any[] => {
                // API pode retornar array, { content: [] } ou payload aninhado
                if (Array.isArray(data)) return data;
                if (Array.isArray(data?.content)) return data.content;
                if (Array.isArray(data?.data?.content)) return data.data.content;
                if (Array.isArray(data?.data)) return data.data;
                return [];
            };

            // 1) Tenta com Businessunit (comportamento atual)
            const responseWithBu = await axios.get(requestUrl, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    Businessunit: this.businessUnitId,
                },
            });

            console.log('[PonttaRaw] sales-orders/summary com Businessunit -> response.data:', JSON.stringify(responseWithBu.data));

            const itemsWithBu = parseItems(responseWithBu.data);
            console.log(`✅ Resposta pedidos de venda c/ Businessunit: ${itemsWithBu.length} item(ns)`);
            if (itemsWithBu.length > 0 || !!query) {
                return itemsWithBu;
            }

            // 2) Fallback sem Businessunit para alinhar com rota manual testada pelo usuário
            const responseWithoutBu = await axios.get(requestUrl, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            });

            console.log('[PonttaRaw] sales-orders/summary sem Businessunit -> response.data:', JSON.stringify(responseWithoutBu.data));

            const itemsWithoutBu = parseItems(responseWithoutBu.data);
            console.log(`✅ Resposta pedidos de venda sem Businessunit: ${itemsWithoutBu.length} item(ns)`);
            return itemsWithoutBu;
        } catch (error) {
            const ponttaError = error.response?.data;
            const ponttaStatus = error.response?.status;
            console.error(`❌ Erro ao buscar pedidos de venda (HTTP ${ponttaStatus}):`, ponttaError || error.message);

            if (ponttaStatus === 401) {
                throw new HttpException(
                    'Token Pontta expirado ou inválido. Tente novamente.',
                    HttpStatus.UNAUTHORIZED,
                );
            }

            const detail = ponttaError?.message || ponttaError?.error || error.message || 'Erro desconhecido';
            throw new HttpException(
                `Falha ao buscar pedidos de venda: ${detail}`,
                ponttaStatus || HttpStatus.BAD_GATEWAY,
            );
        }
    }

    /**
     * Cria uma ocorrência no Pontta associada a um pedido de venda
     */
    async createOccurrence(
        token: string,
        data: {
            title: string;
            note: string;
            salesOrderCode: string;
            salesOrderId: string;
        },
    ): Promise<any> {
        try {
            const url = `${this.apiUrl}/occurrences`;
            const body = {
                id: null,
                type: 'OCCURRENCE',
                occurrenceDate: null,
                debitResponsible: false,
                cost: null,
                title: data.title,
                note: data.note,
                salesOrderCode: data.salesOrderCode,
                salesOrderId: data.salesOrderId,
                deadline: null,
                occurrenceTypeId: null,
                occurrenceTeamId: null,
                responsibleId: null,
                causedById: null,
                reference: null,
                contactExist: true,
                tagIds: [],
            };
            console.log(`📝 [createOccurrence] POST ${url}`);
            console.log(`📝 [createOccurrence] Body:`, JSON.stringify(body));
            console.log(`📝 [createOccurrence] Headers: Businessunit=${this.businessUnitId}`);
            const response = await axios.post(url, body, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    Businessunit: this.businessUnitId,
                },
            });

            console.log(`✅ [createOccurrence] HTTP ${response.status}`);
            console.log(`✅ [createOccurrence] response.data tipo: ${typeof response.data}`);
            console.log(`✅ [createOccurrence] response.data raw:`, JSON.stringify(response.data));
            console.log(`✅ [createOccurrence] headers x-pontta-params:`, response.headers?.['x-pontta-params']);

            // O Pontta retorna body vazio (ou string) mas o UUID da ocorrência vem no header x-pontta-params
            const headerUuid = response.headers?.['x-pontta-params'] || null;
            if (headerUuid) {
                console.log(`✅ [createOccurrence] UUID extraído do header: ${headerUuid}`);
                return headerUuid; // retorna o UUID como string
            }
            return response.data;
        } catch (error) {
            console.error(`❌ [createOccurrence] HTTP ${error.response?.status}:`, JSON.stringify(error.response?.data || error.message));
            throw new HttpException(
                `Falha ao criar ocorrência no Pontta: ${error.response?.data?.message || error.message}`,
                HttpStatus.BAD_REQUEST,
            );
        }
    }

    /**
     * Faz upload de um arquivo para uma ocorrência no Pontta
     */
    async uploadFileToOccurrence(
        token: string,
        occurrenceId: string,
        fileBuffer: Buffer,
        filename: string,
        mimeType: string,
    ): Promise<any> {
        try {
            const url = `${this.apiUrl}/file-storage/OCCURRENCE/${occurrenceId}`;
            console.log(`📎 Enviando arquivo "${filename}" para ocorrência ${occurrenceId}`);

            const form = new FormData();
            form.append('file', fileBuffer, {
                filename,
                contentType: mimeType,
            });

            const response = await axios.post(url, form, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    Businessunit: this.businessUnitId,
                    ...form.getHeaders(),
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
            });

            console.log(`✅ Arquivo "${filename}" enviado com sucesso`);
            return response.data;
        } catch (error) {
            console.error(`❌ Erro ao enviar arquivo "${filename}":`, error.response?.data || error.message);
            throw new HttpException(
                `Falha ao enviar arquivo para ocorrência Pontta: ${error.response?.data?.message || error.message}`,
                HttpStatus.BAD_REQUEST,
            );
        }
    }

    /**
     * Busca orçamentos (proposals) ativos no Pontta
     */
    async getProposals(
        token: string,
        page: number = 0,
        size: number = 10,
        query?: string,
    ): Promise<any[]> {
        try {
            const url = `${this.apiUrl}/proposals/summary`;
            const params: Record<string, string> = {
                status: 'ACTIVED',
                page: String(page),
                size: String(size),
                sort: 'createdAt,desc',
            };
            if (query && query.trim().length > 0) {
                params.q = query.trim();
            }

            const response = await axios.get(url, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    Businessunit: this.businessUnitId,
                },
                params,
            });

            const data = response.data;
            if (Array.isArray(data)) return data;
            if (data?.content && Array.isArray(data.content)) return data.content;
            return [];
        } catch (error) {
            const ponttaStatus = error.response?.status;
            const ponttaError = error.response?.data;

            if (ponttaStatus === 401) {
                throw new HttpException(
                    'Token Pontta expirado ou inválido. Tente novamente.',
                    HttpStatus.UNAUTHORIZED,
                );
            }

            const detail = ponttaError?.message || ponttaError?.error || error.message || 'Erro desconhecido';
            throw new HttpException(
                `Falha ao buscar orçamentos: ${detail}`,
                ponttaStatus || HttpStatus.BAD_GATEWAY,
            );
        }
    }

    /**
     * Busca os itens (ambientes) de um orçamento no Pontta
     */
    async getProposalItems(token: string, proposalId: string): Promise<any[]> {
        try {
            const url = `${this.apiUrl}/proposals/${proposalId}/versions/items`;
            const response = await axios.get(url, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    Businessunit: this.businessUnitId,
                },
            });

            const data = response.data;
            if (Array.isArray(data) && data.length > 0) {
                console.log('[PonttaItems] sample keys:', JSON.stringify(Object.keys(data[0])));
                console.log('[PonttaItems] sample item:', JSON.stringify(data[0]));
            }
            if (Array.isArray(data)) return data;
            return [];
        } catch (error) {
            const ponttaStatus = error.response?.status;
            const ponttaError = error.response?.data;

            if (ponttaStatus === 401) {
                throw new HttpException(
                    'Token Pontta expirado ou inválido.',
                    HttpStatus.UNAUTHORIZED,
                );
            }

            const detail = ponttaError?.message || ponttaError?.error || error.message || 'Erro desconhecido';
            throw new HttpException(
                `Falha ao buscar itens do orçamento: ${detail}`,
                ponttaStatus || HttpStatus.BAD_GATEWAY,
            );
        }
    }

    /**
     * Busca os itens (ambientes) de um pedido de venda no Pontta.
     * Alguns ambientes usam rotas diferentes no backend do Pontta, por isso há fallback.
     */
    async getSalesOrderItems(token: string, salesOrderId: string): Promise<any[]> {
        const candidates = [
            `${this.apiUrl}/sales-orders/${salesOrderId}/items`,
            `${this.apiUrl}/sales-orders/${salesOrderId}/versions/items`,
            `${this.apiUrl}/sales-orders/items/${salesOrderId}`,
        ];

        for (const url of candidates) {
            try {
                const response = await axios.get(url, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                        Businessunit: this.businessUnitId,
                    },
                });

                console.log('[PonttaRaw] sales-orders items -> URL:', url);
                console.log('[PonttaRaw] sales-orders items -> response.data:', JSON.stringify(response.data));

                const data = response.data;
                const items = Array.isArray(data) ? data : (data?.content || []);
                if (Array.isArray(items)) {
                    if (items.length > 0) {
                        console.log('[PonttaSalesOrderItems] sample keys:', JSON.stringify(Object.keys(items[0])));
                        console.log('[PonttaSalesOrderItems] sample item:', JSON.stringify(items[0]));
                    }
                    return items;
                }
            } catch (error) {
                const status = error?.response?.status;
                // Continua tentando os outros candidatos em caso de 404/405
                if (status === 404 || status === 405) continue;

                if (status === 401) {
                    throw new HttpException(
                        'Token Pontta expirado ou inválido.',
                        HttpStatus.UNAUTHORIZED,
                    );
                }

                const detail = error?.response?.data?.message || error?.response?.data?.error || error?.message || 'Erro desconhecido';
                throw new HttpException(
                    `Falha ao buscar itens do pedido de venda: ${detail}`,
                    status || HttpStatus.BAD_GATEWAY,
                );
            }
        }

        throw new HttpException(
            'Não foi possível localizar uma rota válida para itens do pedido de venda no Pontta.',
            HttpStatus.NOT_FOUND,
        );
    }

    /**
     * Busca pedidos de venda por período na rota summary.
     */
    async getSalesOrdersSummaryByDateRange(
        token: string,
        startIso: string,
        endIso: string,
        page: number = 0,
        size: number = 100,
    ): Promise<any[]> {
        try {
            const url = `${this.apiUrl}/sales-orders/summary`;
            const response = await axios.get(url, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    Businessunit: this.businessUnitId,
                },
                params: {
                    start: startIso,
                    end: endIso,
                    status: 'VALID',
                    page,
                    size,
                    sort: 'saleDate,number,desc',
                },
            });

            const data = response.data;
            if (Array.isArray(data)) return data;
            if (Array.isArray(data?.content)) return data.content;
            if (Array.isArray(data?.data?.content)) return data.data.content;
            return [];
        } catch (error) {
            const status = error?.response?.status;
            const detail = error?.response?.data?.message || error?.response?.data?.error || error?.message || 'Erro desconhecido';
            throw new HttpException(
                `Falha ao buscar pedidos de venda por período: ${detail}`,
                status || HttpStatus.BAD_GATEWAY,
            );
        }
    }

    /**
     * Busca o revenue principal vinculado ao pedido de venda pelo código.
     */
    async getRevenueBySalesOrderCode(token: string, salesOrderCode: string): Promise<any | null> {
        try {
            const url = `${this.apiUrl}/revenues/find-by-sales-order/${encodeURIComponent(salesOrderCode)}`;
            const response = await axios.get(url, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    Businessunit: this.businessUnitId,
                },
            });
            return response.data || null;
        } catch (error) {
            const status = error?.response?.status;
            if (status === 404) return null;
            const detail = error?.response?.data?.message || error?.response?.data?.error || error?.message || 'Erro desconhecido';
            throw new HttpException(
                `Falha ao buscar revenue por pedido de venda: ${detail}`,
                status || HttpStatus.BAD_GATEWAY,
            );
        }
    }

    /**
     * Busca o resumo de tarefas do pedido de venda.
     */
    async getSalesOrderTasksSummary(
        token: string,
        salesOrderId: string,
        page: number = 0,
        size: number = 100,
    ): Promise<any[]> {
        try {
            const url = `${this.apiUrl}/tasks/SALES_ORDER/${salesOrderId}/metadata/summary`;
            const response = await axios.get(url, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    Businessunit: this.businessUnitId,
                },
                params: { page, size },
            });
            const data = response.data;
            if (Array.isArray(data)) return data;
            if (Array.isArray(data?.content)) return data.content;
            return [];
        } catch (error) {
            const status = error?.response?.status;
            const detail = error?.response?.data?.message || error?.response?.data?.error || error?.message || 'Erro desconhecido';
            throw new HttpException(
                `Falha ao buscar tarefas do pedido de venda: ${detail}`,
                status || HttpStatus.BAD_GATEWAY,
            );
        }
    }
}
