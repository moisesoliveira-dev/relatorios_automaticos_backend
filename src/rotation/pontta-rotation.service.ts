import {
    Injectable,
    NotFoundException,
    ConflictException,
    BadRequestException,
    OnModuleInit,
    Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PonttaRotation, PonttaPcpArea } from './entities/pontta-rotation.entity';
import {
    CreatePonttaRotationDto,
    UpdatePonttaRotationDto,
    ASSIGN_BY_PCP_AREA_SETTING_KEY,
} from './dto/pontta-rotation.dto';
import { PonttaService } from '../pontta/pontta.service';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class PonttaRotationService implements OnModuleInit {
    private readonly logger = new Logger(PonttaRotationService.name);
    private readonly ponttaEmail: string;
    private readonly ponttaPassword: string;

    constructor(
        @InjectRepository(PonttaRotation, 'rotation')
        private readonly repository: Repository<PonttaRotation>,
        private readonly ponttaService: PonttaService,
        private readonly configService: ConfigService,
        private readonly settingsService: SettingsService,
    ) {
        this.ponttaEmail = this.configService.get<string>('PONTTA_EMAIL') || '';
        this.ponttaPassword = this.configService.get<string>('PONTTA_PASSWORD') || '';
    }

    async onModuleInit() {
        try {
            await this.repository.query(`
                ALTER TABLE tb_pontta_rotation
                ADD COLUMN IF NOT EXISTS pcp_area VARCHAR(32) DEFAULT NULL
            `);
        } catch (error) {
            this.logger.warn(
                `Não foi possível garantir coluna pcp_area: ${(error as Error).message}`,
            );
        }
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

    async getAssignByPcpAreaEnabled(): Promise<{ enabled: boolean }> {
        const raw = await this.settingsService.findByKey(ASSIGN_BY_PCP_AREA_SETTING_KEY);
        return { enabled: raw === 'true' || raw === '1' };
    }

    async setAssignByPcpAreaEnabled(enabled: boolean): Promise<{ enabled: boolean }> {
        await this.settingsService.upsert(
            ASSIGN_BY_PCP_AREA_SETTING_KEY,
            enabled ? 'true' : 'false',
            'pcp',
            'Quando ativo, tarefas automáticas atribuem o responsável conforme a área PCP do ambiente',
        );
        return { enabled };
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

        const pcpArea = this.normalizePcpArea(dto.pcpArea);
        const turn = dto.turn === true;
        if (turn) {
            await this.clearTurnsForScope(pcpArea);
        }

        const row = this.repository.create({
            projetistaid: dto.projetistaid,
            name: dto.name,
            turn,
            turn_v: true,
            pcpArea,
        });

        return this.repository.save(row);
    }

    async update(id: number, dto: UpdatePonttaRotationDto): Promise<PonttaRotation> {
        const row = await this.findOne(id);

        if (dto.projetistaid !== undefined) row.projetistaid = dto.projetistaid;
        if (dto.name !== undefined) row.name = dto.name;
        row.turn_v = true;

        if (dto.pcpArea !== undefined) {
            row.pcpArea = this.normalizePcpArea(dto.pcpArea);
        }

        if (dto.turn !== undefined) {
            const turn = !!dto.turn;
            if (turn) {
                await this.clearTurnsForScope(row.pcpArea, id);
            }
            row.turn = turn;
        }

        return this.repository.save(row);
    }

    /**
     * Com atribuição por área ativa, a "vez" é por área (só desmarca quem tem a mesma área).
     * Sem área (ou modo clássico), desmarca todas.
     */
    private async clearTurnsForScope(pcpArea: PonttaPcpArea | null, exceptId?: number): Promise<void> {
        const qb = this.repository
            .createQueryBuilder()
            .update(PonttaRotation)
            .set({ turn: false })
            .where('turn = true');

        if (pcpArea) {
            qb.andWhere('pcp_area = :pcpArea', { pcpArea });
        }

        if (exceptId != null) {
            qb.andWhere('id != :exceptId', { exceptId });
        }

        await qb.execute();
    }

    private normalizePcpArea(value: string | null | undefined): PonttaPcpArea | null {
        if (value === null || value === undefined || value === '') return null;
        if (value === 'molhada' || value === 'intima' || value === 'social') return value;
        throw new BadRequestException('pcpArea inválida. Use molhada, intima ou social.');
    }

    async remove(id: number): Promise<void> {
        const row = await this.findOne(id);
        await this.repository.remove(row);
    }

    async searchPonttaProfiles(query: string): Promise<any[]> {
        let token = await this.ponttaService.authenticate(this.ponttaEmail, this.ponttaPassword);
        try {
            return await this.ponttaService.searchUsers(token, query);
        } catch (error) {
            if (error?.status === 401 || error?.response?.status === 401) {
                this.ponttaService.clearTokenCache(this.ponttaEmail);
                token = await this.ponttaService.authenticate(this.ponttaEmail, this.ponttaPassword);
                return await this.ponttaService.searchUsers(token, query);
            }
            throw error;
        }
    }
}
