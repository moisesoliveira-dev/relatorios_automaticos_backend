import {
    Injectable,
    NotFoundException,
    ConflictException,
    BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Rotation } from './entities/rotation.entity';
import { CreateRotationDto, UpdateRotationDto } from './dto/rotation.dto';
import { GosacService } from '../gosac/gosac.service';
import { PonttaService } from '../pontta/pontta.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RotationService {
    private readonly ponttaEmail: string;
    private readonly ponttaPassword: string;

    constructor(
        @InjectRepository(Rotation, 'rotation')
        private readonly rotationRepository: Repository<Rotation>,
        private readonly gosacService: GosacService,
        private readonly ponttaService: PonttaService,
        private readonly configService: ConfigService,
    ) {
        this.ponttaEmail = this.configService.get<string>('PONTTA_EMAIL') || '';
        this.ponttaPassword = this.configService.get<string>('PONTTA_PASSWORD') || '';
    }

    findAll(): Promise<Rotation[]> {
        return this.rotationRepository.find({
            order: { name: 'ASC' },
        });
    }

    async findOne(id: string): Promise<Rotation> {
        const rotation = await this.rotationRepository.findOne({ where: { id } });
        if (!rotation) {
            throw new NotFoundException(`Registro de rodízio ${id} não encontrado`);
        }
        return rotation;
    }

    async create(dto: CreateRotationDto): Promise<Rotation> {
        if (!dto.id || !dto.name || dto.identificacao == null || dto.queueid == null) {
            throw new BadRequestException('id, name, identificacao e queueid são obrigatórios');
        }

        const existing = await this.rotationRepository.findOne({ where: { id: dto.id } });
        if (existing) {
            throw new ConflictException(`Já existe um registro com id ${dto.id}`);
        }

        const turn = dto.turn === true;
        if (turn) {
            await this.clearAllTurns();
        }

        const rotation = this.rotationRepository.create({
            id: dto.id,
            name: dto.name,
            identificacao: Number(dto.identificacao),
            queueid: Number(dto.queueid),
            turn,
        });

        return this.rotationRepository.save(rotation);
    }

    async update(id: string, dto: UpdateRotationDto): Promise<Rotation> {
        const rotation = await this.findOne(id);

        if (dto.name !== undefined) rotation.name = dto.name;
        if (dto.identificacao !== undefined) rotation.identificacao = Number(dto.identificacao);
        if (dto.queueid !== undefined) rotation.queueid = Number(dto.queueid);

        if (dto.turn !== undefined) {
            const turn = !!dto.turn;
            if (turn) {
                await this.clearAllTurns(id);
            }
            rotation.turn = turn;
        }

        return this.rotationRepository.save(rotation);
    }

    /** Garante no máximo uma pessoa com turn=true */
    private async clearAllTurns(exceptId?: string): Promise<void> {
        const qb = this.rotationRepository
            .createQueryBuilder()
            .update(Rotation)
            .set({ turn: false })
            .where('turn = :turn', { turn: true });

        if (exceptId) {
            qb.andWhere('id != :exceptId', { exceptId });
        }

        await qb.execute();
    }

    async remove(id: string): Promise<void> {
        const rotation = await this.findOne(id);
        await this.rotationRepository.remove(rotation);
    }

    async searchPonttaProfiles(query: string): Promise<any[]> {
        let token = await this.ponttaService.authenticate(this.ponttaEmail, this.ponttaPassword);
        try {
            return await this.ponttaService.searchSchedulesProfile(token, query);
        } catch (error) {
            if (error?.status === 401 || error?.response?.status === 401) {
                this.ponttaService.clearTokenCache(this.ponttaEmail);
                token = await this.ponttaService.authenticate(this.ponttaEmail, this.ponttaPassword);
                return await this.ponttaService.searchSchedulesProfile(token, query);
            }
            throw error;
        }
    }

    listGosacUsers(): Promise<any[]> {
        return this.gosacService.listAllUsers();
    }

    listGosacQueues(): Promise<any[]> {
        return this.gosacService.listQueues();
    }
}
