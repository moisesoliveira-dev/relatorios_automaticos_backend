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
    ParseIntPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { PonttaRotationService } from './pontta-rotation.service';
import { CreatePonttaRotationDto, UpdatePonttaRotationDto } from './dto/pontta-rotation.dto';

@Controller('pontta-rotation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.MASTER, UserRole.ADMIN)
export class PonttaRotationController {
    constructor(private readonly ponttaRotationService: PonttaRotationService) { }

    @Get()
    findAll() {
        return this.ponttaRotationService.findAll();
    }

    @Get('lookup/pontta-profiles')
    searchPonttaProfiles(@Query('query') query: string) {
        if (!query?.trim()) {
            return [];
        }
        return this.ponttaRotationService.searchPonttaProfiles(query.trim());
    }

    @Get(':id')
    findOne(@Param('id', ParseIntPipe) id: number) {
        return this.ponttaRotationService.findOne(id);
    }

    @Post()
    create(@Body() dto: CreatePonttaRotationDto) {
        return this.ponttaRotationService.create(dto);
    }

    @Put(':id')
    update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePonttaRotationDto) {
        return this.ponttaRotationService.update(id, dto);
    }

    @Delete(':id')
    async remove(@Param('id', ParseIntPipe) id: number) {
        await this.ponttaRotationService.remove(id);
        return { success: true };
    }
}
