import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { Setting } from './entities/setting.entity';
import { CreateSettingDto, UpdateSettingDto } from './dto/setting.dto';

@Injectable()
export class SettingsService {
    private readonly ENCRYPTION_KEY: Buffer;
    private readonly ALGORITHM = 'aes-256-cbc';

    // Chaves sensíveis que devem ser criptografadas
    private readonly SENSITIVE_KEYS = [
        'SMTP_PASSWORD',
        'DATABASE_PASSWORD',
        'JWT_SECRET',
        'API_KEY',
        'PONTTA_API_KEY',
        'PONTTA_PASSWORD',
        'ENCRYPTION_KEY'
    ];

    constructor(
        @InjectRepository(Setting)
        private settingsRepository: Repository<Setting>,
    ) {
        // Usa a chave de criptografia do ambiente ou gera uma padrão
        const encryptionKey = process.env.ENCRYPTION_KEY || 'default-encryption-key-change-in-production-32-chars';
        // Garante que a chave tenha 32 bytes
        this.ENCRYPTION_KEY = Buffer.from(encryptionKey.padEnd(32, '0').slice(0, 32));
    }

    private encrypt(text: string): string {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(this.ALGORITHM, this.ENCRYPTION_KEY, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return iv.toString('hex') + ':' + encrypted;
    }

    private decrypt(text: string): string {
        try {
            const parts = text.split(':');
            const iv = Buffer.from(parts[0], 'hex');
            const encryptedText = parts[1];
            const decipher = crypto.createDecipheriv(this.ALGORITHM, this.ENCRYPTION_KEY, iv);
            let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        } catch (error) {
            console.error('Erro ao descriptografar:', error);
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
            // Email - Configurações SMTP editáveis pela interface
            { key: 'SMTP_HOST', value: process.env.SMTP_HOST || 'smtp.gmail.com', category: 'email', description: 'Servidor SMTP' },
            { key: 'SMTP_PORT', value: process.env.SMTP_PORT || '587', category: 'email', description: 'Porta SMTP' },
            { key: 'SMTP_USER', value: process.env.SMTP_USER || '', category: 'email', description: 'Usuário SMTP' },
            { key: 'SMTP_PASSWORD', value: process.env.SMTP_PASS || '', category: 'email', description: 'Senha SMTP' },
            { key: 'SMTP_FROM', value: process.env.SMTP_FROM || '', category: 'email', description: 'Email remetente' },

            // Pontta API - Configurações da API Pontta
            { key: 'PONTTA_AUTH_URL', value: process.env.PONTTA_AUTH_URL || '', category: 'api', description: 'URL de Autenticação Pontta' },
            { key: 'PONTTA_API_URL', value: process.env.PONTTA_API_URL || '', category: 'api', description: 'URL da API Pontta' },
            { key: 'PONTTA_API_KEY', value: process.env.PONTTA_API_KEY || '', category: 'api', description: 'Chave da API Pontta' },
            { key: 'PONTTA_EMAIL', value: process.env.PONTTA_EMAIL || '', category: 'api', description: 'Email Pontta' },
            { key: 'PONTTA_PASSWORD', value: process.env.PONTTA_PASSWORD || '', category: 'api', description: 'Senha Pontta' },

            // Frontend
            { key: 'FRONTEND_URL', value: process.env.FRONTEND_URL || 'http://localhost:4200', category: 'general', description: 'URL do frontend' },

            // Jobs
            { key: 'JOB_ENABLED', value: 'true', category: 'jobs', description: 'Habilitar execução de jobs' },
            { key: 'JOB_MAX_RETRIES', value: '3', category: 'jobs', description: 'Máximo de tentativas' },
        ];

        for (const def of defaults) {
            const existing = await this.findByKey(def.key);
            if (existing === null) {
                await this.create(def);
            }
        }
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
