import {
    Controller,
    Get,
    Post,
    Body,
    Patch,
    Param,
    Delete,
    UseGuards,
    Request,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto, InviteUserDto, ApproveRegistrationDto } from './dto/user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TabsGuard } from '../auth/guards/tabs.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Tabs } from '../auth/decorators/tabs.decorator';
import { UserRole } from './entities/user.entity';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard, TabsGuard)
export class UsersController {
    constructor(private readonly usersService: UsersService) { }

    @Post()
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    @Tabs('usuarios')
    create(@Body() createUserDto: CreateUserDto) {
        return this.usersService.create(createUserDto);
    }

    @Post('invite')
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    @Tabs('usuarios')
    async inviteUser(@Request() req: any, @Body() inviteDto: InviteUserDto) {
        const result = await this.usersService.createInvite(req.user.sub, inviteDto.email, inviteDto.tabs);
        const inviteLink = `${result.frontendUrl}/invite`;
        return {
            message: result.emailSent
                ? 'Convite criado com sucesso. Email enviado!'
                : 'Convite criado. Email não foi entregue — compartilhe o código manualmente.',
            user: {
                id: result.user.id,
                email: result.user.email,
                role: result.user.role,
                tabs: result.user.tabs,
            },
            inviteCode: result.inviteCode,
            inviteLink,
            expiresAt: result.expiresAt,
            emailSent: result.emailSent,
            emailError: result.emailError,
        };
    }

    @Get('registrations/pending')
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    @Tabs('usuarios')
    getPendingRegistrations() {
        return this.usersService.getSelfRegisteredPending();
    }

    @Post('registrations/:id/approve')
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    @Tabs('usuarios')
    approveRegistration(@Param('id') id: string, @Body() body: ApproveRegistrationDto) {
        return this.usersService.approveRegistration(id, body.tabs);
    }

    @Delete('registrations/:id')
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    @Tabs('usuarios')
    rejectRegistration(@Param('id') id: string) {
        return this.usersService.rejectRegistration(id);
    }

    @Get('invites/pending')
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    @Tabs('usuarios')
    getPendingInvites() {
        return this.usersService.getPendingInvites();
    }

    @Delete('invites/:id')
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    @Tabs('usuarios')
    cancelInvite(@Param('id') id: string) {
        return this.usersService.cancelInvite(id);
    }

    @Get()
    @Roles(UserRole.MASTER, UserRole.ADMIN, UserRole.MANAGER)
    @Tabs('usuarios')
    findAll() {
        return this.usersService.findAll();
    }

    @Get(':id')
    @Tabs('usuarios')
    findOne(@Param('id') id: string) {
        return this.usersService.findOne(id);
    }

    @Patch(':id')
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    @Tabs('usuarios')
    update(@Request() req: any, @Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
        return this.usersService.update(id, updateUserDto, req.user);
    }

    @Delete(':id')
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    @Tabs('usuarios')
    remove(@Param('id') id: string) {
        return this.usersService.remove(id);
    }

    @Patch('profile/name')
    updateProfileName(@Request() req: any, @Body() body: { name: string }) {
        return this.usersService.updateProfileName(req.user.sub, body.name);
    }

    @Patch('profile/password')
    updateProfilePassword(@Request() req: any, @Body() body: { currentPassword: string; newPassword: string }) {
        return this.usersService.updateProfilePassword(req.user.sub, body.currentPassword, body.newPassword);
    }
}
