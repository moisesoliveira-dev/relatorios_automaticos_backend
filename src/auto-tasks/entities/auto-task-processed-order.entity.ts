import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('auto_task_processed_orders')
@Index(['code'], { unique: true })
@Index(['saleDate'])
@Index(['processedAt'])
export class AutoTaskProcessedOrder {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'sales_order_id', type: 'varchar', length: 255 })
  salesOrderId: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  code: string;

  /** Data de venda do PV no fuso de Manaus (YYYY-MM-DD) */
  @Column({ name: 'sale_date', type: 'date' })
  saleDate: string;

  @CreateDateColumn({ name: 'processed_at' })
  processedAt: Date;
}
