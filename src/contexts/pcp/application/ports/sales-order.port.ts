import { SalesOrderSummary } from '../../domain/pcp.types';

/** Port (hexagonal): acesso a pedidos de venda e ambientes — implementado pelo adapter Pontta. */
export interface SalesOrderPort {
  fetchEligibleOrders(asOf: string, query?: string): Promise<SalesOrderSummary[]>;
  fetchOrderItems(ponttaId: string, code: string): Promise<any[]>;
  fetchOrderTasks(ponttaId: string): Promise<Array<Record<string, unknown>>>;
}

export const SALES_ORDER_PORT = Symbol('SALES_ORDER_PORT');
