import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';

@Entity('gosac_groups')
export class GosacGroup {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    /** ID do ticket/grupo no GOSAC */
    @Column({ type: 'int', unique: true })
    gosacTicketId: number;

    /** ID do contato no GOSAC */
    @Column({ type: 'int', default: 0 })
    gosacContactId: number;

    /** Nome do ticket/grupo no GOSAC */
    @Column()
    gosacTicketName: string;

    /** Indica se a associação está ativa */
    @Column({ default: true })
    isActive: boolean;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
