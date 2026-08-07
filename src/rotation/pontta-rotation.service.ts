import {
    Injectable,
    NotFoundException,
    ConflictException,
    BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PonttaRotation } from './entities/pontta-rotation.entity';
import { CreatePonttaRotationDto, UpdatePonttaRotationDto } from './dto/pontta-rotation.dto';
import { PonttaService } from '../pontta/pontta.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PonttaRotationService {
    private readonly ponttaEmail: string;
    private readonly ponttaPassword: string;

    constructor(
        @InjectRepository(PonttaRotation, 'rotation')
        private readonly repository: Repository<PonttaRotation>,
        private readonly ponttaService: PonttaService,
        private readonly configService: ConfigService,
    ) {
        this.ponttaEmail = this.configService.get<string>('PONTTA_EMAIL') || '';
        this.ponttaPassword = this.configService.get<string>('PONTTA_PASSWORD') || '';
    }

    findAll(): Promise<PonttaRotation[]> {
        return this.repository.find({ order: { name: 'ASC' } });
    }

    async findOne(id: number): Promise<PonttaRotation> {
        const row = await this.repository.findOne({ where: { id } });
        if (!row) {
            throw new NotFoundException(`Registro de rodízio Pontta ${id} não encontrado`);
        }
        return row;
    }

    async create(dto: CreatePonttaRotationDto): Promise<PonttaRotation> {
        if (!dto.projetistaid || !dto.name) {
            throw new BadRequestException('projetistaid e name são obrigatórios');
        }

        const existing = await this.repository.findOne({
            where: { projetistaid: dto.projetistaid },
        });
        if (existing) {
            throw new ConflictException(`Já existe um registro com projetistaid ${dto.projetistaid}`);
        }

        const turn = dto.turn === true;
        if (turn) {
            await this.clearAllTurns();
        }

        const row = this.repository.create({
            projetistaid: dto.projetistaid,
            name: dto.name,
            turn,
            turn_v: dto.turn_v === undefined ? true : !!dto.turn_v,
        });

        return this.repository.save(row);
    }

    async update(id: number, dto: UpdatePonttaRotationDto): Promise<PonttaRotation> {
        const row = await this.findOne(id);

        if (dto.projetistaid !== undefined) row.projetistaid = dto.projetistaid;
        if (dto.name !== undefined) row.name = dto.name;
        if (dto.turn_v !== undefined) row.turn_v = !!dto.turn_v;

        if (dto.turn !== undefined) {
            const turn = !!dto.turn;
            if (turn) {
                await this.clearAllTurns(id);
            }
            row.turn = turn;
        }

        return this.repository.save(row);
    }

    private async clearAllTurns(exceptId?: number): Promise<void> {
        const qb = this.repository
            .createQueryBuilder()
            .update(PonttaRotation)
            .set({ turn: false })
            .where('turn = true');

        if (exceptId != null) {
            qb.andWhere('id != :exceptId', { exceptId });
        }

        await qb.execute();
    }

    async remove(id: number): Promise<void> {
        const row = await this.findOne(id);
        await this.repository.remove(row);
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
}
