import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { CreateSettingDto, UpdateSettingDto, BulkUpdateSettingsDto } from './dto/setting.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';

@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SettingsController {
    constructor(private readonly settingsService: SettingsService) { }

    @Post()
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    create(@Body() createSettingDto: CreateSettingDto) {
        return this.settingsService.create(createSettingDto);
    }

    @Get()
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    findAll() {
        return this.settingsService.getAllDecrypted();
    }

    @Get('category/:category')
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    findByCategory(@Param('category') category: string) {
        return this.settingsService.findByCategory(category);
    }

    @Get(':key')
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    async findOne(@Param('key') key: string) {
        const value = await this.settingsService.findByKey(key);
        return { key, value };
    }

    @Patch(':key')
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    update(@Param('key') key: string, @Body() updateSettingDto: UpdateSettingDto) {
        return this.settingsService.update(key, updateSettingDto);
    }

    @Post('bulk')
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    async bulkUpdate(@Body() bulkUpdateDto: BulkUpdateSettingsDto) {
        return this.settingsService.bulkUpsert(bulkUpdateDto.settings);
    }

    @Delete(':key')
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    remove(@Param('key') key: string) {
        return this.settingsService.delete(key);
    }

    @Post('initialize')
    @Roles(UserRole.MASTER)
    async initialize() {
        await this.settingsService.initializeDefaults();
        return { message: 'Configurações inicializadas com sucesso' };
    }
}
