import { UserRole } from './entities/user.entity';

export const ALL_TAB_KEYS = ['rodizio', 'ia', 'usuarios', 'configuracoes'] as const;

export type TabKey = (typeof ALL_TAB_KEYS)[number];

export const MASTER_TABS = [...ALL_TAB_KEYS];

const ALLOWED = new Set<string>(ALL_TAB_KEYS);

export function normalizeTabs(tabs?: string[] | null): string[] {
  if (!tabs?.length) return [];

  return [
    ...new Set(
      tabs
        .map((t) => String(t).trim())
        .filter((t) => ALLOWED.has(t)),
    ),
  ];
}

/** Verifica se o usuário pode acessar a aba exigida. */
export function userCanAccessTab(userTabs: string[], required: string): boolean {
  return new Set(userTabs).has(required);
}

export function userCanAccessAnyTab(userTabs: string[], requiredTabs: string[]): boolean {
  if (!requiredTabs.length) return true;
  return requiredTabs.some((tab) => userCanAccessTab(userTabs, tab));
}

/** Deriva role interna para guards de API a partir das abas escolhidas. */
export function deriveRoleFromTabs(tabs: string[]): UserRole {
  const normalized = normalizeTabs(tabs);
  if (normalized.includes('usuarios') || normalized.includes('configuracoes')) {
    return UserRole.ADMIN;
  }
  if (normalized.includes('rodizio')) {
    return UserRole.MANAGER;
  }
  return UserRole.USER;
}
