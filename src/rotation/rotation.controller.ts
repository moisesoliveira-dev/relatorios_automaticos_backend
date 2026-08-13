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
import { TabsGuard } from '../auth/guards/tabs.guard';
import { Tabs } from '../auth/decorators/tabs.decorator';
import { RotationService } from './rotation.service';
import { CreateRotationDto, UpdateRotationDto } from './dto/rotation.dto';

@Controller('rotation')
@UseGuards(JwtAuthGuard, TabsGuard)
@Tabs('gosac-pontta/rodizio')
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
