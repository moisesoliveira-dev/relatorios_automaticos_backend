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
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { Client } from 'pg';

/** O que a importação precisa do banco antigo (facilita testar). */
export interface LegacySource {
    query(sql: string): Promise<{ rows: any[] }>;
    end(): Promise<void>;
}

@Injectable()
export class RotationService implements OnModuleInit {
    private readonly logger = new Logger(RotationService.name);

    constructor(
        @InjectRepository(Rotation)
        private readonly rotationRepository: Repository<Rotation>,
        private readonly gosacService: GosacService,
        private readonly appConfig: AppConfigService,
    ) { }

    /**
     * Centralização: se ROTATION_DATABASE_URL (o banco antigo do rodízio) estiver definida e a tabela
     * daqui estiver vazia, copia as pessoas de lá uma única vez. Depois disso a variável pode ser removida.
     */
    async onModuleInit(): Promise<void> {
        try {
            await this.importLegacy();
        } catch (error) {
            this.logger.warn(`Não foi possível importar o rodízio do banco antigo: ${(error as Error).message}`);
        }
    }

    async importLegacy(open: () => Promise<LegacySource> = () => this.openLegacy()): Promise<number> {
        const url = this.appConfig.rotationDatabaseUrl?.trim();
        if (!url) return 0;
        if ((await this.rotationRepository.count()) > 0) return 0;

        const source = await open();
        try {
            const res = await source.query(
                'SELECT id, name, turn, identificacao, queueid FROM tb_rotation ORDER BY id',
            );
            const rows: Array<Partial<Rotation>> = res.rows ?? [];
            let copiados = 0;
            for (const r of rows) {
                if (r.id == null) continue;
                await this.rotationRepository.insert({
                    id: String(r.id),
                    name: r.name ?? '',
                    turn: !!r.turn,
                    identificacao: r.identificacao as number,
                    queueid: r.queueid as number,
                });
                copiados += 1;
            }
            this.logger.log(`Rodízio importado do banco antigo: ${copiados} pessoa(s). Pode remover ROTATION_DATABASE_URL.`);
            return copiados;
        } finally {
            await source.end().catch(() => undefined);
        }
    }

    private async openLegacy(): Promise<LegacySource> {
        const url = this.appConfig.rotationDatabaseUrl!.trim();
        const host = new URL(url).hostname;
        const local = !host.includes('.') || host === 'localhost' || host === '127.0.0.1';
        const client = new Client({
            connectionString: url,
            ssl: local ? false : { rejectUnauthorized: this.appConfig.dbSslRejectUnauthorized },
            connectionTimeoutMillis: 10_000,
        });
        await client.connect();
        return client;
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
