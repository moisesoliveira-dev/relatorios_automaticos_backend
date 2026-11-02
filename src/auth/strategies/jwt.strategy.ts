import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfigService } from '../../infrastructure/config/app-config.service';
import { JwtPayload } from '../auth.service';
import { UsersService } from '../../users/users.service';
import { UserStatus } from '../../users/entities/user.entity';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(appConfig: AppConfigService, private readonly usersService: UsersService) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: appConfig.jwtSecret,
        });
    }

    async validate(payload: JwtPayload) {
        // Revalida a cada request: usuário removido/desativado perde acesso na hora,
        // e o papel (role) vem sempre do banco, não do token.
        const user = await this.usersService.findOne(payload.sub).catch(() => null);
        if (!user || !user.isActive || user.status !== UserStatus.ACTIVE) {
            throw new UnauthorizedException();
        }
        return {
            sub: user.id,
            email: user.email,
            role: user.role,
        };
    }
}
