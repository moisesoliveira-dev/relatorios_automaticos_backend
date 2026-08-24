import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AppConfigService } from '../infrastructure/config/app-config.service';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UsersModule } from '../users/users.module';

@Module({
    imports: [
        UsersModule,
        PassportModule,
        JwtModule.registerAsync({
            useFactory: (appConfig: AppConfigService) => ({
                secret: appConfig.jwtSecret,
                signOptions: {
                    expiresIn: appConfig.jwtExpiresIn as `${number}${'s' | 'm' | 'h' | 'd'}`,
                },
            }),
            inject: [AppConfigService],
        }),
    ],
    controllers: [AuthController],
    providers: [AuthService, JwtStrategy],
    exports: [AuthService],
})
export class AuthModule { }
