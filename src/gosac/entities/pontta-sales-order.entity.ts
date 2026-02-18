import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';

@Entity('pontta_sales_orders')
export class PonttaSalesOrder {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    /** ID original do pedido no Pontta (UUID) */
    @Column({ type: 'varchar', unique: true })
    ponttaId: string;

    /** Código do pedido (ex: PV-CM-600) */
    @Column({ type: 'varchar' })
    code: string;

    /** Nome do cliente */
    @Column({ type: 'varchar' })
    customerName: string;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
