import { PcpAreaKey } from './pcp.types';
import { normalizeEnvironmentKey } from './environment-classifier';

export interface PcpEnvironmentOverrideItem {
  key: string;
  label: string;
  area: PcpAreaKey;
}

export interface SavePcpEnvironmentOverrideInput {
  name: string;
  area: PcpAreaKey;
}

interface StoredPcpEnvironmentOverrides {
  [key: string]: {
    label: string;
    area: PcpAreaKey;
  };
}

export function toOverrideList(stored: StoredPcpEnvironmentOverrides): PcpEnvironmentOverrideItem[] {
  return Object.entries(stored)
    .map(([key, value]) => ({
      key,
      label: value.label,
      area: value.area,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
}

export function toOverrideMap(stored: StoredPcpEnvironmentOverrides): Record<string, PcpAreaKey> {
  const map: Record<string, PcpAreaKey> = {};
  for (const [key, value] of Object.entries(stored)) {
    if (value?.area) map[key] = value.area;
  }
  return map;
}

export function parseStoredOverrides(raw: string | null | undefined): StoredPcpEnvironmentOverrides {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as StoredPcpEnvironmentOverrides;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function upsertStoredOverride(
  stored: StoredPcpEnvironmentOverrides,
  input: SavePcpEnvironmentOverrideInput,
): StoredPcpEnvironmentOverrides {
  const label = input.name.trim();
  const key = normalizeEnvironmentKey(label);
  if (!key) return stored;

  return {
    ...stored,
    [key]: {
      label,
      area: input.area,
    },
  };
}
