import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('tb_rotation')
export class Rotation {
    /** ID do perfil no Pontta (schedules/profile) — coluna text no banco */
    @PrimaryColumn({ type: 'text' })
    id: string;

    /** Nome do usuário no GOSAC */
    @Column({ type: 'text', nullable: true })
    name: string;

    /** Quem está na vez — alterado por outra API; neste sistema só leitura */
    @Column({ type: 'boolean', nullable: true, default: false })
    turn: boolean;

    /** ID do usuário no GOSAC */
    @Column({ type: 'int', nullable: true })
    identificacao: number;

    /** ID da fila no GOSAC */
    @Column({ type: 'int', name: 'queueid', nullable: true })
    queueid: number;
}
