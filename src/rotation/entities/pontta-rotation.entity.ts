import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

export type PonttaPcpArea = 'molhada' | 'intima' | 'social';

@Entity('tb_pontta_rotation')
export class PonttaRotation {
    @PrimaryGeneratedColumn()
    id: number;

    /** ID do cooperador no Pontta (cooperatorId de /api/users) */
    @Column({ type: 'text', name: 'projetistaid', nullable: true })
    projetistaid: string;

    @Column({ type: 'boolean', nullable: true, default: false })
    turn: boolean;

    @Column({ type: 'text', nullable: true })
    name: string;

    /** Flag auxiliar — nasce true e pode ser alterada */
    @Column({ type: 'boolean', name: 'turn_v', nullable: true, default: true })
    turn_v: boolean;

    /** Área PCP Operacional pela qual a pessoa é responsável (quando a atribuição por área está ativa). */
    @Column({ type: 'varchar', length: 32, name: 'pcp_area', nullable: true })
    pcpArea: PonttaPcpArea | null;
}
