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

    @ManyToOne(() => GosacGroup, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'gosacGroupId' })
    gosacGroup: GosacGroup;

    @ManyToOne(() => PonttaSalesOrder, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'salesOrderId' })
    salesOrder: PonttaSalesOrder;

    @CreateDateColumn()
    createdAt: Date;
}
