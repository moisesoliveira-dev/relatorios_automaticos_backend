import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    OneToMany,
    ManyToOne,
    JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum ReportType {
    OCCURRENCES = 'occurrences',
    MONTHLY = 'monthly',
    CUSTOM = 'custom',
}

export enum ReportStatus {
    PENDING = 'pending',
    PROCESSING = 'processing',
    SUCCESS = 'success',
    FAILED = 'failed',
}

@Entity('reports')
export class Report {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    name: string;

    @Column({ type: 'varchar', nullable: true })
    description: string | null;

    @Column({ type: 'enum', enum: ReportType, default: ReportType.OCCURRENCES })
    type: ReportType;

    @Column({ type: 'enum', enum: ReportStatus, default: ReportStatus.PENDING })
    status: ReportStatus;

    @Column({ type: 'int', default: 0 })
    totalRecords: number;

    @Column({ type: 'varchar', nullable: true })
    filePath: string | null; // Caminho do arquivo gerado (se salvou)

    @Column({ type: 'jsonb', nullable: true })
    filters: {
        status?: string;
        limit?: number;
        startDate?: string;
        endDate?: string;
    } | null;

    @Column({ type: 'varchar', nullable: true })
    errorMessage: string | null;

    @Column({ type: 'varchar' })
    createdById: string;

    @ManyToOne(() => User, { nullable: true })
    @JoinColumn({ name: 'createdById' })
    createdBy: User;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @Column({ type: 'timestamp', nullable: true })
    completedAt: Date | null;
}

@Entity('report_emails')
export class ReportEmail {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    email: string;

    @Column({ type: 'varchar', nullable: true })
    name: string | null;

    @Column({ type: 'varchar' })
    reportType: string; // Tipo de relatório que este email recebe

    @Column({ default: true })
    isActive: boolean;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}

@Entity('report_executions')
export class ReportExecution {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', nullable: true })
    reportId: string | null;

    @ManyToOne(() => Report, { onDelete: 'CASCADE', nullable: true })
    @JoinColumn({ name: 'reportId' })
    report: Report | null;

    @Column({ type: 'enum', enum: ReportStatus, default: ReportStatus.PENDING })
    status: ReportStatus;

    @Column({ type: 'int', default: 0 })
    recordsProcessed: number;

    @Column({ type: 'simple-array', nullable: true })
    emailsSentTo: string[];

    @Column({ type: 'varchar', nullable: true })
    errorMessage: string | null;

    @Column({ type: 'varchar', nullable: true })
    executedById: string | null;

    @ManyToOne(() => User, { nullable: true })
    @JoinColumn({ name: 'executedById' })
    executedBy: User | null;

    @CreateDateColumn()
    executedAt: Date;

    @Column({ type: 'timestamp', nullable: true })
    completedAt: Date | null;

    @Column({ type: 'int', nullable: true })
    durationMs: number | null;
}
