import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CryptoKeys, decryptStrict, deriveKeys, encryptV2 } from './settings-crypto';
import { Setting } from './entities/setting.entity';
import { CreateSettingDto, UpdateSettingDto } from './dto/setting.dto';
import { User, UserRole } from '../users/entities/user.entity';
import { MASTER_TABS, normalizeTabs } from '../users/tabs.constants';
import { AppConfigService } from '../infrastructure/config/app-config.service';

@Injectable()
export class SettingsService {

    // Chaves sensíveis que devem ser criptografadas
    private readonly SENSITIVE_KEYS = [
        'SMTP_PASSWORD',
        'DATABASE_PASSWORD',
        'JWT_SECRET',
        'API_KEY',
        'ENCRYPTION_KEY',
        'GOOGLE_CLIENT_SECRET',
        'GOOGLE_REFRESH_TOKEN',
    ];

    constructor(
        @InjectRepository(Setting)
        private settingsRepository: Repository<Setting>,
        @InjectRepository(User)
        private usersRepository: Repository<User>,
        private readonly appConfig: AppConfigService,
    ) { }

    private get keys(): CryptoKeys {
        if (!this._keys) this._keys = deriveKeys(this.appConfig.encryptionKey);
        return this._keys;
    }
    private _keys?: CryptoKeys;

    private encrypt(text: string): string {
        return encryptV2(text, this.keys);
    }

    /** Lê o formato novo (v2/GCM) e também o legado (CBC), para não perder valores já salvos. */
    private decrypt(text: string): string {
        try {
            return decryptStrict(text, this.keys);
        } catch {
            console.error('Erro ao descriptografar uma configuração (chave incorreta ou valor corrompido)');
            return text; // Retorna o valor original se falhar
        }
    }

    private isSensitiveKey(key: string): boolean {
        return this.SENSITIVE_KEYS.some(sensitiveKey => key.includes(sensitiveKey));
    }

    async create(createSettingDto: CreateSettingDto): Promise<Setting> {
        const isEncrypted = createSettingDto.isEncrypted ?? this.isSensitiveKey(createSettingDto.key);

        const setting = this.settingsRepository.create({
            ...createSettingDto,
            isEncrypted,
            value: isEncrypted ? this.encrypt(createSettingDto.value) : createSettingDto.value,
        });

        return this.settingsRepository.save(setting);
    }

    async findAll(): Promise<Setting[]> {
        return this.settingsRepository.find({
            order: { category: 'ASC', key: 'ASC' }
        });
    }

    async findByKey(key: string): Promise<string | null> {
        const setting = await this.settingsRepository.findOne({ where: { key } });
        if (!setting) return null;

        return setting.isEncrypted ? this.decrypt(setting.value) : setting.value;
    }

    async findByCategory(category: string): Promise<Setting[]> {
        return this.settingsRepository.find({
            where: { category },
            order: { key: 'ASC' }
        });
    }

    async update(key: string, updateSettingDto: UpdateSettingDto): Promise<Setting> {
        const setting = await this.settingsRepository.findOne({ where: { key } });

        if (!setting) {
            throw new Error('Setting not found');
        }

        if (updateSettingDto.value !== undefined) {
            setting.value = setting.isEncrypted ? this.encrypt(updateSettingDto.value) : updateSettingDto.value;
        }

        if (updateSettingDto.description !== undefined) {
            setting.description = updateSettingDto.description;
        }

        return this.settingsRepository.save(setting);
    }

    async upsert(key: string, value: string, category: string = 'general', description?: string): Promise<Setting> {
        const existing = await this.settingsRepository.findOne({ where: { key } });

        if (existing) {
            return this.update(key, { value, description });
        }

        return this.create({ key, value, category, description });
    }

    async bulkUpsert(settings: { key: string; value: string; category?: string; description?: string }[]): Promise<Setting[]> {
        const results: Setting[] = [];

        for (const setting of settings) {
            const result = await this.upsert(
                setting.key,
                setting.value,
                setting.category || 'general',
                setting.description
            );
            results.push(result);
        }

        return results;
    }

    async delete(key: string): Promise<void> {
        await this.settingsRepository.delete({ key });
    }

    // Retorna as configurações com valores descriptografados para exibição
    async getAllDecrypted(): Promise<Array<{ key: string; value: string; isEncrypted: boolean; description: string; category: string }>> {
        const settings = await this.findAll();

        return settings.map(setting => ({
            key: setting.key,
            value: setting.isEncrypted ? this.decrypt(setting.value) : setting.value,
            isEncrypted: setting.isEncrypted,
            description: setting.description,
            category: setting.category,
        }));
    }

    // Inicializa configurações padrão se não existirem
    // NOTA: Variáveis de banco de dados (DB_*) e JWT_SECRET não são persistidas
    // por questões de segurança - devem permanecer apenas no .env
    async initializeDefaults(): Promise<void> {
        const defaults = [
            // Email - Configurações editáveis pela interface
            { key: 'EMAIL_PROVIDER', value: 'smtp', category: 'email', description: 'Provedor de email (smtp ou resend)' },
            { key: 'SMTP_HOST', value: process.env.SMTP_HOST || 'smtp.gmail.com', category: 'email', description: 'Servidor SMTP' },
            { key: 'SMTP_PORT', value: process.env.SMTP_PORT || '587', category: 'email', description: 'Porta SMTP' },
            { key: 'SMTP_USER', value: process.env.SMTP_USER || '', category: 'email', description: 'Usuário SMTP' },
            { key: 'SMTP_PASSWORD', value: process.env.SMTP_PASS || '', category: 'email', description: 'Senha SMTP' },
            { key: 'SMTP_FROM', value: process.env.SMTP_FROM || '', category: 'email', description: 'Email remetente (ex: Nome <email@dominio.com>)' },
            { key: 'RESEND_API_KEY', value: process.env.RESEND_API_KEY || '', category: 'email', description: 'Chave da API Resend (necessária se provedor = resend)' },

            // Frontend
            { key: 'FRONTEND_URL', value: process.env.FRONTEND_URL || 'http://localhost:4200', category: 'general', description: 'URL do frontend' },

            // Controle de abas por perfil (persistido no banco)
            { key: 'TABS_MASTER', value: 'rodizio,ia,usuarios,configuracoes', category: 'access', description: 'Abas visíveis para perfil master' },
            { key: 'TABS_ADMIN', value: 'rodizio,ia,usuarios', category: 'access', description: 'Abas visíveis para perfil admin' },
            { key: 'TABS_MANAGER', value: 'rodizio,ia', category: 'access', description: 'Abas visíveis para perfil manager' },
            { key: 'TABS_USER', value: 'ia', category: 'access', description: 'Abas visíveis para perfil user' },

            // Google Drive
            { key: 'GOOGLE_DRIVE_ENABLED', value: 'false', category: 'drive', description: 'Habilitar integração com Google Drive' },
            { key: 'GOOGLE_CLIENT_ID', value: process.env.GOOGLE_CLIENT_ID || '', category: 'drive', description: 'Client ID do Google OAuth2' },
            { key: 'GOOGLE_CLIENT_SECRET', value: process.env.GOOGLE_CLIENT_SECRET || '', category: 'drive', description: 'Client Secret do Google OAuth2' },
            { key: 'GOOGLE_REFRESH_TOKEN', value: process.env.GOOGLE_REFRESH_TOKEN || '', category: 'drive', description: 'Refresh Token do Google OAuth2' },
            { key: 'GOOGLE_DRIVE_FOLDER_ID', value: '', category: 'drive', description: 'ID da pasta raiz no Google Drive' },
        ];

        for (const def of defaults) {
            const existing = await this.findByKey(def.key);
            if (existing === null) {
                await this.create(def);
            }
        }

        // Limpeza de chaves legadas da abordagem com Service Account
        await this.delete('GOOGLE_SERVICE_ACCOUNT_EMAIL');
        await this.delete('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY');
    }

    private getRoleTabsKey(role: UserRole): string {
        switch (role) {
            case UserRole.MASTER:
                return 'TABS_MASTER';
            case UserRole.ADMIN:
                return 'TABS_ADMIN';
            case UserRole.MANAGER:
                return 'TABS_MANAGER';
            case UserRole.USER:
            default:
                return 'TABS_USER';
        }
    }

    async getTabsForRole(role: UserRole): Promise<string[]> {
        const key = this.getRoleTabsKey(role);
        const raw = await this.findByKey(key);
        if (!raw) return [];

        return raw
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    }

    async getNavigationTabsForUser(userId: string, jwtRole?: UserRole): Promise<{ role: UserRole; tabs: string[] }> {
        const user = await this.usersRepository.findOne({ where: { id: userId } });
        const role = (user?.role || jwtRole || UserRole.USER) as UserRole;

        if (role === UserRole.MASTER) {
            return { role, tabs: [...MASTER_TABS] };
        }

        if (user?.tabs?.length) {
            return { role, tabs: normalizeTabs(user.tabs) };
        }

        return { role, tabs: await this.getTabsForRole(role) };
    }

    // Retorna configurações SMTP para o EmailService
    async getSmtpConfig(): Promise<{
        host: string;
        port: number;
        user: string;
        password: string;
        from: string;
    }> {
        return {
            host: await this.findByKey('SMTP_HOST') || 'smtp.gmail.com',
            port: parseInt(await this.findByKey('SMTP_PORT') || '587'),
            user: await this.findByKey('SMTP_USER') || '',
            password: await this.findByKey('SMTP_PASSWORD') || '',
            from: await this.findByKey('SMTP_FROM') || '',
        };
    }
}
