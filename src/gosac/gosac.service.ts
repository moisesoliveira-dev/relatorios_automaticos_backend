import { Injectable, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { GosacGroup } from './entities/gosac-group.entity';
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

    constructor(
        @InjectRepository(GosacGroup)
        private readonly gosacGroupRepository: Repository<GosacGroup>,
        private readonly configService: ConfigService,
    ) {
        this.gosacBaseUrl = this.configService.get<string>('GOSAC_BASE_URL') || 'https://cmmodulados.gosac.com.br';
        this.gosacApiKey = this.configService.get<string>('GOSAC_API_KEY') || 'your_gosac_api_key';
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
            const tickets: GosacTicket[] = Array.isArray(data)
                ? data
                : (data?.tickets || []);

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

    async findAllGroups(): Promise<GosacGroup[]> {
        return this.gosacGroupRepository.find({
            order: { createdAt: 'DESC' },
        });
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
}
