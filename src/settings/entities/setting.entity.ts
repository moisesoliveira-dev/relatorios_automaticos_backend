import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('settings')
export class Setting {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ unique: true })
    key: string;

    @Column({ type: 'text' })
    value: string;

    @Column({ default: false })
    isEncrypted: boolean;

    @Column({ nullable: true })
    description: string;

    @Column({ default: 'general' })
    category: string; // 'general', 'email', 'database', 'api'

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
