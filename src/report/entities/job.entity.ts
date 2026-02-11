import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('scheduled_jobs')
export class ScheduledJob {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    name: string;

    @Column({ type: 'enum', enum: ['occurrences', 'monthly', 'custom'] })
    reportType: 'occurrences' | 'monthly' | 'custom';

    @Column({ type: 'enum', enum: ['daily', 'weekly', 'monthly'] })
    frequency: 'daily' | 'weekly' | 'monthly';

    @Column({ type: 'time' })
    time: string; // HH:mm format

    @Column({ type: 'int', nullable: true })
    dayOfWeek: number; // 0-6 (domingo-sábado) para weekly

    @Column({ type: 'int', nullable: true })
    dayOfMonth: number; // 1-31 para monthly

    @Column({ type: 'boolean', default: true })
    isActive: boolean;

    @Column({ type: 'jsonb', nullable: true })
    filters: {
        limit?: number;
        startDate?: string;
        endDate?: string;
    };

    @Column({ type: 'enum', enum: ['excel', 'csv'], default: 'excel' })
    format: 'excel' | 'csv';

    @Column({ type: 'boolean', default: true })
    sendToFixedEmails: boolean; // Se deve enviar para emails fixos cadastrados

    @Column({ type: 'timestamp', nullable: true })
    lastRun: Date;

    @Column({ type: 'timestamp', nullable: true })
    nextRun: Date;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
