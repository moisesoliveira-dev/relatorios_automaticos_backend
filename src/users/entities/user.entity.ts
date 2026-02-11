import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    ManyToOne,
    JoinColumn,
} from 'typeorm';

export enum UserRole {
    MASTER = 'master',  // Primeiro usuário - não pode ser removido
    ADMIN = 'admin',
    USER = 'user',
    MANAGER = 'manager',
}

export enum UserStatus {
    PENDING = 'pending',   // Aguardando aprovação
    ACTIVE = 'active',     // Ativo
    INACTIVE = 'inactive', // Desativado
}

@Entity('users')
export class User {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ unique: true })
    email: string;

    @Column()
    password: string;

    @Column()
    name: string;

    @Column({ type: 'enum', enum: UserRole, default: UserRole.USER })
    role: UserRole;

    @Column({ type: 'enum', enum: UserStatus, default: UserStatus.PENDING })
    status: UserStatus;

    @Column({ default: true })
    isActive: boolean;

    @Column({ nullable: true })
    avatarUrl: string;

    @Column({ type: 'varchar', nullable: true })
    invitedBy: string | null; // ID do usuário que convidou

    @Column({ type: 'varchar', nullable: true })
    inviteToken: string | null; // Token para convite

    @Column({ type: 'varchar', length: 6, nullable: true })
    inviteCode: string | null; // Código de 6 dígitos para ativar convite

    @Column({ type: 'timestamp', nullable: true })
    inviteExpiresAt: Date | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @Column({ type: 'timestamp', nullable: true })
    lastLoginAt: Date;
}
