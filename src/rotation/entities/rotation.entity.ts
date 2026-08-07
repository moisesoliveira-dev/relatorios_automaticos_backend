import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('tb_rotation')
export class Rotation {
    /** ID do perfil no Pontta (schedules/profile) */
    @PrimaryColumn({ type: 'uuid' })
    id: string;

    /** Nome do usuário no GOSAC */
    @Column()
    name: string;

    /** Quem está na vez — alterado por outra API; neste sistema só leitura */
    @Column({ type: 'boolean', default: false })
    turn: boolean;

    /** ID do usuário no GOSAC */
    @Column({ type: 'int' })
    identificacao: number;

    /** ID da fila no GOSAC */
    @Column({ type: 'int', name: 'queueid' })
    queueid: number;
}
