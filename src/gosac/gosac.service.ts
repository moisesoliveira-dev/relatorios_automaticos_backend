import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import axios from 'axios';
import { AppConfigService } from '../infrastructure/config/app-config.service';

/** Consultas à API do GOSAC usadas pelo rodízio (usuários e filas). O atendimento em si é do módulo `chatbot`. */
@Injectable()
export class GosacService {
    private readonly logger = new Logger(GosacService.name);
    private readonly gosacBaseUrl: string;
    private readonly gosacApiKey: string;

    constructor(private readonly appConfig: AppConfigService) {
        const gosac = this.appConfig.gosacApi;
        this.gosacBaseUrl = gosac.baseUrl ?? '';
        this.gosacApiKey = gosac.apiKey ?? '';

        if (!this.gosacBaseUrl || !this.gosacApiKey) {
            this.logger.warn(
                'GOSAC_BASE_URL ou GOSAC_API_KEY ausentes — app sobe normalmente, mas rotas GOSAC falham até configurar no Railway.',
            );
        }
    }

    private ensureGosacConfigured(): void {
        if (!this.gosacBaseUrl || !this.gosacApiKey) {
            throw new HttpException(
                'Integração GOSAC não configurada. Defina GOSAC_BASE_URL e GOSAC_API_KEY no Railway.',
                HttpStatus.SERVICE_UNAVAILABLE,
            );
        }
    }

    /**
     * Lista todos os usuários do GOSAC, percorrendo todas as páginas.
     */
    async listAllUsers(): Promise<any[]> {
        this.ensureGosacConfigured();
        const limit = 25;
        let pageNumber = 1;
        const allUsers: any[] = [];

        try {
            while (true) {
                const url = `${this.gosacBaseUrl}/api/users`;
                const response = await axios.get(url, {
                    headers: {
                        Authorization: `INTEGRATION ${this.gosacApiKey}`,
                        'Content-Type': 'application/json',
                    },
                    params: {
                        startsWith: '',
                        limit,
                        pageNumber,
                    },
                });

                const data = response.data;
                const users: any[] = Array.isArray(data?.users) ? data.users : [];
                allUsers.push(...users);

                if (!data?.hasMore || users.length === 0) {
                    break;
                }
                pageNumber += 1;
            }

            return allUsers;
        } catch (error) {
            console.error('Erro ao listar usuários GOSAC:', error.response?.data || error.message);
            throw new HttpException(
                `Falha ao listar usuários GOSAC: ${error.response?.data?.message || error.message}`,
                error.response?.status || HttpStatus.BAD_GATEWAY,
            );
        }
    }

    /**
     * Lista todas as filas (queues) do GOSAC.
     */
    async listQueues(): Promise<any[]> {
        this.ensureGosacConfigured();
        try {
            const url = `${this.gosacBaseUrl}/api/queue`;
            const response = await axios.get(url, {
                headers: {
                    Authorization: `INTEGRATION ${this.gosacApiKey}`,
                    'Content-Type': 'application/json',
                },
            });

            const data = response.data;
            return Array.isArray(data) ? data : [];
        } catch (error) {
            console.error('Erro ao listar filas GOSAC:', error.response?.data || error.message);
            throw new HttpException(
                `Falha ao listar filas GOSAC: ${error.response?.data?.message || error.message}`,
                error.response?.status || HttpStatus.BAD_GATEWAY,
            );
        }
    }
}
