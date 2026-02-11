import { Injectable, ConflictException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { User, UserRole, UserStatus } from './entities/user.entity';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { EmailService } from '../email/email.service';

@Injectable()
export class UsersService {
    constructor(
        @InjectRepository(User)
        private usersRepository: Repository<User>,
        private emailService: EmailService,
    ) { }

    async create(createUserDto: CreateUserDto): Promise<User> {
        const existingUser = await this.findByEmail(createUserDto.email);
        if (existingUser) {
            throw new ConflictException('Email já está em uso');
        }

        const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

        const user = this.usersRepository.create({
            ...createUserDto,
            password: hashedPassword,
        });

        return this.usersRepository.save(user);
    }

    async createMaster(createUserDto: CreateUserDto): Promise<User> {
        // Verifica se já existe um master
        const masterExists = await this.hasMaster();
        if (masterExists) {
            throw new ConflictException('Já existe um usuário master no sistema');
        }

        const existingUser = await this.findByEmail(createUserDto.email);
        if (existingUser) {
            throw new ConflictException('Email já está em uso');
        }

        const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

        const user = this.usersRepository.create({
            ...createUserDto,
            password: hashedPassword,
            role: UserRole.MASTER,
            status: UserStatus.ACTIVE,
            isActive: true,
        });

        return this.usersRepository.save(user);
    }

    async hasMaster(): Promise<boolean> {
        const count = await this.usersRepository.count({
            where: { role: UserRole.MASTER }
        });
        return count > 0;
    }

    async getMaster(): Promise<User | null> {
        return this.usersRepository.findOne({
            where: { role: UserRole.MASTER }
        });
    }

    async createInvite(inviterUserId: string, email: string, role: UserRole = UserRole.USER): Promise<{ inviteToken: string; inviteCode: string; expiresAt: Date; user: User }> {
        // Verifica se o usuário que está convidando é master ou admin
        const inviter = await this.findOne(inviterUserId);
        if (inviter.role !== UserRole.MASTER && inviter.role !== UserRole.ADMIN) {
            throw new ForbiddenException('Apenas master ou admin podem convidar usuários');
        }

        // Não permite criar convite para master
        if (role === UserRole.MASTER) {
            throw new ForbiddenException('Não é possível convidar usuário como master');
        }

        // Verifica se o email já existe
        const existingUser = await this.findByEmail(email);
        if (existingUser) {
            throw new ConflictException('Este email já está cadastrado');
        }

        // Gera token de convite e código de 6 dígitos
        const inviteToken = crypto.randomBytes(32).toString('hex');
        const inviteCode = Math.floor(100000 + Math.random() * 900000).toString(); // 6 dígitos
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + 10); // Expira em 10 minutos

        // Cria usuário pendente
        const hashedToken = await bcrypt.hash(inviteToken, 10);
        const user = this.usersRepository.create({
            email,
            password: '', // Será definido no registro
            name: '',
            role: role,
            status: UserStatus.PENDING,
            isActive: false,
            invitedBy: inviterUserId,
            inviteToken: hashedToken,
            inviteCode: inviteCode, // Código de 6 dígitos
            inviteExpiresAt: expiresAt,
        });

        const savedUser = await this.usersRepository.save(user);

        // Envia email de convite
        const inviteLink = `${process.env.FRONTEND_URL || 'http://localhost:4200'}/register?token=${inviteToken}`;
        try {
            await this.emailService.sendEmail({
                to: email,
                subject: 'Convite para Sistema de Relatórios Automáticos',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #8B5CF6;">👋 Você foi convidado!</h2>
                        <p>Olá,</p>
                        <p><strong>${inviter.name}</strong> convidou você para fazer parte do Sistema de Relatórios Automáticos.</p>
                        <p>Seu perfil será: <strong>${role}</strong></p>
                        
                        <div style="background-color: #F3F4F6; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center;">
                            <p style="margin: 0; font-size: 14px; color: #64748B;">Seu código de convite é:</p>
                            <p style="font-size: 32px; font-weight: bold; color: #8B5CF6; letter-spacing: 8px; margin: 10px 0;">
                                ${inviteCode}
                            </p>
                            <p style="margin: 0; font-size: 12px; color: #64748B;">Guarde este código com segurança</p>
                        </div>

                        <p>Para completar seu cadastro:</p>
                        <ol style="line-height: 1.8;">
                            <li>Clique no botão abaixo</li>
                            <li>Insira o <strong>código de convite</strong> mostrado acima</li>
                            <li>Complete seu cadastro</li>
                        </ol>
                        
                        <p style="text-align: center; margin: 30px 0;">
                            <a href="${inviteLink}" style="display: inline-block; padding: 12px 24px; background-color: #8B5CF6; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">
                                Aceitar Convite
                            </a>
                        </p>
                        
                        <div style="background-color: #FEF3C7; padding: 15px; border-radius: 8px; border-left: 4px solid #F59E0B; margin: 20px 0;">
                            <p style="margin: 0; font-size: 14px; color: #92400E;">
                                <strong>⚠️ Importante:</strong> Este código expira em <strong>10 minutos</strong>
                            </p>
                        </div>
                        
                        <p style="color: #64748B; font-size: 12px; margin-top: 30px;">
                            Se você não esperava este convite, pode ignorar este email.
                        </p>
                        
                        <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;">
                        
                        <p style="font-size: 12px; color: #94A3B8;">
                            Atenciosamente,<br>
                            <strong>Sistema de Relatórios Automáticos</strong>
                        </p>
                    </div>
                `,
            });
            console.log('✅ Email de convite enviado para:', email, 'Código:', inviteCode);
        } catch (error) {
            console.error('❌ Erro ao enviar email de convite:', error);
            // Não falha o processo se o email não for enviado
        }

        return { inviteToken, inviteCode, expiresAt, user: savedUser };
    }

    async validateInviteCode(code: string): Promise<{ valid: boolean; email?: string; token?: string; message?: string }> {
        const user = await this.usersRepository.findOne({
            where: { inviteCode: code, status: UserStatus.PENDING }
        });

        if (!user) {
            return { valid: false, message: 'Código inválido ou já utilizado' };
        }

        if (user.inviteExpiresAt && user.inviteExpiresAt < new Date()) {
            return { valid: false, message: 'Código expirado (válido por 10 minutos)' };
        }

        // Gera um novo token temporário para o processo de registro
        const tempToken = crypto.randomBytes(32).toString('hex');

        return {
            valid: true,
            email: user.email,
            token: tempToken,
            message: 'Código válido'
        };
    }

    async completeRegistration(
        code: string,
        name: string,
        password: string
    ): Promise<User> {
        // Busca usuário pelo código de convite
        const user = await this.usersRepository.findOne({
            where: { inviteCode: code, status: UserStatus.PENDING }
        });

        if (!user) {
            throw new NotFoundException('Código de convite inválido ou já utilizado');
        }

        if (user.inviteExpiresAt && user.inviteExpiresAt < new Date()) {
            throw new ForbiddenException('Código de convite expirado (válido por 10 minutos)');
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        user.name = name;
        user.password = hashedPassword;
        user.status = UserStatus.ACTIVE;
        user.isActive = true;
        user.inviteToken = null;
        user.inviteCode = null;
        user.inviteExpiresAt = null;

        return this.usersRepository.save(user);
    }

    async findAll(): Promise<User[]> {
        return this.usersRepository.find({
            select: ['id', 'email', 'name', 'role', 'status', 'isActive', 'createdAt', 'lastLoginAt'],
            order: { createdAt: 'DESC' }
        });
    }

    async findOne(id: string): Promise<User> {
        const user = await this.usersRepository.findOne({ where: { id } });
        if (!user) {
            throw new NotFoundException('Usuário não encontrado');
        }
        return user;
    }

    async findByEmail(email: string): Promise<User | null> {
        return this.usersRepository.findOne({ where: { email } });
    }

    async update(id: string, updateUserDto: UpdateUserDto): Promise<User> {
        const user = await this.findOne(id);

        // Não permite alterar role do master
        if (user.role === UserRole.MASTER && updateUserDto.role && updateUserDto.role !== UserRole.MASTER) {
            throw new ForbiddenException('Não é possível alterar a role do usuário master');
        }

        if (updateUserDto.password) {
            updateUserDto.password = await bcrypt.hash(updateUserDto.password, 10);
        }

        Object.assign(user, updateUserDto);
        return this.usersRepository.save(user);
    }

    async updateLastLogin(id: string): Promise<void> {
        await this.usersRepository.update(id, { lastLoginAt: new Date() });
    }

    async remove(id: string): Promise<void> {
        const user = await this.findOne(id);

        // Não permite remover o master
        if (user.role === UserRole.MASTER) {
            throw new ForbiddenException('Não é possível remover o usuário master');
        }

        await this.usersRepository.remove(user);
    }

    async validatePassword(user: User, password: string): Promise<boolean> {
        return bcrypt.compare(password, user.password);
    }

    async getPendingInvites(): Promise<any[]> {
        const pendingUsers = await this.usersRepository.find({
            where: { status: UserStatus.PENDING },
            select: ['id', 'email', 'role', 'invitedBy', 'inviteToken', 'inviteExpiresAt', 'createdAt']
        });

        // Busca os dados do usuário que convidou
        const result = await Promise.all(pendingUsers.map(async (user) => {
            let inviter: { id: string; name: string; email: string } | null = null;
            if (user.invitedBy) {
                try {
                    const inviterUser = await this.findOne(user.invitedBy);
                    inviter = { id: inviterUser.id, name: inviterUser.name, email: inviterUser.email };
                } catch {
                    // Inviter não encontrado
                }
            }
            return {
                id: user.id,
                email: user.email,
                role: user.role,
                inviteToken: user.inviteToken,
                inviteExpiresAt: user.inviteExpiresAt,
                invitedBy: inviter,
                createdAt: user.createdAt
            };
        }));

        return result;
    }

    async cancelInvite(id: string): Promise<void> {
        const user = await this.findOne(id);
        if (user.status !== UserStatus.PENDING) {
            throw new ForbiddenException('Este usuário já completou o cadastro');
        }
        await this.usersRepository.remove(user);
    }

    async updateProfileName(userId: string, name: string): Promise<User> {
        const user = await this.findOne(userId);
        user.name = name;
        return this.usersRepository.save(user);
    }

    async updateProfilePassword(userId: string, currentPassword: string, newPassword: string): Promise<{ message: string }> {
        const user = await this.findOne(userId);

        const isPasswordValid = await this.validatePassword(user, currentPassword);
        if (!isPasswordValid) {
            throw new ForbiddenException('Senha atual incorreta');
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        user.password = hashedPassword;
        await this.usersRepository.save(user);

        return { message: 'Senha alterada com sucesso' };
    }
}
