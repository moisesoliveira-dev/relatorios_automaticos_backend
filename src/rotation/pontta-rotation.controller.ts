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
import { TabsGuard } from '../auth/guards/tabs.guard';
import { Tabs } from '../auth/decorators/tabs.decorator';
import { PonttaRotationService } from './pontta-rotation.service';
import {
    CreatePonttaRotationDto,
    UpdateAssignByPcpAreaDto,
    UpdatePonttaRotationDto,
} from './dto/pontta-rotation.dto';

@Controller('pontta-rotation')
@UseGuards(JwtAuthGuard, TabsGuard)
@Tabs('gosac-pontta/rodizio-pontta')
export class PonttaRotationController {
    constructor(private readonly ponttaRotationService: PonttaRotationService) { }

    @Get()
    findAll() {
        return this.ponttaRotationService.findAll();
    }

    @Get('settings/assign-by-pcp-area')
    getAssignByPcpArea() {
        return this.ponttaRotationService.getAssignByPcpAreaEnabled();
    }

    @Put('settings/assign-by-pcp-area')
    setAssignByPcpArea(@Body() body: UpdateAssignByPcpAreaDto) {
        return this.ponttaRotationService.setAssignByPcpAreaEnabled(!!body.enabled);
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
