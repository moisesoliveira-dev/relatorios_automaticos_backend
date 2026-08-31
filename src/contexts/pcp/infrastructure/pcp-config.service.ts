import { Injectable } from '@nestjs/common';
import { SettingsService } from '../../../settings/settings.service';
import {
  DEFAULT_PCP_AREA_CONFIG,
  mergePcpAreaConfig,
  PcpAreaConfig,
} from '../domain/pcp-area-config';

const SETTINGS_KEY = 'PCP_AREA_CONFIG';

@Injectable()
export class PcpConfigService {
  private cache: PcpAreaConfig | null = null;

  constructor(private readonly settingsService: SettingsService) {}

  async getConfig(): Promise<PcpAreaConfig> {
    if (this.cache) return this.cache;

    const raw = await this.settingsService.findByKey(SETTINGS_KEY);
    if (!raw) {
      this.cache = structuredClone(DEFAULT_PCP_AREA_CONFIG);
      return this.cache;
    }

    try {
      this.cache = mergePcpAreaConfig(JSON.parse(raw));
      return this.cache;
    } catch {
      this.cache = structuredClone(DEFAULT_PCP_AREA_CONFIG);
      return this.cache;
    }
  }

  async saveConfig(config: PcpAreaConfig): Promise<PcpAreaConfig> {
    const merged = mergePcpAreaConfig(config);
    const existing = await this.settingsService.findByKey(SETTINGS_KEY);

    if (existing === null) {
      await this.settingsService.create({
        key: SETTINGS_KEY,
        value: JSON.stringify(merged),
        category: 'pcp',
        description: 'Dias úteis e cores por área do PCP Operacional',
        isEncrypted: false,
      });
    } else {
      await this.settingsService.update(SETTINGS_KEY, { value: JSON.stringify(merged) });
    }

    this.cache = merged;
    return merged;
  }

  clearCache(): void {
    this.cache = null;
  }
}
