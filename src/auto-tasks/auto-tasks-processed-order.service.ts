import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { AutoTaskProcessedOrder } from './entities/auto-task-processed-order.entity';
import { obterDataHojeManaus } from './utils/date.utils';

@Injectable()
export class AutoTasksProcessedOrderService implements OnModuleInit {
  constructor(
    @InjectRepository(AutoTaskProcessedOrder)
    private readonly repository: Repository<AutoTaskProcessedOrder>,
    private readonly dataSource: DataSource,
    private readonly appConfig: AppConfigService,
  ) {}

  async onModuleInit() {
    if (!this.appConfig.isProduction) return;

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS auto_task_processed_orders (
        id SERIAL PRIMARY KEY,
        sales_order_id VARCHAR(255) NOT NULL,
        code VARCHAR(255) NOT NULL UNIQUE,
        sale_date DATE NOT NULL,
        processed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_auto_task_processed_sale_date ON auto_task_processed_orders (sale_date);
      CREATE INDEX IF NOT EXISTS idx_auto_task_processed_at ON auto_task_processed_orders (processed_at);
    `);
  }

  async existe(code: string): Promise<boolean> {
    const count = await this.repository.count({ where: { code } });
    return count > 0;
  }

  async registrar(salesOrderId: string, code: string, saleDate: string): Promise<void> {
    const entity = this.repository.create({
      salesOrderId,
      code,
      saleDate: this.normalizarDataVenda(saleDate),
    });
    await this.repository.save(entity);
  }

  async listar(options?: {
    q?: string;
    limit?: number;
    offset?: number;
    todayOnly?: boolean;
  }): Promise<{
    items: Array<{ id: number; salesOrderId: string; code: string; saleDate: string; createdAt: string }>;
    total: number;
  }> {
    const limit = Math.max(1, Math.min(options?.limit ?? 25, 200));
    const offset = Math.max(0, options?.offset ?? 0);
    const q = (options?.q || '').trim();
    const todayOnly = options?.todayOnly !== false;
    const hoje = obterDataHojeManaus();

    const qb = this.repository.createQueryBuilder('order');

    if (todayOnly) {
      qb.andWhere('order.saleDate = :hoje', { hoje });
    } else {
      qb.andWhere('order.saleDate >= :hoje', { hoje });
    }

    if (q) {
      qb.andWhere('(order.code ILIKE :q OR order.salesOrderId ILIKE :q)', { q: `%${q}%` });
    }

    const total = await qb.getCount();

    const rows = await qb
      .orderBy('order.processedAt', 'DESC')
      .addOrderBy('order.id', 'DESC')
      .skip(offset)
      .take(limit)
      .getMany();

    return {
      total,
      items: rows.map((row) => ({
        id: row.id,
        salesOrderId: row.salesOrderId,
        code: row.code,
        saleDate: row.saleDate,
        createdAt: row.processedAt.toISOString(),
      })),
    };
  }

  async remover(code: string): Promise<boolean> {
    const result = await this.repository.delete({ code });
    return (result.affected ?? 0) > 0;
  }

  private normalizarDataVenda(saleDate: string | Date): string {
    const parsed = new Date(saleDate);
    if (Number.isNaN(parsed.getTime())) {
      return obterDataHojeManaus();
    }
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Manaus',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(parsed);
  }
}
