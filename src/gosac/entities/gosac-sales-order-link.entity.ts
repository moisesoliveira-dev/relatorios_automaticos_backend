import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    ManyToOne,
    JoinColumn,
    Unique,
} from 'typeorm';
import { GosacGroup } from './gosac-group.entity';
import { PonttaSalesOrder } from './pontta-sales-order.entity';

@Entity('gosac_sales_order_links')
@Unique(['gosacGroupId', 'salesOrderId'])
export class GosacSalesOrderLink {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'uuid' })
    gosacGroupId: string;

    @Column({ type: 'uuid' })
    salesOrderId: string;

    /** ID da ocorrência criada no Pontta para esta associação */
    @Column({ type: 'varchar', nullable: true })
    ponttaOccurrenceId: string | null;

    /** Número da ocorrência no Pontta (ex: 123) */
    @Column({ type: 'int', nullable: true })
    ponttaOccurrenceNumber: number | null;

    @ManyToOne(() => GosacGroup, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'gosacGroupId' })
    gosacGroup: GosacGroup;

    @ManyToOne(() => PonttaSalesOrder, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'salesOrderId' })
    salesOrder: PonttaSalesOrder;

    @CreateDateColumn()
    createdAt: Date;
}
