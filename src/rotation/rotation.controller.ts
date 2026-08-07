import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Param,
    Body,
    Query,
    UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { RotationService } from './rotation.service';
import { CreateRotationDto, UpdateRotationDto } from './dto/rotation.dto';

@Controller('rotation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.MASTER, UserRole.ADMIN)
export class RotationController {
    constructor(private readonly rotationService: RotationService) { }

    @Get()
    findAll() {
        return this.rotationService.findAll();
    }

    @Get('lookup/pontta-profiles')
    searchPonttaProfiles(@Query('query') query: string) {
        if (!query?.trim()) {
            return [];
        }
        return this.rotationService.searchPonttaProfiles(query.trim());
    }

    @Get('lookup/gosac-users')
    listGosacUsers() {
        return this.rotationService.listGosacUsers();
    }

    @Get('lookup/gosac-queues')
    listGosacQueues() {
        return this.rotationService.listGosacQueues();
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.rotationService.findOne(id);
    }

    @Post()
    create(@Body() dto: CreateRotationDto) {
        return this.rotationService.create(dto);
    }

    @Put(':id')
    update(@Param('id') id: string, @Body() dto: UpdateRotationDto) {
        return this.rotationService.update(id, dto);
    }

    @Delete(':id')
    async remove(@Param('id') id: string) {
        await this.rotationService.remove(id);
        return { success: true };
    }
}
