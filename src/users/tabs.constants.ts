import { UserRole } from './entities/user.entity';

export const ALL_TAB_KEYS = [
  'dashboard',
  'reports',
  'jobs',
  'gosac-pontta',
  'gosac-pontta/grupos',
  'gosac-pontta/rodizio',
  'gosac-pontta/rodizio-pontta',
  'gosac-pontta/pagamento-montador',
  'usuarios',
  'configuracoes',
] as const;

export type TabKey = (typeof ALL_TAB_KEYS)[number];

export const GOSAC_CHILD_TABS = ALL_TAB_KEYS.filter((k) => k.startsWith('gosac-pontta/'));

export const MASTER_TABS = [...ALL_TAB_KEYS];

const ALLOWED = new Set<string>(ALL_TAB_KEYS);

export function normalizeTabs(tabs?: string[] | null): string[] {
  if (!tabs?.length) return [];

  const cleaned = [
    ...new Set(
      tabs
        .map((t) => String(t).trim())
        .filter((t) => ALLOWED.has(t)),
    ),
  ];

  const hasParent = cleaned.includes('gosac-pontta');
  const selectedChildren = cleaned.filter((t) => t.startsWith('gosac-pontta/'));

  if (hasParent && selectedChildren.length === 0) {
    cleaned.push(...GOSAC_CHILD_TABS);
  } else if (selectedChildren.length > 0 && !hasParent) {
    cleaned.push('gosac-pontta');
  }

  return cleaned;
}

/** Deriva role interna para guards de API a partir das abas escolhidas. */
export function deriveRoleFromTabs(tabs: string[]): UserRole {
  const normalized = normalizeTabs(tabs);
  if (normalized.includes('usuarios') || normalized.includes('configuracoes')) {
    return UserRole.ADMIN;
  }
  if (
    normalized.includes('jobs') ||
    normalized.includes('gosac-pontta') ||
    normalized.some((t) => t.startsWith('gosac-pontta/'))
  ) {
    return UserRole.MANAGER;
  }
  return UserRole.USER;
}
