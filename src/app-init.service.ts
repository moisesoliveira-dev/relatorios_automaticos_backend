import { Injectable, OnModuleInit } from '@nestjs/common';
import { SettingsService } from './settings/settings.service';

@Injectable()
export class AppInitService implements OnModuleInit {
    constructor(private settingsService: SettingsService) { }

    async onModuleInit() {
        try {
            console.log('🔧 Inicializando configurações padrão...');
            await this.settingsService.initializeDefaults();
            console.log('✅ Configurações inicializadas com sucesso');
        } catch (error) {
            console.error('❌ Erro ao inicializar configurações:', error);
        }
    }
}
