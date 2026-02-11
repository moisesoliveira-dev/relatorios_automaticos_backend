import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { LoginDto, CreateMasterDto, CompleteRegistrationDto } from '../users/dto/user.dto';
import { User, UserStatus } from '../users/entities/user.entity';

export interface JwtPayload {
    sub: string;
    email: string;
    role: string;
}

export interface AuthResponse {
    access_token: string;
    user: {
        id: string;
        email: string;
        name: string;
        role: string;
        avatarUrl: string | null;
    };
}

@Injectable()
export class AuthService {
    constructor(
        private usersService: UsersService,
        private jwtService: JwtService,
    ) { }

    async validateUser(email: string, password: string): Promise<User | null> {
        const user = await this.usersService.findByEmail(email);
        if (user && await this.usersService.validatePassword(user, password)) {
            return user;
        }
        return null;
    }

    async login(loginDto: LoginDto): Promise<AuthResponse> {
        const user = await this.validateUser(loginDto.email, loginDto.password);

        if (!user) {
            throw new UnauthorizedException('Credenciais inválidas');
        }

        if (!user.isActive || user.status !== UserStatus.ACTIVE) {
            throw new UnauthorizedException('Usuário desativado ou pendente de aprovação');
        }

        await this.usersService.updateLastLogin(user.id);

        const payload: JwtPayload = {
            sub: user.id,
            email: user.email,
            role: user.role,
        };

        return {
            access_token: this.jwtService.sign(payload),
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                avatarUrl: user.avatarUrl,
            },
        };
    }

    async checkMasterExists(): Promise<{ hasMaster: boolean }> {
        const hasMaster = await this.usersService.hasMaster();
        return { hasMaster };
    }

    async registerMaster(createMasterDto: CreateMasterDto): Promise<AuthResponse> {
        const user = await this.usersService.createMaster(createMasterDto);

        const payload: JwtPayload = {
            sub: user.id,
            email: user.email,
            role: user.role,
        };

        return {
            access_token: this.jwtService.sign(payload),
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                avatarUrl: user.avatarUrl,
            },
        };
    }

    async validateInviteCode(code: string) {
        return this.usersService.validateInviteCode(code);
    }

    async completeRegistration(dto: CompleteRegistrationDto): Promise<AuthResponse> {
        const user = await this.usersService.completeRegistration(
            dto.code,
            dto.name,
            dto.password
        );

        const payload: JwtPayload = {
            sub: user.id,
            email: user.email,
            role: user.role,
        };

        return {
            access_token: this.jwtService.sign(payload),
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                avatarUrl: user.avatarUrl,
            },
        };
    }

    async validateToken(token: string): Promise<JwtPayload | null> {
        try {
            return this.jwtService.verify<JwtPayload>(token);
        } catch {
            return null;
        }
    }

    async getProfile(userId: string) {
        const user = await this.usersService.findOne(userId);
        return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            avatarUrl: user.avatarUrl,
            createdAt: user.createdAt,
            lastLoginAt: user.lastLoginAt,
        };
    }
}
