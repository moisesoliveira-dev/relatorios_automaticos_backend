import { PcpAreaKey } from './pcp.types';

export interface PcpAreaConfigItem {
  key: PcpAreaKey;
  label: string;
  short: string;
  businessDays: number;
  color: string;
}

export interface PcpAreaConfig {
  baseDateLabel: string;
  areas: PcpAreaConfigItem[];
}

export const DEFAULT_PCP_AREA_CONFIG: PcpAreaConfig = {
  baseDateLabel: 'Prazo calculado — Aprovação do Projeto Executivo',
  areas: [
    { key: 'molhada', label: 'Áreas Molhadas', short: 'Molhada', businessDays: 15, color: '#22c55e' },
    { key: 'intima', label: 'Áreas Íntimas', short: 'Íntima', businessDays: 22, color: '#eab308' },
    { key: 'social', label: 'Áreas Sociais', short: 'Social', businessDays: 29, color: '#3b82f6' },
  ],
};

export function pcpAreaKeys(config: PcpAreaConfig): PcpAreaKey[] {
  return config.areas.map((a) => a.key);
}

export function pcpBusinessDaysMap(config: PcpAreaConfig): Record<PcpAreaKey, number> {
  const map = {} as Record<PcpAreaKey, number>;
  for (const area of config.areas) {
    map[area.key] = area.businessDays;
  }
  return map;
}

export function pcpAreaConfigItem(config: PcpAreaConfig, key: PcpAreaKey): PcpAreaConfigItem {
  return config.areas.find((a) => a.key === key) ?? DEFAULT_PCP_AREA_CONFIG.areas.find((a) => a.key === key)!;
}

export function mergePcpAreaConfig(partial: Partial<PcpAreaConfig> | null | undefined): PcpAreaConfig {
  if (!partial?.areas?.length) {
    return structuredClone(DEFAULT_PCP_AREA_CONFIG);
  }

  const defaultsByKey = new Map(DEFAULT_PCP_AREA_CONFIG.areas.map((a) => [a.key, a]));

  return {
    baseDateLabel: partial.baseDateLabel?.trim() || DEFAULT_PCP_AREA_CONFIG.baseDateLabel,
    areas: partial.areas.map((area) => {
      const fallback = defaultsByKey.get(area.key);
      return {
        key: area.key,
        label: area.label?.trim() || fallback?.label || area.key,
        short: area.short?.trim() || fallback?.short || area.key,
        businessDays: Number.isFinite(area.businessDays) && area.businessDays >= 0 ? area.businessDays : fallback?.businessDays ?? 0,
        color: area.color?.trim() || fallback?.color || '#64748b',
      };
    }),
  };
}
