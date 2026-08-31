import { Injectable } from '@nestjs/common';
import { SettingsService } from '../../../settings/settings.service';
import {
  parseStoredOverrides,
  PcpEnvironmentOverrideItem,
  SavePcpEnvironmentOverrideInput,
  toOverrideList,
  toOverrideMap,
  upsertStoredOverride,
} from '../domain/pcp-environment-overrides';
import { PcpEnvironmentOverrides } from '../domain/environment-classifier';

const SETTINGS_KEY = 'PCP_ENVIRONMENT_OVERRIDES';

@Injectable()
export class PcpEnvironmentOverridesService {
  private cache: PcpEnvironmentOverrides | null = null;
  private listCache: PcpEnvironmentOverrideItem[] | null = null;

  constructor(private readonly settingsService: SettingsService) {}

  async getOverridesMap(): Promise<PcpEnvironmentOverrides> {
    if (this.cache) return this.cache;
    const raw = await this.settingsService.findByKey(SETTINGS_KEY);
    this.cache = toOverrideMap(parseStoredOverrides(raw));
    return this.cache;
  }

  async listOverrides(): Promise<PcpEnvironmentOverrideItem[]> {
    if (this.listCache) return this.listCache;
    const raw = await this.settingsService.findByKey(SETTINGS_KEY);
    this.listCache = toOverrideList(parseStoredOverrides(raw));
    return this.listCache;
  }

  async saveOverride(input: SavePcpEnvironmentOverrideInput): Promise<PcpEnvironmentOverrideItem[]> {
    const raw = await this.settingsService.findByKey(SETTINGS_KEY);
    const stored = upsertStoredOverride(parseStoredOverrides(raw), input);
    const payload = JSON.stringify(stored);

    if (raw === null) {
      await this.settingsService.create({
        key: SETTINGS_KEY,
        value: payload,
        category: 'pcp',
        description: 'Classificações manuais de ambientes do PCP Operacional',
        isEncrypted: false,
      });
    } else {
      await this.settingsService.update(SETTINGS_KEY, { value: payload });
    }

    this.clearCache();
    return this.listOverrides();
  }

  clearCache(): void {
    this.cache = null;
    this.listCache = null;
  }
}
