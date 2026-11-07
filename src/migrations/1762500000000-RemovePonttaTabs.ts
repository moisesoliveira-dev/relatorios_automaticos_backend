import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * O Pontta saiu do sistema: as abas de relatórios, jobs, dashboard e "Gosac / Pontta" deixaram de existir.
 * Só o rodízio do GOSAC continua, agora na aba `rodizio` (era `gosac-pontta/rodizio`).
 * Converte as abas gravadas em `users.tabs` (JSON) e nos perfis (`settings.TABS_*`).
 * As tabelas antigas (reports, scheduled_jobs, pontta_*, ...) NÃO são apagadas: os dados ficam no banco.
 */
export class RemovePonttaTabs1762500000000 implements MigrationInterface {
  name = 'RemovePonttaTabs1762500000000';

  private static convert(tabs: string[]): string[] {
    const out = new Set<string>();
    for (const t of tabs) {
      if (t === 'gosac-pontta/rodizio') out.add('rodizio');
      else if (t === 'ia' || t === 'usuarios' || t === 'configuracoes' || t === 'rodizio')
        out.add(t);
      // dashboard, reports, jobs, gosac-pontta e os demais filhos: removidos
    }
    return [...out];
  }

  public async up(q: QueryRunner): Promise<void> {
    const users: Array<{ id: string; tabs: string | null }> = await q.query(
      `SELECT id, tabs FROM users WHERE tabs IS NOT NULL`,
    );
    for (const u of users) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(u.tabs ?? 'null');
      } catch {
        continue;
      }
      if (!Array.isArray(parsed)) continue;
      const next = RemovePonttaTabs1762500000000.convert(parsed.map(String));
      await q.query(`UPDATE users SET tabs = $1 WHERE id = $2`, [
        next.length ? JSON.stringify(next) : null,
        u.id,
      ]);
    }

    const rows: Array<{ key: string; value: string }> = await q.query(
      `SELECT key, value FROM settings WHERE key IN ('TABS_MASTER','TABS_ADMIN','TABS_MANAGER','TABS_USER')`,
    );
    for (const r of rows) {
      const next = RemovePonttaTabs1762500000000.convert(
        String(r.value ?? '')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      );
      await q.query(`UPDATE settings SET value = $1 WHERE key = $2`, [
        next.join(','),
        r.key,
      ]);
    }
  }

  public async down(): Promise<void> {
    // Sem volta: os dados antigos de abas não são guardados. O código antigo está no git (cca22e7).
  }
}
