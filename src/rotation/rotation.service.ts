import {
    Injectable,
    NotFoundException,
    ConflictException,
    BadRequestException,
    Logger,
    OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Rotation } from './entities/rotation.entity';
import { CreateRotationDto, UpdateRotationDto } from './dto/rotation.dto';
import { GosacService } from '../gosac/gosac.service';

@Injectable()
export class RotationService implements OnModuleInit {
    private readonly logger = new Logger(RotationService.name);

    constructor(
        @InjectRepository(Rotation, 'rotation')
        private readonly rotationRepository: Repository<Rotation>,
        private readonly gosacService: GosacService,
    ) { }

    /** Banco novo (ou limpo): cria a tabela do rodízio se ainda não existir. */
    async onModuleInit(): Promise<void> {
        try {
            await this.rotationRepository.query(
                `CREATE TABLE IF NOT EXISTS tb_rotation (
                    id text PRIMARY KEY,
                    name text,
                    turn boolean DEFAULT false,
                    identificacao integer,
                    queueid integer
                )`,
            );
        } catch (error) {
            this.logger.warn(`Não foi possível garantir a tabela tb_rotation: ${(error as Error).message}`);
        }
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
        if (exceptId) {
            await this.rotationRepository
                .createQueryBuilder()
                .update(Rotation)
                .set({ turn: false })
                .where('turn = true')
                .andWhere('id != :exceptId', { exceptId })
                .execute();
            return;
        }

        await this.rotationRepository
            .createQueryBuilder()
            .update(Rotation)
            .set({ turn: false })
            .where('turn = true')
            .execute();
    }

    async remove(id: string): Promise<void> {
        const rotation = await this.findOne(id);
        await this.rotationRepository.remove(rotation);
    }

    listGosacUsers(): Promise<any[]> {
        return this.gosacService.listAllUsers();
    }

    listGosacQueues(): Promise<any[]> {
        return this.gosacService.listQueues();
    }
}
