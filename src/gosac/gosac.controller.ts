import {
    Controller,
    Get,
    Post,
    Patch,
    Delete,
    Query,
    Param,
    Body,
    UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { GosacService } from './gosac.service';
import { CreateGosacGroupDto, UpdateGosacGroupDto } from './dto/gosac.dto';

@Controller('gosac')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.MASTER, UserRole.ADMIN)
export class GosacController {
    constructor(private readonly gosacService: GosacService) { }

    /**
     * GET /api/gosac/tickets/search?q=Anexo
     * Pesquisa tickets no GOSAC
     */
    @Get('tickets/search')
    async searchTickets(@Query('q') q: string) {
        if (!q || q.trim().length === 0) {
            return { tickets: [] };
        }
        const tickets = await this.gosacService.searchTickets(q);
        return { tickets };
    }

    /**
     * GET /api/gosac/groups
     * Lista todos os grupos cadastrados
     */
    @Get('groups')
    async findAllGroups() {
        return this.gosacService.findAllGroups();
    }

    /**
     * GET /api/gosac/groups/:id
     * Busca um grupo por ID
     */
    @Get('groups/:id')
    async findGroupById(@Param('id') id: string) {
        return this.gosacService.findGroupById(id);
    }

    /**
     * POST /api/gosac/groups
     * Cadastra uma associação grupo GOSAC ↔ Pontta
     */
    @Post('groups')
    async createGroup(@Body() dto: CreateGosacGroupDto) {
        return this.gosacService.createGroup(dto);
    }

    /**
     * PATCH /api/gosac/groups/:id
     * Atualiza um grupo
     */
    @Patch('groups/:id')
    async updateGroup(@Param('id') id: string, @Body() dto: UpdateGosacGroupDto) {
        return this.gosacService.updateGroup(id, dto);
    }

    /**
     * PATCH /api/gosac/groups/:id/toggle
     * Ativa/desativa um grupo
     */
    @Patch('groups/:id/toggle')
    async toggleGroup(@Param('id') id: string) {
        return this.gosacService.toggleGroup(id);
    }

    /**
     * DELETE /api/gosac/groups/:id
     * Remove um grupo
     */
    @Delete('groups/:id')
    async deleteGroup(@Param('id') id: string) {
        return this.gosacService.deleteGroup(id);
    }
}
