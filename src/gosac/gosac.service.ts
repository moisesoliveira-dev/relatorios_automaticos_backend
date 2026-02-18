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
        this.ponttaEmail = this.configService.get<string>('PONTTA_EMAIL') || '';
        this.ponttaPassword = this.configService.get<string>('PONTTA_PASSWORD') || '';
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

        // Carrega os links / pedidos de venda para cada grupo
        const result: Array<GosacGroup & { salesOrders: PonttaSalesOrder[] }> = [];
        for (const group of groups) {
            const links = await this.linkRepository.find({
                where: { gosacGroupId: group.id },
                relations: ['salesOrder'],
            });
            result.push({
                ...group,
                salesOrders: links.map(l => l.salesOrder).filter(Boolean),
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
        const token = await this.ponttaService.authenticate(this.ponttaEmail, this.ponttaPassword);
        const results = await this.ponttaService.searchSalesOrders(token, query);

        return results.map((item: any) => ({
            ponttaId: item.id,
            code: item.code || item.number || '',
            customerName: item.customer?.name || item.customerName || '',
        }));
    }

    /**
     * Associa um pedido de venda a um grupo GOSAC.
     * Salva o pedido na tabela de cache e cria o link.
     */
    async linkSalesOrder(groupId: string, ponttaId: string, code: string, customerName: string) {
        // Garante que o grupo existe
        await this.findGroupById(groupId);

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

        return { salesOrder, link };
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
}
