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
import { CreateUserDto, UpdateUserDto, InviteUserDto } from './dto/user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from './entities/user.entity';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
    constructor(private readonly usersService: UsersService) { }

    @Post()
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    create(@Body() createUserDto: CreateUserDto) {
        return this.usersService.create(createUserDto);
    }

    @Post('invite')
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    async inviteUser(@Request() req: any, @Body() inviteDto: InviteUserDto) {
        const result = await this.usersService.createInvite(req.user.sub, inviteDto.email, inviteDto.role);
        const inviteLink = `http://localhost:4200/invite`;
        return {
            message: 'Convite criado com sucesso. Código enviado por email.',
            user: {
                id: result.user.id,
                email: result.user.email,
                role: result.user.role,
            },
            inviteCode: result.inviteCode,
            inviteLink,
            expiresAt: result.expiresAt,
        };
    }

    @Get('invites/pending')
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    getPendingInvites() {
        return this.usersService.getPendingInvites();
    }

    @Delete('invites/:id')
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    cancelInvite(@Param('id') id: string) {
        return this.usersService.cancelInvite(id);
    }

    @Get()
    @Roles(UserRole.MASTER, UserRole.ADMIN, UserRole.MANAGER)
    findAll() {
        return this.usersService.findAll();
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.usersService.findOne(id);
    }

    @Patch(':id')
    update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
        return this.usersService.update(id, updateUserDto);
    }

    @Delete(':id')
    @Roles(UserRole.MASTER, UserRole.ADMIN)
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
