import { Injectable, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { GosacGroup } from './entities/gosac-group.entity';
import { PonttaSalesOrder } from './entities/pontta-sales-order.entity';
import { GosacSalesOrderLink } from './entities/gosac-sales-order-link.entity';
import { PonttaService } from '../pontta/pontta.service';
import { CreateGosacGroupDto, UpdateGosacGroupDto } from './dto/gosac.dto';

export interface GosacTicket {
    id: number;
    contact?: {
        id: number;
        name: string;
        number: string;
        profilePicUrl?: string;
    };
    lastMessage?: string;
    status: string;
    isGroup: boolean;
    unreadMessages: number;
    queue?: {
        id: number;
        name: string;
        color: string;
    };
    [key: string]: any;
}

@Injectable()
export class GosacService {
    private readonly gosacBaseUrl: string;
    private readonly gosacApiKey: string;
    private readonly ponttaEmail: string;
    private readonly ponttaPassword: string;

    constructor(
        @InjectRepository(GosacGroup)
        private readonly gosacGroupRepository: Repository<GosacGroup>,
        @InjectRepository(PonttaSalesOrder)
        private readonly salesOrderRepository: Repository<PonttaSalesOrder>,
        @InjectRepository(GosacSalesOrderLink)
        private readonly linkRepository: Repository<GosacSalesOrderLink>,
        private readonly ponttaService: PonttaService,
        private readonly configService: ConfigService,
    ) {
        this.gosacBaseUrl = this.configService.get<string>('GOSAC_BASE_URL') || 'https://cmmodulados.gosac.com.br';
        this.gosacApiKey = this.configService.get<string>('GOSAC_API_KEY') || 'your_gosac_api_key';
        this.ponttaEmail = this.configService.get<string>('PONTTA_EMAIL') || 'seu_email_pontta@example.com';
        this.ponttaPassword = this.configService.get<string>('PONTTA_PASSWORD') || '***REMOVIDO***';
        console.log(`[GosacService] ponttaEmail: "${this.ponttaEmail}", ponttaPassword definido: ${!!this.ponttaPassword}`);
    }

    /**
     * Pesquisa tickets no GOSAC que comecem com "Anexo" (case-insensitive)
     */
    async searchTickets(searchParam: string): Promise<GosacTicket[]> {
        try {
            // Garante case-insensitive: busca com a string como recebida
            const query = searchParam.trim();
            if (!query) {
                return [];
            }

            console.log(`🔍 Buscando tickets no GOSAC com: "${query}"`);

            const url = `${this.gosacBaseUrl}/api/tickets`;
            const response = await axios.get(url, {
                headers: {
                    Authorization: `INTEGRATION ${this.gosacApiKey}`,
                    'Content-Type': 'application/json',
                },
                params: {
                    searchParam: query,
                    pageNumber: 1,
                    status: 'open',
                    order: 'desc',
                    showAll: true,
                    viewGroups: true,
                },
            });

            const data = response.data;
            console.log(`✅ GOSAC retornou:`, JSON.stringify(data).substring(0, 500));

            // A API pode retornar { tickets: [...] } ou diretamente um array
            const allTickets: GosacTicket[] = Array.isArray(data)
                ? data
                : (data?.tickets || []);

            // Filtra apenas grupos (isGroup === true)
            const tickets = allTickets.filter(t => t.isGroup === true);

            return tickets;
        } catch (error) {
            console.error('❌ Erro ao buscar tickets no GOSAC:', error.response?.data || error.message);
            throw new HttpException(
                `Falha ao buscar tickets no GOSAC: ${error.response?.data?.error || error.message}`,
                error.response?.status || HttpStatus.BAD_REQUEST,
            );
        }
    }

    // ===== CRUD de Grupos Associados =====

    async findAllGroups() {
        const groups = await this.gosacGroupRepository.find({
            order: { createdAt: 'DESC' },
        });

        // Carrega os links / pedidos de venda (+ dados da ocorrência) para cada grupo
        const result: Array<GosacGroup & { salesOrders: any[] }> = [];
        for (const group of groups) {
            const links = await this.linkRepository.find({
                where: { gosacGroupId: group.id },
                relations: ['salesOrder'],
            });
            result.push({
                ...group,
                salesOrders: links
                    .filter(l => l.salesOrder)
                    .map(l => ({
                        ...l.salesOrder,
                        ponttaOccurrenceId: l.ponttaOccurrenceId ?? null,
                        ponttaOccurrenceNumber: l.ponttaOccurrenceNumber ?? null,
                        ponttaOccurrenceStatus: l.ponttaOccurrenceStatus ?? 'pending',
                    })),
            });
        }

        return result;
    }

    async findGroupById(id: string): Promise<GosacGroup> {
        const group = await this.gosacGroupRepository.findOne({ where: { id } });
        if (!group) {
            throw new NotFoundException('Grupo GOSAC não encontrado');
        }
        return group;
    }

    async findGroupByTicketId(gosacTicketId: number): Promise<GosacGroup | null> {
        return this.gosacGroupRepository.findOne({ where: { gosacTicketId } });
    }

    async createGroup(dto: CreateGosacGroupDto): Promise<GosacGroup> {
        // Verifica se já existe
        const existing = await this.gosacGroupRepository.findOne({
            where: { gosacTicketId: dto.gosacTicketId },
        });
        if (existing) {
            throw new HttpException(
                'Este ticket GOSAC já está cadastrado',
                HttpStatus.CONFLICT,
            );
        }

        const group = this.gosacGroupRepository.create({
            ...dto,
            isActive: true,
        });
        return this.gosacGroupRepository.save(group);
    }

    async updateGroup(id: string, dto: UpdateGosacGroupDto): Promise<GosacGroup> {
        const group = await this.findGroupById(id);
        Object.assign(group, dto);
        return this.gosacGroupRepository.save(group);
    }

    async deleteGroup(id: string): Promise<void> {
        const group = await this.findGroupById(id);
        await this.gosacGroupRepository.remove(group);
    }

    async toggleGroup(id: string): Promise<GosacGroup> {
        const group = await this.findGroupById(id);
        group.isActive = !group.isActive;
        return this.gosacGroupRepository.save(group);
    }

    // ===== Pedidos de Venda Pontta =====

    async searchSalesOrders(query: string): Promise<any[]> {
        let token = await this.ponttaService.authenticate(this.ponttaEmail, this.ponttaPassword);
        try {
            const results = await this.ponttaService.searchSalesOrders(token, query);
            return results.map((item: any) => ({
                ponttaId: item.id,
                code: item.code || item.number || '',
                customerName: item.customer?.name || item.customerName || '',
            }));
        } catch (error) {
            // Se foi 401, limpa o cache e tenta uma vez com token novo
            if (error?.status === 401 || error?.response?.status === 401) {
                console.warn('♻️ Token Pontta expirado, reautenticando...');
                this.ponttaService.clearTokenCache(this.ponttaEmail);
                token = await this.ponttaService.authenticate(this.ponttaEmail, this.ponttaPassword);
                const results = await this.ponttaService.searchSalesOrders(token, query);
                return results.map((item: any) => ({
                    ponttaId: item.id,
                    code: item.code || item.number || '',
                    customerName: item.customer?.name || item.customerName || '',
                }));
            }
            throw error;
        }
    }

    /**
     * Associa um pedido de venda a um grupo GOSAC.
     * Salva o pedido na tabela de cache, cria o link e cria uma ocorrência no Pontta.
     */
    async linkSalesOrder(groupId: string, ponttaId: string, code: string, customerName: string) {
        // Garante que o grupo existe
        const group = await this.findGroupById(groupId);

        // Upsert do pedido de venda no cache
        let salesOrder = await this.salesOrderRepository.findOne({ where: { ponttaId } });
        if (!salesOrder) {
            salesOrder = this.salesOrderRepository.create({ ponttaId, code, customerName });
            salesOrder = await this.salesOrderRepository.save(salesOrder);
        } else {
            // Atualiza se mudou
            salesOrder.code = code;
            salesOrder.customerName = customerName;
            salesOrder = await this.salesOrderRepository.save(salesOrder);
        }

        // Permite apenas 1 pedido de venda por grupo
        const existingLink = await this.linkRepository.findOne({
            where: { gosacGroupId: groupId },
        });
        if (existingLink) {
            throw new HttpException('Este grupo já possui um pedido de venda vinculado. Desvincule primeiro.', HttpStatus.CONFLICT);
        }

        const link = this.linkRepository.create({
            gosacGroupId: groupId,
            salesOrderId: salesOrder.id,
        });
        await this.linkRepository.save(link);

        // Cria ocorrência no Pontta em segundo plano (não bloqueia a resposta ao frontend)
        this.createPonttaOccurrenceBackground(link.id, salesOrder, group, code, ponttaId);

        // Responde imediatamente ao frontend para não travar a UI
        return {
            salesOrder: {
                ...salesOrder,
                ponttaOccurrenceId: null,
                ponttaOccurrenceNumber: null,
                ponttaOccurrenceStatus: 'pending',
            },
            link,
            occurrenceWarning: null,
        };
    }

    /**
     * Cria a ocorrência Pontta em segundo plano após o vínculo já ter sido salvo no banco.
     * Não lança exceções — apenas loga erros.
     */
    private async createPonttaOccurrenceBackground(
        linkId: string,
        salesOrder: any,
        group: any,
        code: string,
        ponttaId: string,
    ): Promise<void> {
        try {
            console.log(`🔐 [bg] Autenticando no Pontta com email: ${this.ponttaEmail}`);
            const token = await this.ponttaService.authenticate(this.ponttaEmail, this.ponttaPassword);
            console.log(`📝 [bg] Token obtido, criando ocorrência para PV ${code}...`);
            const occurrence = await this.ponttaService.createOccurrence(token, {
                title: `Anexos GOSAC - ${group.gosacTicketName}`,
                note: `Ocorrência criada automaticamente para receber anexos do grupo GOSAC "${group.gosacTicketName}" (Ticket #${group.gosacTicketId})`,
                salesOrderCode: code,
                salesOrderId: ponttaId,
            });

            console.log(`🔍 [bg] occurrence typeof: ${typeof occurrence}`);
            console.log(`🔍 [bg] occurrence raw: ${JSON.stringify(occurrence)}`);

            const occurrenceId = typeof occurrence === 'string' ? occurrence : (occurrence?.id ?? null);
            const occurrenceNumber = typeof occurrence === 'object'
                ? (occurrence?.number ?? occurrence?.occurrenceNumber ?? null)
                : null;

            // Atualiza o link com os dados da ocorrência
            await this.linkRepository.update(linkId, {
                ponttaOccurrenceId: occurrenceId,
                ponttaOccurrenceNumber: occurrenceNumber,
                ponttaOccurrenceStatus: 'created',
            });

            console.log(`✅ [bg] occurrenceId salvo: ${occurrenceId}`);
            console.log(`✅ [bg] occurrenceNumber salvo: ${occurrenceNumber}`);
        } catch (error) {
            console.error(`⚠️ [bg] Falha ao criar ocorrência Pontta em segundo plano: ${error?.message}`);
            await this.linkRepository.update(linkId, { ponttaOccurrenceStatus: 'failed' });
        }
    }

    /**
     * Remove a associação entre pedido de venda e grupo
     */
    async unlinkSalesOrder(groupId: string, salesOrderId: string): Promise<void> {
        const link = await this.linkRepository.findOne({
            where: { gosacGroupId: groupId, salesOrderId },
        });
        if (!link) {
            throw new NotFoundException('Associação não encontrada');
        }
        await this.linkRepository.remove(link);
    }

    /**
     * Lista os pedidos de venda associados a um grupo
     */
    async getGroupSalesOrders(groupId: string): Promise<PonttaSalesOrder[]> {
        const links = await this.linkRepository.find({
            where: { gosacGroupId: groupId },
            relations: ['salesOrder'],
        });
        return links.map(l => l.salesOrder).filter(Boolean);
    }

    /**
     * Processa webhook do GOSAC.
     * Quando uma mensagem contém mídia (imagem/arquivo), baixa o arquivo e envia para a ocorrência Pontta.
     * Estrutura real do payload: { data: { mediaUrl, mediaPath, body, ticket: { id } }, type }
     */
    async handleWebhook(payload: any): Promise<{ status: string; message: string }> {
        console.log('📨 Webhook GOSAC recebido:', JSON.stringify(payload).substring(0, 500));

        // O GOSAC envolve tudo em payload.data
        const data = payload?.data ?? payload;

        // Extrai o ticketId
        const ticketId = data?.ticket?.id ?? data?.ticketId ?? payload?.ticketId;
        if (!ticketId) {
            console.log('⚠️ Webhook sem ticketId, ignorando.');
            return { status: 'ignored', message: 'Sem ticketId no payload' };
        }

        // Verifica se há mídia na mensagem
        const mediaUrl: string | null = data?.mediaUrl ?? null;
        const mediaPath: string | null = data?.mediaPath ?? null;
        const mediaName: string = data?.body || `arquivo_${ticketId}_${Date.now()}`;

        if (!mediaUrl && !mediaPath) {
            console.log(`ℹ️ Webhook para ticket #${ticketId} sem mídia, ignorando.`);
            return { status: 'ignored', message: 'Mensagem sem mídia' };
        }

        // Busca o grupo GOSAC associado a esse ticket
        const group = await this.gosacGroupRepository.findOne({
            where: { gosacTicketId: ticketId, isActive: true },
        });
        if (!group) {
            console.log(`ℹ️ Ticket #${ticketId} não está associado a nenhum grupo ativo, ignorando.`);
            return { status: 'ignored', message: `Ticket #${ticketId} sem grupo ativo` };
        }

        // Busca o link com a ocorrência Pontta
        const link = await this.linkRepository.findOne({
            where: { gosacGroupId: group.id },
        });
        if (!link || !link.ponttaOccurrenceId) {
            console.log(`⚠️ Grupo "${group.gosacTicketName}" sem ocorrência Pontta vinculada.`);
            return { status: 'ignored', message: `Grupo sem ocorrência Pontta vinculada` };
        }

        // mediaUrl e mediaPath do GOSAC já chegam como URLs completas
        const fileUrl = (mediaUrl || mediaPath) as string;

        try {
            // Baixa o arquivo do GOSAC
            console.log(`⬇️ Baixando arquivo de: ${fileUrl}`);
            const response = await axios.get(fileUrl, {
                responseType: 'arraybuffer',
                headers: {
                    Authorization: `INTEGRATION ${this.gosacApiKey}`,
                },
                timeout: 30000,
            });

            const fileBuffer = Buffer.from(response.data);
            const contentType = response.headers['content-type'] || 'application/octet-stream';

            // Determina o nome do arquivo
            let filename = mediaName;
            const contentDisposition = response.headers['content-disposition'];
            if (contentDisposition) {
                const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
                if (match) filename = match[1].replace(/['"]/g, '');
            }
            if (!filename || filename === 'arquivo') {
                const ext = contentType.split('/')[1]?.split(';')[0] || 'bin';
                filename = `gosac_${ticketId}_${Date.now()}.${ext}`;
            }

            // Autentica no Pontta e faz upload
            const token = await this.ponttaService.authenticate(this.ponttaEmail, this.ponttaPassword);
            await this.ponttaService.uploadFileToOccurrence(
                token,
                link.ponttaOccurrenceId,
                fileBuffer,
                filename,
                contentType,
            );

            console.log(`✅ Arquivo "${filename}" enviado para ocorrência Pontta #${link.ponttaOccurrenceNumber || link.ponttaOccurrenceId}`);
            return { status: 'success', message: `Arquivo "${filename}" enviado para ocorrência Pontta` };
        } catch (error) {
            console.error(`❌ Erro ao processar mídia do webhook:`, error.message);
            return { status: 'error', message: `Erro ao processar mídia: ${error.message}` };
        }
    }
}
