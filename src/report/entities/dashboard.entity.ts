import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
} from 'typeorm';

export enum DashboardMetricType {
    REPORTS_GENERATED = 'reports_generated',
    EMAILS_SENT = 'emails_sent',
    OCCURRENCES_FETCHED = 'occurrences_fetched',
    ACTIVE_USERS = 'active_users',
}

@Entity('dashboard_metrics')
export class DashboardMetric {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar' })
    metricType: string;

    @Column({ type: 'int', default: 0 })
    value: number;

    @Column({ type: 'int', default: 0 })
    previousValue: number; // Valor do período anterior para calcular trend

    @Column({ type: 'varchar' })
    period: string; // '2026-01' para mensal, '2026-01-31' para diário

    @CreateDateColumn()
    recordedAt: Date;
}

@Entity('system_logs')
export class SystemLog {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar' })
    service: string; // 'api_backend', 'database', 'api_pontta', 'email_server'

    @Column({ type: 'varchar' })
    status: string; // 'online', 'warning', 'offline'

    @Column({ type: 'int', nullable: true })
    latencyMs: number | null;

    @Column({ type: 'varchar', nullable: true })
    message: string | null;

    @CreateDateColumn()
    checkedAt: Date;
}
