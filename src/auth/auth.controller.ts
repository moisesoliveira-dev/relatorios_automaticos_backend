import { Controller, Post, Body, Get, UseGuards, Request } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto, CreateMasterDto, CompleteRegistrationDto } from '../users/dto/user.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
    constructor(private authService: AuthService) { }

    @Post('login')
    async login(@Body() loginDto: LoginDto) {
        return this.authService.login(loginDto);
    }

    @Get('check-master')
    async checkMaster() {
        return this.authService.checkMasterExists();
    }

    @Post('register-master')
    async registerMaster(@Body() createMasterDto: CreateMasterDto) {
        return this.authService.registerMaster(createMasterDto);
    }

    @Post('validate-invite-code')
    async validateInviteCode(@Body() body: { code: string }) {
        return this.authService.validateInviteCode(body.code);
    }

    @Post('complete-registration')
    async completeRegistration(@Body() dto: CompleteRegistrationDto) {
        return this.authService.completeRegistration(dto);
    }

    @UseGuards(JwtAuthGuard)
    @Get('profile')
    async getProfile(@Request() req: any) {
        return this.authService.getProfile(req.user.sub);
    }

    @UseGuards(JwtAuthGuard)
    @Get('validate')
    async validateToken(@Request() req: any) {
        return {
            valid: true,
            user: req.user,
        };
    }
}
