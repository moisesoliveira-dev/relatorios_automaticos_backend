import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('tb_pontta_rotation')
export class PonttaRotation {
    @PrimaryGeneratedColumn()
    id: number;

    /** ID do perfil no Pontta (schedules/profile) */
    @Column({ type: 'text', name: 'projetistaid', nullable: true })
    projetistaid: string;

    @Column({ type: 'boolean', nullable: true, default: false })
    turn: boolean;

    @Column({ type: 'text', nullable: true })
    name: string;

    /** Flag auxiliar — nasce true e pode ser alterada */
    @Column({ type: 'boolean', name: 'turn_v', nullable: true, default: true })
    turn_v: boolean;
}
