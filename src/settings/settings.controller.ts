import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { CreateSettingDto, UpdateSettingDto, BulkUpdateSettingsDto } from './dto/setting.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TabsGuard } from '../auth/guards/tabs.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Tabs } from '../auth/decorators/tabs.decorator';
import { UserRole } from '../users/entities/user.entity';

@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard, TabsGuard)
export class SettingsController {
    constructor(private readonly settingsService: SettingsService) { }

    @Post()
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    @Tabs('configuracoes')
    create(@Body() createSettingDto: CreateSettingDto) {
        return this.settingsService.create(createSettingDto);
    }

    @Get()
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    @Tabs('configuracoes')
    findAll() {
        return this.settingsService.getAllDecrypted();
    }

    @Get('tabs/navigation')
    @Roles(UserRole.MASTER, UserRole.ADMIN, UserRole.MANAGER, UserRole.USER)
    async getNavigationTabs(@Request() req: any) {
        return this.settingsService.getNavigationTabsForUser(req.user.sub, req.user?.role as UserRole);
    }

    @Get('category/:category')
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    @Tabs('configuracoes')
    findByCategory(@Param('category') category: string) {
        return this.settingsService.findByCategory(category);
    }

    @Get(':key')
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    @Tabs('configuracoes')
    async findOne(@Param('key') key: string) {
        const value = await this.settingsService.findByKey(key);
        return { key, value };
    }

    @Patch(':key')
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    @Tabs('configuracoes')
    update(@Param('key') key: string, @Body() updateSettingDto: UpdateSettingDto) {
        return this.settingsService.update(key, updateSettingDto);
    }

    @Post('bulk')
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    @Tabs('configuracoes')
    async bulkUpdate(@Body() bulkUpdateDto: BulkUpdateSettingsDto) {
        return this.settingsService.bulkUpsert(bulkUpdateDto.settings);
    }

    @Delete(':key')
    @Roles(UserRole.MASTER, UserRole.ADMIN)
    @Tabs('configuracoes')
    remove(@Param('key') key: string) {
        return this.settingsService.delete(key);
    }

    @Post('initialize')
    @Roles(UserRole.MASTER)
    @Tabs('configuracoes')
    async initialize() {
        await this.settingsService.initializeDefaults();
        return { message: 'Configurações inicializadas com sucesso' };
    }
}
